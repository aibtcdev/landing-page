/**
 * Trading-comp dashboard: per-agent BTC L1 + STX + sBTC balance lookup.
 *
 * The dashboard paginates the agent list and only fetches balances for the
 * visible page, with each agent's result cached in KV (`cache:balance:{btc}`)
 * for 60 s. There is no full-fleet snapshot — see `app/api/dashboard/route.ts`.
 */

export type {
  AgentBalance,
  TokenBalance,
} from "./types";
export {
  fetchAgentBalances,
  getCachedAgentBalance,
} from "./fetch";
export type { AgentBalanceFetchResult } from "./fetch";
export { DASHBOARD_PAGE_SIZE } from "./constants";
export { getDashboardPage } from "./page";
export type { DashboardPageResult } from "./page";
