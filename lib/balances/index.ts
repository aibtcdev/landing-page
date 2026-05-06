/**
 * Trading-comp dashboard: per-agent multi-token balance + USD valuation.
 *
 * See `lib/balances/snapshot.ts` for the SWR cache that backs `/api/dashboard`.
 */

export type {
  AgentBalance,
  DashboardSnapshot,
  TokenBalance,
} from "./types";
export {
  getDashboardSnapshot,
  invalidateDashboardSnapshot,
} from "./snapshot";
