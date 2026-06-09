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

// How often the earnings sweep is due (ms). 30 min in steady state — the full
// roster is backfilled, so this only needs to catch new inflows incrementally.
// (Was 5 min during the initial backfill rollout to fill the board fast.)
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

// ── Anti-gaming (Phase 2) ────────────────────────────────────────────────

/** Two-hop ring window: A→B→A round-trips within 14 days are excluded. */
export const EARNINGS_RING_WINDOW_SECONDS = 14 * 24 * 60 * 60;

/** Ring legs must be "similar amount" — within ±10% of each other. */
export const EARNINGS_RING_AMOUNT_TOLERANCE = 0.1;

/** A failed first-funder lookup is re-attempted after this long (ms); 'ok' and
 *  'none' results are cached permanently (first-funder is immutable). */
export const FIRST_FUNDER_FAILED_RETRY_MS = 60 * 60 * 1000;
