/**
 * Token-id source for the SchedulerDO's Tenero price-refresh task.
 *
 * Two sources, in priority order:
 *
 *   1. STATIC_TOKEN_IDS — a small always-include core set (STX + sBTC + stSTX).
 *      Acts as a safe fallback when the swaps table is empty (cold start) or
 *      D1 query fails, so the SchedulerDO can still keep popular tokens warm.
 *
 *   2. Distinct token_in / token_out from the `swaps` table, restricted to
 *      successful agent/cron swaps, junk-filtered (no `"unknown"`, must match
 *      a Stacks identifier shape), ranked by trade count, and capped at
 *      MAX_TRACKED_TOKENS.
 *
 * The dynamic path replaces an earlier hand-curated list. Rationale: now that
 * the `swaps` table is the source of truth for what agents actually trade,
 * the refresh schedule should follow that data instead of a list someone has
 * to remember to update. Junk filter + bounded LIMIT keep the quota footprint
 * predictable even if a malformed token id ever leaks into a swap row.
 *
 * /api/prices still uses STATIC_TOKEN_IDS directly as its supported-token
 * surface — that endpoint's contract is "the 3 baseline tokens", not "every
 * token we know about", and its aggressive Cache-Control would make a
 * dynamic list confusing. Keep them decoupled.
 */

export const STATIC_TOKEN_IDS: readonly string[] = [
  "stx",
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx",
];

/**
 * Maximum number of distinct tokens to refresh per SchedulerDO tick. Bounds
 * the Tenero quota cost so a memecoin-trading spree can't blow the monthly
 * budget. At 50 tokens × 12 ticks/hr × 24 × 30 ≈ 432k requests/month — fine
 * once authenticated; the unauthenticated tier (50k/month) would burst the
 * ceiling, but during free-tier operation the swaps table won't realistically
 * surface 50 distinct ids per tick so this is a safety net, not a typical cap.
 */
export const MAX_TRACKED_TOKENS = 50;

/**
 * Accepts the literal `stx` OR a `SP|SM|ST{38-40-hex}.contract-name(::asset)?`
 * shape. Filters out the `"unknown"` sentinel and anything else the parser
 * might emit that isn't a legitimate Stacks identifier.
 *
 * The character classes follow the Stacks crockford-base32 alphabet (no I/L/O/U)
 * and the standard SIP-010 contract-name + asset-name rules (alphanumeric +
 * `-`/`_`, the SIP-010 `::asset` suffix optional on the trait reference).
 */
const TOKEN_ID_RE =
  /^(?:stx|S[PMTN][0-9A-HJKMNP-TV-Z]{38,40}\.[A-Za-z][A-Za-z0-9_-]*(?:::[A-Za-z][A-Za-z0-9_-]*)?)$/;

export function isValidTokenId(id: string): boolean {
  return TOKEN_ID_RE.test(id);
}

interface TrackedTokenRow {
  id: string;
  cnt: number | string;
}

/**
 * Derive the active token-refresh set from the swaps table. Returns the union
 * of STATIC_TOKEN_IDS (always-include core) and the top-{MAX_TRACKED_TOKENS}
 * tokens by trade count from successful agent/cron swaps, deduplicated.
 *
 * Falls back to STATIC_TOKEN_IDS on:
 *   - missing D1 binding (local dev, preview without DB)
 *   - D1 query failure (transient DB issue shouldn't blow the refresh)
 *
 * Pure async function — no logging, no side effects. Caller wires logging.
 */
export async function getActiveTokenIds(
  db: D1Database | undefined
): Promise<readonly string[]> {
  if (!db) return STATIC_TOKEN_IDS;

  let dynamic: string[] = [];
  try {
    const result = await db
      .prepare(
        `
        SELECT id, SUM(cnt) AS cnt FROM (
          SELECT token_in AS id, COUNT(*) AS cnt FROM swaps
          WHERE source IN ('agent','cron')
            AND tx_status = 'success'
            AND token_in IS NOT NULL
            AND token_in != 'unknown'
          GROUP BY token_in
          UNION ALL
          SELECT token_out AS id, COUNT(*) AS cnt FROM swaps
          WHERE source IN ('agent','cron')
            AND tx_status = 'success'
            AND token_out IS NOT NULL
            AND token_out != 'unknown'
          GROUP BY token_out
        )
        GROUP BY id
        ORDER BY SUM(cnt) DESC
        LIMIT ?1
        `
      )
      .bind(MAX_TRACKED_TOKENS)
      .all<TrackedTokenRow>();
    dynamic = (result.results ?? [])
      .map((r) => r.id)
      .filter((id): id is string => typeof id === "string" && isValidTokenId(id));
  } catch {
    return STATIC_TOKEN_IDS;
  }

  // Union with the static core. Set semantics; preserve insertion order
  // (static first, then dynamic) so the static tokens lead the refresh loop
  // and stay warm even if the loop is cut short by rate-limiting mid-run.
  const merged = new Set<string>([...STATIC_TOKEN_IDS, ...dynamic]);
  return Array.from(merged);
}
