import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import { lookupBnsName } from "@/lib/bns";
import { detectAgentIdentity } from "@/lib/identity/detection";
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

    // 1. Bust caches. `identity-check:{stx}` is the rate-limit sentinel used
    //    by /api/identity/:address GET — clearing it so the next lookup isn't
    //    suppressed.
    await Promise.all([
      invalidateBnsCache(stxAddress, kv, logger),
      invalidateIdentityCache(stxAddress, kv, logger),
      kv.delete(`identity-check:${stxAddress}`),
    ]);

    logger.info("identity.refresh_requested", { stxAddress });

    // 2. Re-run both lookups against fresh Hiro state.
    const [bnsName, identity] = await Promise.all([
      lookupBnsName(stxAddress, env.HIRO_API_KEY, kv, logger),
      detectAgentIdentity(stxAddress, env.HIRO_API_KEY, kv, logger),
    ]);

    // 3. If either result differs from the stored agent record, persist the
    //    update on both btc: and stx: keys so consumers that read the record
    //    directly see the change immediately.
    const bnsChanged = (agent.bnsName || null) !== (bnsName || null);
    const idChanged =
      (agent.erc8004AgentId ?? null) !== (identity?.agentId ?? null);

    if (bnsChanged || idChanged) {
      const updatedRecord = {
        ...agent,
        bnsName: bnsName ?? null,
        erc8004AgentId: identity?.agentId ?? null,
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
      });
    }

    return NextResponse.json({
      stxAddress,
      btcAddress: agent.btcAddress,
      bnsName: bnsName ?? null,
      agentId: identity?.agentId ?? null,
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
        cachesCleared:
          "string[] — cache key families that were invalidated",
      },
      example: `POST /api/identity/${address || "SP..."}/refresh`,
    },
    { status: 200 }
  );
}
