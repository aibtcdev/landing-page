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

/**
 * Per-agent balance cache. One KV entry per registered agent, holding the
 * full TokenBalance[] result. Cheap reads, ~60s TTL — fresh enough for a
 * trading-comp leaderboard without hammering Hiro/mempool on every render.
 */
export const BALANCE_CACHE_PREFIX = "cache:balance:";
export const BALANCE_CACHE_TTL_SECONDS = 60;

/**
 * Upstream-failure sentinel prefix.
 * Mirrors the B3 runbook pattern (cache:verify-timeout:*): when an agent's
 * upstream balance fetch fails, write `cache:dashboard:upstream-fail:{scope}:{addr}`
 * with a short TTL so the next ~60s of fetches skip that agent rather than
 * re-hammering Hiro / mempool.space.
 */
export const UPSTREAM_FAIL_PREFIX = "cache:dashboard:upstream-fail:";
export const UPSTREAM_FAIL_TTL_SECONDS = 60;

/**
 * Concurrency limit when fetching balances for the visible page of agents.
 * Bounded so a single page render never exceeds the Workers subrequest cap
 * and stays well under per-IP rate limits at upstreams.
 */
export const BALANCE_FETCH_CONCURRENCY = 10;

/** Per-fetch timeout for upstream HTTP calls (ms). */
export const BALANCE_FETCH_TIMEOUT_MS = 8_000;

/** Default page size for /api/dashboard. */
export const DASHBOARD_PAGE_SIZE = 10;
