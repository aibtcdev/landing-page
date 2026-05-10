import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimRecord } from "@/lib/types";
import { lookupBnsName, lookupOwnerByBnsName } from "@/lib/bns";
import { enrichAgentProfile } from "@/lib/agent-enrichment";
import { getAgentsIndex, invalidateAgentsIndex } from "@/lib/agents-index";
import {
  lookupBtcAddressByBnsName,
  syncBnsLookup,
} from "@/lib/bns-reverse-index";
import { buildEdgeCacheKey, withEdgeCache } from "@/lib/edge-cache";
import {
  classifyAddress,
  lookupProfileByBtcAddress,
  lookupProfileByStxAddress,
  lookupProfileByAgentId,
  mapRowToAgentRecord,
  mapRowToClaimRecord,
} from "@/lib/cache/agent-profile";
import {
  createLogger,
  createConsoleLogger,
  isLogsRPC,
} from "@/lib/logging";

const AGENT_PROFILE_CACHE_TTL_SECONDS = 300;

/**
 * GET /api/agents/:address — Individual agent lookup endpoint.
 *
 * Phase 2.2: replaces per-request KV fan-out (btc:, stx:, claim:) with a
 * single D1 SELECT + LEFT JOIN claims for the final agent-record fetch.
 *
 * Accepted address shapes:
 * - BTC address (bc1q..., 1..., 3...)       → D1 WHERE btc_address = ?
 * - STX address (SP..., ST..., SM...)        → D1 WHERE stx_address = ?
 * - Numeric (ERC-8004 agent-id)              → D1 WHERE erc8004_agent_id = ?
 * - Taproot (bc1p...)                        → KV taproot:{addr} → btc_address → D1
 * - BNS name (*.btc)                         → KV/BNS resolution → stx_address → D1
 *
 * Returns full agent profile with level info, check-in data, trust,
 * activity metrics, and capabilities. Self-documenting on GET with no match.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address || address.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Address parameter is required",
          usage: {
            endpoint: "GET /api/agents/:address",
            description:
              "Look up a specific agent by BTC address, taproot address, STX address, BNS name, or ERC-8004 agent-id",
            acceptedFormats: {
              taproot: ["bc1p..."],
              btc: ["bc1q...", "1...", "3..."],
              stx: ["SP...", "ST...", "SM..."],
              bns: ["*.btc"],
              numeric: ["123 (ERC-8004 agent-id)"],
            },
            examples: [
              "/api/agents/bc1q...",
              "/api/agents/SP...",
              "/api/agents/alice.btc",
              "/api/agents/42",
            ],
            responseFormat: {
              agent: "AgentRecord with full profile",
              level: "number (0-2)",
              levelName: "string (Unverified | Verified Agent | Genesis)",
              nextLevel: "NextLevelInfo | null",
              checkIn: "{ lastCheckInAt: string } | null",
              trust: "Trust metrics (level, onChain identity, reputation)",
              activity: "Activity metrics (lastActiveAt, hasCheckedIn, hasInboxMessages, unreadInboxCount)",
              capabilities: "Available capabilities based on level and registration (heartbeat, inbox, x402, reputation)",
            },
            relatedEndpoints: {
              allAgents: "/api/agents - List all agents with pagination",
              verify: "/api/verify/:address - Legacy verification endpoint",
              leaderboard:
                "/api/leaderboard - Ranked agents with level distribution",
            },
          },
        },
        { status: 400 }
      );
    }

    const branch = classifyAddress(address);

    if (!branch) {
      return NextResponse.json(
        {
          error:
            "Invalid address format. Expected a Bitcoin address (bc1p..., bc1q..., 1..., 3...), " +
            "Stacks address (SP..., ST..., SM...), BNS name (*.btc), or numeric ERC-8004 agent-id.",
          usage: {
            endpoint: "GET /api/agents/:address",
            acceptedFormats: {
              taproot: ["bc1p..."],
              btc: ["bc1q...", "1...", "3..."],
              stx: ["SP...", "ST...", "SM..."],
              bns: ["*.btc"],
              numeric: ["123"],
            },
          },
        },
        { status: 400 }
      );
    }

    // Wrap the agent-resolution + render in an edge-cache layer.
    // Cache hits skip the entire fan-out. 400s never hit the cache; non-ok
    // responses inside the loader (404 / 500) also skip caching via
    // withEdgeCache's response.ok gate.
    const cacheKey = buildEdgeCacheKey("/api/agents", address);
    return await withEdgeCache(
      cacheKey,
      AGENT_PROFILE_CACHE_TTL_SECONDS,
      async () => {
        const { env, ctx } = await getCloudflareContext();
        const kv = env.VERIFIED_AGENTS as KVNamespace;
        const db = env.DB as D1Database;
        const hiroApiKey = env.HIRO_API_KEY;

        const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
        const baseCtx = { rayId, path: request.nextUrl.pathname };
        const logger = isLogsRPC(env.LOGS)
          ? createLogger(env.LOGS, ctx, baseCtx)
          : createConsoleLogger(baseCtx);

        // Resolve to an AgentRecord via the appropriate D1 branch.
        // Taproot and BNS still use KV for the reverse-lookup step only —
        // those KV keys are not being migrated in Phase 2.2.
        //
        // kvFallbackKey: when D1 misses but the resolver produced a candidate
        // BTC/STX address, we try the KV record at that key as a last resort.
        // This preserves pre-flip 200 behavior for the ~708 validation-excluded
        // agents documented in docs/d1-reconcile-baseline.md (Phase 1.4 baseline).
        // Tracked for cleanup at #691; this fallback is transitional scaffolding.
        let agent: AgentRecord | null = null;
        // D1-joined claim record: set when the agent row comes from D1 (claim
        // is available from the LEFT JOIN). Left as undefined when the KV fallback
        // path is used — undefined signals enrichAgentProfile to fall back to KV.
        let d1Claim: ClaimRecord | null | undefined = undefined;
        let kvFallbackKey: string | null = null;

        if (branch === "btc") {
          // Branch 1: BTC address → D1 WHERE btc_address = ?
          const row = await lookupProfileByBtcAddress(db, address);
          if (row) {
            agent = mapRowToAgentRecord(row);
            d1Claim = mapRowToClaimRecord(row);
          } else kvFallbackKey = `btc:${address}`;
        } else if (branch === "stx") {
          // Branch 2: STX address → D1 WHERE stx_address = ?
          const row = await lookupProfileByStxAddress(db, address);
          if (row) {
            agent = mapRowToAgentRecord(row);
            d1Claim = mapRowToClaimRecord(row);
          } else kvFallbackKey = `stx:${address}`;
        } else if (branch === "numeric") {
          // Branch 3: ERC-8004 agent-id → D1 WHERE erc8004_agent_id = ?
          // No KV fallback: agents are not indexed by erc8004_agent_id in KV.
          const agentId = parseInt(address, 10);
          if (!Number.isNaN(agentId)) {
            const row = await lookupProfileByAgentId(db, agentId);
            if (row) {
              agent = mapRowToAgentRecord(row);
              d1Claim = mapRowToClaimRecord(row);
            }
          }
        } else if (branch === "taproot") {
          // Branch 4: Taproot reverse-lookup via KV (KV stays per Phase 2.2 RFC),
          // then D1 for the final agent-record fetch.
          const canonicalBtcAddress = await kv.get(`taproot:${address}`);
          if (canonicalBtcAddress) {
            const row = await lookupProfileByBtcAddress(db, canonicalBtcAddress);
            if (row) {
              agent = mapRowToAgentRecord(row);
              d1Claim = mapRowToClaimRecord(row);
            } else kvFallbackKey = `btc:${canonicalBtcAddress}`;
          }
        } else {
          // Branch 5: BNS name → KV/BNS resolution → D1 WHERE stx_address = ?
          // The BNS reverse-index fast path uses KV (not being migrated in 2.2).
          const target = address.toLowerCase();
          let stxAddress: string | null = null;

          // Fast path: maintained bns-lookup:{name} reverse index (2 KV reads)
          let btcAddress = await lookupBtcAddressByBnsName(kv, target);
          if (!btcAddress) {
            // Cold-start fallback: pre-B6.2 agents without a reverse-index entry.
            // Find via agents:index and self-heal.
            const index = await getAgentsIndex(kv);
            const entry = index.agents.find(
              (a) => a.bnsName && a.bnsName.toLowerCase() === target
            );
            if (entry) {
              btcAddress = entry.btcAddress;
              void syncBnsLookup(kv, null, target, btcAddress);
            }
          }

          if (btcAddress) {
            // Resolved btcAddress → D1 for the agent record
            const row = await lookupProfileByBtcAddress(db, btcAddress);
            if (row) {
              // Guard: confirm the stored bns_name matches (stale index protection)
              if (row.bns_name && row.bns_name.toLowerCase() === target) {
                agent = mapRowToAgentRecord(row);
                d1Claim = mapRowToClaimRecord(row);
                stxAddress = row.stx_address;
              }
            } else {
              // D1 missed for the BNS-resolved BTC address — set fallback key
              kvFallbackKey = `btc:${btcAddress}`;
            }
          }

          // If still unresolved, try Hiro BNS API as last resort.
          // lookupOwnerByBnsName resolves BNS name → owner STX address (reverse lookup).
          // lookupBnsName would be wrong here: it resolves STX address → BNS name (forward).
          if (!agent && !stxAddress) {
            const resolvedStx = await lookupOwnerByBnsName(target, hiroApiKey, kv, logger)
              .catch(() => null);
            if (resolvedStx) {
              const row = await lookupProfileByStxAddress(db, resolvedStx);
              if (row) {
                agent = mapRowToAgentRecord(row);
                d1Claim = mapRowToClaimRecord(row);
              } else if (!kvFallbackKey) kvFallbackKey = `stx:${resolvedStx}`;
            }
          }
        }

        // KV fallback for validation-excluded agents (708 records per
        // docs/d1-reconcile-baseline.md). Transitional — see #691 for cleanup.
        // d1Claim stays undefined here — enrichAgentProfile will fall back to KV.
        if (!agent && kvFallbackKey) {
          const kvValue = await kv.get(kvFallbackKey);
          if (kvValue) {
            try {
              agent = JSON.parse(kvValue) as AgentRecord;
              logger.info("profile.kv_fallback_hit", { key: kvFallbackKey });
            } catch {
              // Malformed KV record — leave agent null
            }
          }
        }

        // Agent not found
        if (!agent) {
          return NextResponse.json(
            {
              found: false,
              address,
              addressType: branch,
              error: "Agent not found. This address is not registered.",
              nextSteps: {
                action: "Register as a new agent",
                endpoint: "POST /api/register",
                documentation: "https://aibtc.com/llms-full.txt",
              },
            },
            { status: 404 }
          );
        }

        // Lazy BNS refresh: if bnsName is missing, try to look it up.
        // Fire-and-forget so it doesn't block the response.
        if (!agent.bnsName && agent.stxAddress) {
          void lookupBnsName(agent.stxAddress, hiroApiKey, kv, logger).then((bnsName) => {
            if (bnsName) {
              const previousBnsName = agent!.bnsName ?? null;
              agent!.bnsName = bnsName;
              const updated = JSON.stringify(agent);
              Promise.all([
                kv.put(`stx:${agent!.stxAddress}`, updated),
                kv.put(`btc:${agent!.btcAddress}`, updated),
                invalidateAgentsIndex(kv, logger),
                syncBnsLookup(kv, previousBnsName, bnsName, agent!.btcAddress, logger),
              ]).catch((err) =>
                logger.error("agents.update_agent_cache_failed", {
                  btcAddress: agent!.btcAddress,
                  stxAddress: agent!.stxAddress,
                  error: String(err),
                })
              );
            }
          }).catch(() => {});
        }

        // Pass d1Claim so enrichAgentProfile skips the redundant KV read when the
        // agent came from D1 (covers all non-KV-fallback paths). When d1Claim is
        // undefined (KV fallback agents), enrichAgentProfile falls back to KV.
        const enrichment = await enrichAgentProfile(
          agent,
          kv,
          hiroApiKey,
          `agents/${agent.btcAddress}`,
          logger,
          d1Claim
        );

        const checkIn = enrichment.checkIn
          ? {
              lastCheckInAt: enrichment.checkIn.lastCheckInAt,
            }
          : null;

        return NextResponse.json(
          {
            found: true,
            address,
            addressType: branch,
            agent: {
              stxAddress: agent.stxAddress,
              btcAddress: agent.btcAddress,
              displayName: agent.displayName,
              description: agent.description,
              bnsName: agent.bnsName,
              taprootAddress: agent.taprootAddress ?? null,
              verifiedAt: agent.verifiedAt,
              owner: agent.owner,
              stxPublicKey: agent.stxPublicKey,
              btcPublicKey: agent.btcPublicKey,
              lastActiveAt: agent.lastActiveAt,
              erc8004AgentId: enrichment.resolvedAgentId,
              caip19: enrichment.caip19,
            },
            ...enrichment.levelInfo,
            checkIn,
            trust: enrichment.trust,
            activity: enrichment.activity,
            capabilities: enrichment.capabilities,
          },
          {
            headers: {
              "Cache-Control": "public, max-age=60, s-maxage=300",
            },
          }
        );
      },
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("Agent profile lookup error:", e);
    return NextResponse.json(
      { error: `Agent lookup failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
