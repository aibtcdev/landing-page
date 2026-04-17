import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { lookupBnsNameWithOutcome } from "@/lib/bns";
import { detectAgentIdentityWithOutcome } from "@/lib/identity/detection";
import {
  invalidateBnsCache,
  invalidateIdentityCache,
} from "@/lib/identity/kv-cache";
import {
  createLogger,
  createConsoleLogger,
  isLogsRPC,
} from "@/lib/logging";

/**
 * Per-address rate-limit for manual refresh. Each refresh call:
 *   - deletes two `cache:*` entries (bypassing the 7d confirmed-negative TTL),
 *   - deletes the `identity-check:*` rate-limit sentinel,
 *   - issues two fresh Hiro API calls (BNS + identity).
 *
 * Without this guard an unauthenticated caller could amplify upstream traffic
 * by spamming POSTs. 60s is short enough to not block a user correcting a
 * genuine state-change, long enough to neutralise abuse.
 */
const REFRESH_RATE_LIMIT_SECONDS = 60;

/**
 * POST /api/identity/:address/refresh — Bust cached BNS + identity state.
 *
 * The BNS/identity three-state cache uses a 7-day confirmed-negative TTL.
 * That's correct for typical use (state changes require an on-chain tx) but
 * leaves a long tail of users who register a BNS name or mint an ERC-8004
 * identity NFT off-platform (e.g. via Xverse) after signing up with us. This
 * endpoint is their manual escape hatch:
 *
 *   1. Delete `cache:bns:{stxAddress}` and `cache:identity:{stxAddress}`.
 *   2. Re-run both lookups and return the fresh values.
 *
 * Rate-limit keys (`identity-check:{stxAddress}`) are also cleared so the
 * next request from `/api/identity/:address` isn't suppressed by a stale
 * sentinel.
 *
 * Accepts any registered agent address (BTC / STX / taproot) — resolves to
 * the same AgentRecord and invalidates against its `stxAddress`.
 *
 * Rate-limited to one refresh per address per {@link REFRESH_RATE_LIMIT_SECONDS}
 * seconds. Repeat calls within that window return 429 with `Retry-After`.
 *
 * Response:
 *   {
 *     stxAddress: string,
 *     bnsName: string | null,     // fresh value after re-lookup
 *     agentId: number | null,     // fresh value after re-lookup
 *     cachesCleared: ["cache:bns", "cache:identity", "identity-check"]
 *   }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  if (!address || address.trim().length === 0) {
    return NextResponse.json(
      { error: "Address parameter is required" },
      { status: 400 }
    );
  }

  try {
    const { env, ctx } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
    const baseCtx = { rayId, path: request.nextUrl.pathname };
    const logger = isLogsRPC(env.LOGS)
      ? createLogger(env.LOGS, ctx, baseCtx)
      : createConsoleLogger(baseCtx);

    const agent = await lookupAgent(kv, address);
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found", address },
        { status: 404 }
      );
    }

    const stxAddress = agent.stxAddress;

    // Rate limit: one manual refresh per address per REFRESH_RATE_LIMIT_SECONDS.
    // Enforced BEFORE any cache invalidation or Hiro call so repeat POSTs
    // don't keep busting the 7d confirmed-negative cache or amplifying traffic.
    const refreshGateKey = `refresh-gate:${stxAddress}`;
    const recentRefresh = await kv.get(refreshGateKey);
    if (recentRefresh) {
      return NextResponse.json(
        {
          error: `Refresh rate limit — try again in ${REFRESH_RATE_LIMIT_SECONDS} seconds`,
          stxAddress,
        },
        {
          status: 429,
          headers: { "Retry-After": String(REFRESH_RATE_LIMIT_SECONDS) },
        }
      );
    }
    await kv.put(refreshGateKey, "1", {
      expirationTtl: REFRESH_RATE_LIMIT_SECONDS,
    });

    // Invalidate caches. The `identity-check:{stx}` sentinel is deleted via
    // best-effort try/catch — a KV hiccup on that key shouldn't fail the
    // whole refresh (the typed cache invalidations are the load-bearing bust).
    const invalidations: Promise<void>[] = [
      invalidateBnsCache(stxAddress, kv, logger),
      invalidateIdentityCache(stxAddress, kv, logger),
      (async () => {
        try {
          await kv.delete(`identity-check:${stxAddress}`);
        } catch (err) {
          logger.warn("identity.refresh_identity_check_delete_failed", {
            stxAddress,
            error: String(err),
          });
        }
      })(),
    ];
    await Promise.all(invalidations);

    logger.info("identity.refresh_requested", { stxAddress });

    // Re-run both lookups against fresh Hiro state using the tri-state
    // outcome helpers. We need the state so we can skip the AgentRecord
    // write when the lookup was inconclusive (transient upstream error) —
    // otherwise a Hiro incident during refresh would clobber a previously
    // verified bnsName or erc8004AgentId with null.
    const [bnsOutcome, idOutcome] = await Promise.all([
      lookupBnsNameWithOutcome(stxAddress, env.HIRO_API_KEY, kv, logger),
      detectAgentIdentityWithOutcome(stxAddress, env.HIRO_API_KEY, kv, logger),
    ]);

    // Compute proposed next values. `"lookup-failed"` outcomes preserve the
    // stored value; authoritative outcomes (positive or confirmed-negative)
    // take effect.
    const nextBnsName =
      bnsOutcome.state === "lookup-failed"
        ? agent.bnsName ?? null
        : bnsOutcome.name;
    const nextAgentId =
      idOutcome.state === "lookup-failed"
        ? agent.erc8004AgentId ?? null
        : idOutcome.identity?.agentId ?? null;

    const bnsChanged = (agent.bnsName ?? null) !== nextBnsName;
    const idChanged = (agent.erc8004AgentId ?? null) !== nextAgentId;

    if (bnsChanged || idChanged) {
      const updatedRecord = {
        ...agent,
        bnsName: nextBnsName,
        erc8004AgentId: nextAgentId,
      };
      const serialized = JSON.stringify(updatedRecord);
      await Promise.all([
        kv.put(`stx:${stxAddress}`, serialized),
        kv.put(`btc:${agent.btcAddress}`, serialized),
      ]);
      logger.info("identity.refresh_persisted_update", {
        stxAddress,
        bnsChanged,
        idChanged,
        bnsOutcome: bnsOutcome.state,
        idOutcome: idOutcome.state,
      });
    } else if (
      bnsOutcome.state === "lookup-failed" ||
      idOutcome.state === "lookup-failed"
    ) {
      logger.warn("identity.refresh_inconclusive", {
        stxAddress,
        bnsOutcome: bnsOutcome.state,
        idOutcome: idOutcome.state,
      });
    }

    return NextResponse.json({
      stxAddress,
      btcAddress: agent.btcAddress,
      bnsName: nextBnsName,
      agentId: nextAgentId,
      bnsOutcome: bnsOutcome.state,
      idOutcome: idOutcome.state,
      cachesCleared: ["cache:bns", "cache:identity", "identity-check"],
    });
  } catch (e) {
    return NextResponse.json(
      { error: `Identity refresh failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

/** GET returns self-documentation for the endpoint. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;
  return NextResponse.json(
    {
      endpoint: "POST /api/identity/:address/refresh",
      description:
        "Bust the cached BNS + identity state for an address and re-run both " +
        "lookups. Use this after registering a BNS name or minting an ERC-8004 " +
        "identity NFT off-platform (e.g. via Xverse) — the platform's 7-day " +
        "confirmed-negative cache will otherwise serve stale state until it " +
        "expires.",
      method: "POST",
      rateLimit:
        `One refresh per address per ${REFRESH_RATE_LIMIT_SECONDS} seconds. ` +
        "Repeat calls return 429 with a Retry-After header.",
      parameters: {
        address:
          "BTC, STX, or taproot address of a registered agent (same formats " +
          "accepted by /api/agents/:address).",
      },
      response: {
        stxAddress: "string — the agent's STX address",
        btcAddress: "string — the agent's BTC address",
        bnsName: "string | null — fresh BNS name after re-lookup",
        agentId: "number | null — fresh ERC-8004 agent ID after re-lookup",
        bnsOutcome:
          "\"positive\" | \"confirmed-negative\" | \"lookup-failed\" — whether the BNS lookup produced an authoritative result. On lookup-failed the stored bnsName is preserved rather than clobbered.",
        idOutcome:
          "\"positive\" | \"confirmed-negative\" | \"lookup-failed\" — same for identity.",
        cachesCleared:
          "string[] — cache key families that were invalidated",
      },
      example: `POST /api/identity/${address || "SP..."}/refresh`,
    },
    { status: 200 }
  );
}
