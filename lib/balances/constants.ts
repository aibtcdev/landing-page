/**
 * Constants for the dashboard balance fetcher and snapshot.
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
 * Snapshot cache for the trading-comp dashboard. One KV entry holds the
 * full ranked array of Genesis agents with their balances. Public requests
 * always read this key — they never trigger upstream fan-out directly.
 *
 * Fresh window (60 s): within this age, no rebuild needed.
 * Hard TTL (300 s): how long the value persists in KV. Keeps stale data
 * around so we can serve it during a background rebuild.
 */
export const SNAPSHOT_CACHE_KEY = "cache:dashboard:snapshot";
export const SNAPSHOT_FRESH_WINDOW_SECONDS = 60;
export const SNAPSHOT_HARD_TTL_SECONDS = 300;

/**
 * Single-flight sentinel for the snapshot rebuild. While set, no other
 * request will start a duplicate rebuild — they either poll for the
 * fresh snapshot or serve the stale one.
 */
export const SNAPSHOT_BUILDING_KEY = "cache:dashboard:snapshot:building";
export const SNAPSHOT_BUILDING_TTL_SECONDS = 60;

/**
 * Upstream-failure sentinel prefix.
 * When an agent's BTC or STX balance fetch fails, write
 * `cache:dashboard:upstream-fail:{scope}:{addr}` with a short TTL so the
 * next ~60 s of fetches skip that agent rather than re-hammering the
 * upstream during the same rebuild.
 */
export const UPSTREAM_FAIL_PREFIX = "cache:dashboard:upstream-fail:";
export const UPSTREAM_FAIL_TTL_SECONDS = 60;

/**
 * Concurrency limit when fetching balances during a snapshot rebuild.
 * Bounded so the rebuild stays well under per-IP rate limits at upstreams
 * and within the Workers subrequest cap.
 */
export const BALANCE_FETCH_CONCURRENCY = 10;

/** Per-fetch timeout for upstream HTTP calls (ms). */
export const BALANCE_FETCH_TIMEOUT_MS = 8_000;
