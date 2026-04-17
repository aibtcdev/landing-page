import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import type { AgentRecord } from "@/lib/types";
import { IDENTITY_REGISTRY_CONTRACT, STACKS_API_BASE } from "@/lib/identity/constants";
import { stacksApiFetch, buildHiroHeaders } from "@/lib/stacks-api-fetch";
import { setCachedIdentity, setCachedIdentityNegative } from "@/lib/identity/kv-cache";
import {
  createLogger,
  createConsoleLogger,
  isLogsRPC,
} from "@/lib/logging";

/** Sleep helper for rate-spacing sequential Hiro API calls. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Minimum delay between Hiro API calls to stay within rate limits (200ms = 5 calls/sec). */
const BACKFILL_INTER_CALL_DELAY_MS = 200;

/**
 * GET /api/admin/backfill-identity
 *
 * Backfill erc8004AgentId for agents that have null/undefined identity but
 * have not been checked recently. Iterates KV records under the btc: prefix,
 * fetches Hiro NFT holdings for unchecked agents, and persists results.
 *
 * Uses KV sentinel key `identity-check:{stxAddress}` (5-min TTL) to avoid
 * re-checking recently-checked negative results. Respects the same rate-limit
 * sentinel that the heartbeat and identity endpoints use.
 *
 * Requires X-Admin-Key header.
 *
 * Query params:
 *   ?limit=N  — max agents to process (default: 50, max: 200)
 *   ?dry_run=true — scan and report without writing to KV
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { env, ctx } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY as string | undefined;

    const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
    const baseCtx = { rayId, path: request.nextUrl.pathname };
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, baseCtx)
      : createConsoleLogger(baseCtx);

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);
    const dryRun = searchParams.get("dry_run") === "true";

    const [contractAddress, contractName] = IDENTITY_REGISTRY_CONTRACT.split(".");
    const assetId = `${contractAddress}.${contractName}::agent-identity`;

    const hiroHeaders = buildHiroHeaders(hiroApiKey);

    let processed = 0;
    let updated = 0;
    let skippedAlreadySet = 0;
    let skippedSentinel = 0;
    let errors = 0;
    const updatedAgents: string[] = [];

    // List all btc: keys (one record per agent), paginating with cursor
    let listComplete = false;
    let cursor: string | undefined;

    while (!listComplete && processed < limit) {
      type KVListResult = { keys: Array<{ name: string }>; list_complete: boolean; cursor: string };
      const listResult: KVListResult = await kv.list({
        prefix: "btc:",
        limit: Math.min(limit - processed + 20, 100), // fetch slightly more to account for skips
        cursor,
      }) as KVListResult;

      for (const key of listResult.keys) {
        if (processed >= limit) break;

        const raw = await kv.get(key.name);
        if (!raw) continue;

        let agent: AgentRecord;
        try {
          agent = JSON.parse(raw) as AgentRecord;
        } catch {
          errors++;
          continue;
        }

        // Skip agents that already have a confirmed identity
        if (agent.erc8004AgentId != null) {
          skippedAlreadySet++;
          continue;
        }

        processed++;

        // Check KV sentinel — recently checked and found null
        const sentinelKey = `identity-check:${agent.stxAddress}`;
        const recentlyChecked = await kv.get(sentinelKey);
        if (recentlyChecked) {
          skippedSentinel++;
          continue;
        }

        try {
          const url = `${STACKS_API_BASE}/extended/v1/tokens/nft/holdings?principal=${agent.stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;
          const resp = await stacksApiFetch(
            url,
            { headers: hiroHeaders },
            { logger }
          );

          if (!resp.ok) {
            logger.warn("backfill.hiro_error", {
              stxAddress: agent.stxAddress,
              status: resp.status,
            });
            errors++;
            // Still rate-space on error to avoid hammering a degraded endpoint
            await sleep(BACKFILL_INTER_CALL_DELAY_MS);
            continue;
          }

          const data = await resp.json() as { results?: Array<{ value: { repr: string } }> };
          const repr = data.results?.[0]?.value?.repr;
          const tokenMatch = repr?.match(/^u(\d+)$/);
          const agentId = tokenMatch ? Number(tokenMatch[1]) : null;

          if (!dryRun) {
            if (agentId != null) {
              // Positive result — update both KV keys AND the three-state
              // identity cache so downstream SSR/profile paths see the fresh
              // state instead of any stale confirmed-negative (7d TTL).
              const updatedRecord = JSON.stringify({ ...agent, erc8004AgentId: agentId });
              await Promise.all([
                kv.put(`btc:${agent.btcAddress}`, updatedRecord),
                kv.put(`stx:${agent.stxAddress}`, updatedRecord),
                setCachedIdentity(
                  agent.stxAddress,
                  { agentId, owner: agent.stxAddress, uri: "" },
                  kv,
                  logger
                ),
              ]);
              updated++;
              updatedAgents.push(`${agent.btcAddress} → agentId ${agentId}`);
            } else {
              // Negative result — set rate-limit sentinel to avoid re-checking
              // from this admin route (5-min TTL) AND record confirmed-negative
              // in the three-state identity cache (7d TTL) so other paths also
              // skip the Hiro round-trip.
              await Promise.all([
                kv.put(sentinelKey, "1", { expirationTtl: 300 }),
                setCachedIdentityNegative(agent.stxAddress, kv, logger),
              ]);
            }
          } else if (agentId != null) {
            updated++;
            updatedAgents.push(`${agent.btcAddress} → agentId ${agentId} (dry run)`);
          }
        } catch (error) {
          logger.error("backfill.error", {
            stxAddress: agent.stxAddress,
            error: String(error),
          });
          errors++;
          // Still rate-space on unexpected errors
          await sleep(BACKFILL_INTER_CALL_DELAY_MS);
          continue;
        }

        // Rate-space: wait between Hiro calls to stay within budget
        await sleep(BACKFILL_INTER_CALL_DELAY_MS);
      }

      listComplete = listResult.list_complete;
      cursor = listResult.cursor;
    }

    return NextResponse.json({
      dryRun,
      processed,
      updated,
      skippedAlreadySet,
      skippedSentinel,
      errors,
      updatedAgents,
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Backfill failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
