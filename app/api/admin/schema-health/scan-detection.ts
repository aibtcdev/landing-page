/**
 * EXPLAIN QUERY PLAN SCAN-detection helper for the schema-health endpoint.
 *
 * Kept in a sibling module (not route.ts) because Next.js App Router route
 * files may only export HTTP handlers + route config — exporting a helper from
 * route.ts fails the `next build` route-export validation.
 */

/**
 * Determine whether an EXPLAIN QUERY PLAN detail line represents a full table
 * scan without any index.
 *
 * SQLite EXPLAIN QUERY PLAN output shapes:
 *   "SCAN tablename"                                    → BAD  (full scan, no index)
 *   "SCAN tablename USING COVERING INDEX idx_name"      → OK   (index-only scan)
 *   "SCAN tablename USING INDEX idx_name"               → OK   (index scan)
 *   "SEARCH tablename USING INDEX idx_name (...)"       → OK   (index seek)
 *   "SEARCH tablename USING COVERING INDEX idx_name"    → OK   (covering index seek)
 *   "SCAN SUBQUERY ..."                                 → informational, not a table-scan
 *   "USE TEMP B-TREE FOR ORDER BY"                      → informational, not a scan
 *
 * We flag only: a line that starts with "SCAN " (after trimming leading
 * whitespace), is NOT "SCAN SUBQUERY", and has no "USING INDEX" clause.
 */
export function isScanWithoutIndex(detail: string): boolean {
  const trimmed = detail.trimStart();
  // Must start with "SCAN " (SQLite uses uppercase)
  if (!trimmed.startsWith("SCAN ")) return false;
  // SCAN SUBQUERY lines are plan-structure annotations, not table scans
  if (trimmed.startsWith("SCAN SUBQUERY")) return false;
  // If it uses any index, it is acceptable
  if (
    trimmed.includes("USING INDEX") ||
    trimmed.includes("USING COVERING INDEX")
  ) {
    return false;
  }
  return true;
}
