/**
 * Earnings indexer constants (issue #978, Phase 1).
 *
 * Cost-first defaults: small per-tick slice, bounded backfill, concurrency
 * under Cloudflare's 6 simultaneous-connection cap. The whole task is gated by
 * EARNINGS_INDEX_ENABLED so it ships dormant and can be killed instantly.
 */

/** D1 `competition_state` key holding the round-robin sweep cursor. */
export const EARNINGS_CURSOR_KEY = "earnings_scheduler_cursor";

/** Agents processed per sweep tick. Small so a tick stays cheap and bounded. */
export const EARNINGS_MAX_AGENTS_PER_RUN = 25;

/** Concurrent agent fetches. Must stay <= 5 — Cloudflare caps a Worker at 6
 *  simultaneous outgoing connections waiting for response headers. */
export const EARNINGS_FETCH_CONCURRENCY = 5;

/** Hiro `transactions_with_transfers` page size. */
export const EARNINGS_HIRO_PAGE_LIMIT = 50;

/** Max pages walked per agent per tick. Bounds the first-run backfill burst so
 *  day-one indexing can't spike Hiro usage; deep history fills over many ticks. */
export const EARNINGS_MAX_PAGES_PER_AGENT = 4;

/** How often the earnings sweep is due (ms). Slower than competition — a 30-day
 *  board does not need minute freshness, and slower = cheaper. */
export const EARNINGS_INTERVAL_MS = 30 * 60 * 1000;

/** Source classifications. `is_earning` is derived from these + excluded_reason. */
export const EARNING_SOURCE_CLASSES = [
  "inbox_message",
  "bounty",
  "x402_endpoint",
  "agent_peer",
] as const;

export const EXCLUDED_SOURCE_CLASSES = [
  "exchange_or_external",
  "unclassified",
] as const;
