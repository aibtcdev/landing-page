/**
 * Paginated balance loader for the dashboard.
 *
 * Loads one page (default 10) of agents from the existing `cache:agent-list`
 * snapshot, then fetches each visible agent's balance via the per-agent
 * `cache:balance:{btc}` cache (60 s TTL). Repeated views of the same page
 * cost only N KV reads with no upstream traffic.
 *
 * Sort is `verifiedAt` desc (matches the agents-page default and avoids the
 * "fetch every agent's balance to compute sBTC ranking" problem). The
 * per-page rows are still sorted by sBTC desc client-side for UX.
 */

import { getCachedAgentList } from "@/lib/cache";
import type { Logger } from "@/lib/logging";
import { BALANCE_FETCH_CONCURRENCY } from "./constants";
import { getCachedAgentBalance } from "./fetch";
import type { AgentBalance } from "./types";

export interface DashboardPageResult {
  agents: AgentBalance[];
  total: number;
  hasMore: boolean;
}

/**
 * Fetch a page of agents with their balances.
 *
 * @param kv          - VERIFIED_AGENTS namespace
 * @param hiroApiKey  - Optional Hiro API key for higher rate limits
 * @param offset      - Pagination offset (default 0)
 * @param limit       - Page size (default 10)
 * @param logger      - Optional Logger
 */
export async function getDashboardPage(
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  offset: number,
  limit: number,
  logger?: Logger
): Promise<DashboardPageResult> {
  const list = await getCachedAgentList(kv);
  // `cache:agent-list` returns agents in registration order — slice the
  // requested page out of that ordering.
  const total = list.agents.length;
  const slice = list.agents.slice(offset, offset + limit);

  // Fan out balance fetches for the visible page only, bounded by the
  // shared concurrency limit. Each call is KV-cached so most calls are
  // cheap reads, not upstream fetches.
  const agents: AgentBalance[] = [];
  for (let i = 0; i < slice.length; i += BALANCE_FETCH_CONCURRENCY) {
    const batch = slice.slice(i, i + BALANCE_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (agent) => {
        const result = await getCachedAgentBalance(
          agent.stxAddress,
          agent.btcAddress,
          kv,
          hiroApiKey,
          logger
        );
        const row: AgentBalance = {
          stxAddress: agent.stxAddress,
          btcAddress: agent.btcAddress,
          displayName: agent.displayName,
          bnsName: agent.bnsName,
          level: agent.level,
          levelName: agent.levelName,
          tokens: result.tokens,
        };
        if (result.partial) row.fetchError = "partial";
        return row;
      })
    );
    agents.push(...results);
  }

  return {
    agents,
    total,
    hasMore: offset + limit < total,
  };
}
