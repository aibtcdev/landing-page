import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import type { AgentRecord } from "@/lib/types";
import { IDENTITY_REGISTRY_CONTRACT, STACKS_API_BASE } from "@/lib/identity/constants";

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
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY as string | undefined;

    const { searchParams } = new URL(request.url);
    const limitParam = parseInt(searchParams.get("limit") ?? "50", 10);
    const limit = Math.min(Math.max(1, isNaN(limitParam) ? 50 : limitParam), 200);
    const dryRun = searchParams.get("dry_run") === "true";

    const [contractAddress, contractName] = IDENTITY_REGISTRY_CONTRACT.split(".");
    const assetId = `${contractAddress}.${contractName}::agent-identity`;

    const hiroHeaders: Record<string, string> = {};
    if (hiroApiKey) hiroHeaders["X-Hiro-API-Key"] = hiroApiKey;

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
          const resp = await fetch(url, { headers: hiroHeaders });

          if (!resp.ok) {
            console.warn(`[backfill-identity] Hiro error ${resp.status} for ${agent.stxAddress}`);
            errors++;
            continue;
          }

          const data = await resp.json() as { results?: Array<{ value: { repr: string } }> };
          const repr = data.results?.[0]?.value?.repr;
          const tokenMatch = repr?.match(/^u(\d+)$/);
          const agentId = tokenMatch ? Number(tokenMatch[1]) : null;

          if (!dryRun) {
            if (agentId != null) {
              // Positive result — update both KV keys
              const updatedRecord = JSON.stringify({ ...agent, erc8004AgentId: agentId });
              await Promise.all([
                kv.put(`btc:${agent.btcAddress}`, updatedRecord),
                kv.put(`stx:${agent.stxAddress}`, updatedRecord),
              ]);
              updated++;
              updatedAgents.push(`${agent.btcAddress} → agentId ${agentId}`);
            } else {
              // Negative result — set sentinel to prevent re-checking (5-min TTL)
              await kv.put(sentinelKey, "1", { expirationTtl: 300 });
            }
          } else if (agentId != null) {
            updated++;
            updatedAgents.push(`${agent.btcAddress} → agentId ${agentId} (dry run)`);
          }
        } catch (error) {
          console.error(`[backfill-identity] Error for ${agent.stxAddress}:`, error);
          errors++;
        }
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
