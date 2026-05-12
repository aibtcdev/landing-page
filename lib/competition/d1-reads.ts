/**
 * D1 read helpers for the trading-comp verifier surface.
 *
 * Phase 3.1 PR-A — read routes only. The verifier (POST /api/competition/trades)
 * ships in PR-B; scheduler catch-up + allowlist in PR-D.
 *
 * Read contract (locked, per PHASE-3.1-HANDOFF.md):
 *   - GET /api/competition/status     → getCompetitionStatusFromD1
 *   - GET /api/competition/trades     → listSwapsFromD1 + countSwapsFromD1
 *
 * Schema reference: migrations/005_swaps.sql, 001_agents.sql,
 *                   007_registered_wallets_view.sql.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/734 (Phase 3.1 spec)
 * See: docs/rfc-d1-schema.md `### `swaps``
 */

/**
 * A single row from swaps mapped to the API response shape.
 * Field names mirror the migration (sender, token_in, etc.) — not the
 * original #683 spec. Treat these as fixed.
 */
export interface SwapRow {
  txid: string;
  sender: string;
  contract_id: string;
  function_name: string;
  token_in: string;
  amount_in: number;
  token_out: string;
  amount_out: number;
  burn_block_time: number;
  tx_status: string;
  source: "agent" | "cron" | "chainhook";
  scored_value: number | null;
  scored_at: string | null;
}

/**
 * GET /api/competition/status response shape.
 *
 * When `registered` is false, callers should omit/zero the count fields.
 * Unregistered addresses are NOT a 404 — the MCP's `competition_status`
 * description tells agents to read `registered: false` and call
 * `identity_register`.
 */
export interface CompetitionStatusRow {
  address: string;
  agent_id: number | null;
  registered: boolean;
  trade_count: number;
  verified_trade_count: number;
  first_trade_at: number | null;
  last_trade_at: number | null;
}

interface D1StatusRow {
  address: string;
  agent_id: number | null;
  registered: number;
  trade_count: number;
  verified_trade_count: number;
  first_trade_at: number | null;
  last_trade_at: number | null;
}

interface D1SwapRow {
  txid: string;
  sender: string;
  contract_id: string;
  function_name: string;
  token_in: string;
  amount_in: number;
  token_out: string;
  amount_out: number;
  burn_block_time: number;
  tx_status: string;
  source: string;
  scored_value: number | null;
  scored_at: string | null;
}

function mapStatusRow(stxAddress: string, row: D1StatusRow | null): CompetitionStatusRow {
  if (!row) {
    return {
      address: stxAddress,
      agent_id: null,
      registered: false,
      trade_count: 0,
      verified_trade_count: 0,
      first_trade_at: null,
      last_trade_at: null,
    };
  }
  return {
    address: row.address,
    agent_id: row.agent_id ?? null,
    registered: row.registered === 1,
    trade_count: row.trade_count ?? 0,
    verified_trade_count: row.verified_trade_count ?? 0,
    first_trade_at: row.first_trade_at ?? null,
    last_trade_at: row.last_trade_at ?? null,
  };
}

function mapSwapRow(row: D1SwapRow): SwapRow {
  return {
    txid: row.txid,
    sender: row.sender,
    contract_id: row.contract_id,
    function_name: row.function_name,
    token_in: row.token_in,
    amount_in: row.amount_in,
    token_out: row.token_out,
    amount_out: row.amount_out,
    burn_block_time: row.burn_block_time,
    tx_status: row.tx_status,
    source: row.source as SwapRow["source"],
    scored_value: row.scored_value ?? null,
    scored_at: row.scored_at ?? null,
  };
}

/**
 * Fetch the trading-comp status row for a given STX address.
 *
 * Joins registered_wallets (membership) + agents (agent_id) + swaps (counts).
 * Returns a synthesized "unregistered" row when the address is not in
 * registered_wallets — do NOT 404 from the route on this case.
 *
 * SQL shape (locked, per PHASE-3.1-HANDOFF.md):
 *   SELECT rw.stx_address, a.erc8004_agent_id, 1 AS registered,
 *          COUNT(s.txid), SUM(... success ...),
 *          MIN(burn_block_time), MAX(burn_block_time)
 *   FROM registered_wallets rw
 *   JOIN agents a ON a.stx_address = rw.stx_address
 *   LEFT JOIN swaps s ON s.sender = rw.stx_address
 *   WHERE rw.stx_address = ?1
 *   GROUP BY rw.stx_address, a.erc8004_agent_id
 */
