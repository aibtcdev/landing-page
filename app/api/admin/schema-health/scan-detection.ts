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
 *   "USE TEMP B-TREE FOR ORDER BY"                      → informational, not a scan
 *
 * We flag only the first case: SCAN without any USING INDEX clause.
 */
export function isScanWithoutIndex(detail: string): boolean {
  // Must start with "SCAN " (SQLite uses uppercase)
  if (!detail.includes("SCAN ")) return false;
  // If it uses any index, it is acceptable
  if (detail.includes("USING INDEX") || detail.includes("USING COVERING INDEX")) {
    return false;
  }
  return true;
}
