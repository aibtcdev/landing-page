/**
 * Constants for the dashboard balance fetcher.
 */

import { SBTC_CONTRACTS } from "@/lib/inbox/constants";

/** mempool.space REST API base for BTC L1 balances. */
export const MEMPOOL_API_BASE = "https://mempool.space/api";

/** Native token decimals. */
export const BTC_DECIMALS = 8;
export const STX_DECIMALS = 6;
export const SBTC_DECIMALS = 8;

/** Mainnet sBTC contract identifier (`address.contract-name`). */
export const SBTC_CONTRACT_ID = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.name}`;

/** KV key for the assembled dashboard snapshot. */
export const DASHBOARD_CACHE_KEY = "cache:dashboard";
export const DASHBOARD_CACHE_TTL_SECONDS = 600; // 10 min hard
export const DASHBOARD_FRESH_WINDOW_SECONDS = 120; // 2 min fresh
export const DASHBOARD_BUILDING_KEY = "cache:dashboard:building";
export const DASHBOARD_BUILDING_TTL_SECONDS = 90;

/**
 * Upstream-failure sentinel prefix.
 * Mirrors the B3 runbook pattern (cache:verify-timeout:*): when an agent's
 * upstream balance fetch fails, write `cache:dashboard:upstream-fail:{scope}:{addr}`
 * with a short TTL so the next ~60s of rebuilds skip that agent rather than
 * re-hammering Hiro / mempool.space.
 */
export const UPSTREAM_FAIL_PREFIX = "cache:dashboard:upstream-fail:";
export const UPSTREAM_FAIL_TTL_SECONDS = 60;

/** Concurrency limit when refetching all agent balances during a rebuild. */
export const BALANCE_FETCH_CONCURRENCY = 10;

/** Per-fetch timeout for upstream HTTP calls (ms). */
export const BALANCE_FETCH_TIMEOUT_MS = 8_000;