export async function getCompetitionStatusFromD1(
  db: D1Database,
  stxAddress: string
): Promise<CompetitionStatusRow> {
  const sql = `
    SELECT
      rw.stx_address AS address,
      a.erc8004_agent_id AS agent_id,
      1 AS registered,
      COUNT(s.txid) AS trade_count,
      SUM(CASE WHEN s.tx_status = 'success' THEN 1 ELSE 0 END) AS verified_trade_count,
      MIN(s.burn_block_time) AS first_trade_at,
      MAX(s.burn_block_time) AS last_trade_at
    FROM registered_wallets rw
    JOIN agents a ON a.stx_address = rw.stx_address
    LEFT JOIN swaps s ON s.sender = rw.stx_address
    WHERE rw.stx_address = ?1
    GROUP BY rw.stx_address, a.erc8004_agent_id
  `;

  const row = await db.prepare(sql).bind(stxAddress).first<D1StatusRow>();
  return mapStatusRow(stxAddress, row);
}

/**
 * Opaque cursor over (burn_block_time, txid). The wire format is
 * base64url(JSON.stringify({ t: burn_block_time, x: txid })).
 *
 * Decoded form is internal — callers pass the raw cursor string to
 * listSwapsFromD1 which decodes once.
 */
export interface SwapsCursor {
  t: number;
  x: string;
}

function base64urlEncode(input: string): string {
  // Worker runtime has btoa; use it for tree-shake friendliness.
  const b64 = btoa(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  return atob(b64);
}

/**
 * Encode a (burn_block_time, txid) pair as an opaque cursor.
 * Returns null when the page is the last page (no more rows).
 */
export function encodeSwapsCursor(t: number, x: string): string {
  return base64urlEncode(JSON.stringify({ t, x }));
}

/**
 * Decode an opaque cursor back to {t, x}.
 * Throws when malformed — the route should catch and return 400.
 */
export function decodeSwapsCursor(cursor: string): SwapsCursor {
  const decoded = JSON.parse(base64urlDecode(cursor));
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    typeof decoded.t !== "number" ||
    typeof decoded.x !== "string"
  ) {
    throw new Error("Invalid cursor shape");
  }
  return { t: decoded.t, x: decoded.x };
}

/**
 * Fetch a page of swaps for an STX sender, newest first.
 *
 * Pagination is keyset over (burn_block_time DESC, txid DESC) — stable under
 * concurrent inserts (unlike OFFSET, which shifts when new rows land between
 * pages). The cursor identifies the *last* row of the previous page; rows
 * strictly less than that pair are returned.
 *
 * SQL shape (locked, per PHASE-3.1-HANDOFF.md):
 *   SELECT … FROM swaps
 *   WHERE sender = ?1
 *     AND (?2 IS NULL OR (burn_block_time, txid) < (?2, ?3))
 *   ORDER BY burn_block_time DESC, txid DESC
 *   LIMIT ?4
 *
 * Callers should request `limit + 1` semantics by examining the returned
 * length and synthesizing next_cursor only when more rows are likely; here
 * we return the page as-is and let the route layer decide.
 */
export async function listSwapsFromD1(
  db: D1Database,
  stxAddress: string,
  limit: number,
  cursor: SwapsCursor | null
): Promise<SwapRow[]> {
  const sql = `
    SELECT
      txid, sender, contract_id, function_name,
      token_in, amount_in, token_out, amount_out,
      burn_block_time, tx_status, source, scored_value, scored_at
    FROM swaps
    WHERE sender = ?1
      AND (?2 IS NULL OR (burn_block_time < ?2 OR (burn_block_time = ?2 AND txid < ?3)))
    ORDER BY burn_block_time DESC, txid DESC
    LIMIT ?4
  `;

  const result = await db
    .prepare(sql)
    .bind(stxAddress, cursor?.t ?? null, cursor?.x ?? null, limit)
    .all<D1SwapRow>();

  return (result.results ?? []).map(mapSwapRow);
}

/**
 * Count all swaps for an STX sender. Used by the route layer for
 * total-count reporting alongside the paginated trades list.
 */
export async function countSwapsFromD1(
  db: D1Database,
  stxAddress: string
): Promise<number> {
  const sql = `SELECT COUNT(*) AS cnt FROM swaps WHERE sender = ?1`;
  const row = await db.prepare(sql).bind(stxAddress).first<{ cnt: number }>();
  return row?.cnt ?? 0;
}
