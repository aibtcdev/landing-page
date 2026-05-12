/**
 * Single-tx verifier for the trading-comp surface.
 *
 * `verifyAndPersistSwap` is the shared entry point used by the ingestion
 * paths (agent-submit POST and SchedulerDO catch-up). It takes a
 * txid, fetches the Hiro tx, runs sender + allowlist checks, parses the
 * swap, and persists via INSERT OR IGNORE (first writer wins on `(txid)`).
 *
 * Phase 3.1 PR-B — agent-submit POST is the first caller. SchedulerDO reuses
 * the same function with a different `source`.
 *
 * Return shape is a discriminated result so callers can map it to:
 *   - 200 with the persisted row (verified / idempotent re-submission)
 *   - 202 with { accepted: true } when the tx is still pending.
 *   - 4xx structured rejection (sender_not_registered, contract_not_allowlisted,
 *     tx_failed, malformed)
 *
 * The handoff hard constraint: NO row is ever written to `swaps` for a
 * pending/in-flight tx. Migration 005 forbids it.
 */

import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import type { Logger } from "@/lib/logging";
import { STACKS_API_BASE } from "@/lib/identity/constants";
import { isAllowedSwap } from "./allowlist";
import { COMP_START_TIMESTAMP } from "./constants";
import { parseSwapFromTx, type HiroTxForSwap } from "./parse";
import type { SwapRow } from "./d1-reads";

/** The Stacks tx_status values that mean "still in flight; no row should be written". */
const PENDING_STATUSES = new Set<string>(["pending"]);

/** Terminal tx_status values accepted by the swaps table CHECK constraint. */
const TERMINAL_STATUSES = new Set<string>([
  "success",
  "abort_by_response",
  "abort_by_post_condition",
  "dropped_replace_by_fee",
  "dropped_replace_across_fork",
  "dropped_too_expensive",
  "dropped_stale_garbage_collect",
  "dropped_problematic",
]);

export type VerifyFailureCode =
  | "sender_not_registered"
  | "contract_not_allowlisted"
  | "tx_not_found"
  | "tx_fetch_failed"
  | "tx_failed"
  | "before_comp_start"
  | "malformed_tx"
  | "invalid_amount"
  | "incomplete_events"
  | "db_unavailable";

export type VerifyResult =
  | { status: "verified"; inserted: boolean; row: SwapRow }
  | { status: "pending" }
  | { status: "rejected"; code: VerifyFailureCode; reason: string };

export interface VerifyEnv {
  HIRO_API_KEY?: string;
}

interface PersistArgs {
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
  source: SwapRow["source"];
  raw_event_json: string;
}

/**
 * Look up a sender in the registered_wallets view.
 * Sender check is the first cheap gate before any Hiro round-trip would
 * normally apply — but in our flow we already have the tx fetched, so this
 * runs after the fetch. Keeping it as a SELECT 1 not a JOIN keeps the
 * shape ergonomic for scheduler callers that may want to batch.
 */
async function senderIsRegistered(
  db: D1Database,
  stxAddress: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM registered_wallets WHERE stx_address = ?1`)
    .bind(stxAddress)
    .first<{ ok: number }>();
  return Boolean(row);
}

async function insertSwap(
  db: D1Database,
  args: PersistArgs
): Promise<{ inserted: boolean }> {
  const sql = `
    INSERT OR IGNORE INTO swaps (
      txid, sender, contract_id, function_name,
      token_in, amount_in, token_out, amount_out,
      burn_block_time, tx_status, source, raw_event_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const meta = await db
    .prepare(sql)
    .bind(
      args.txid,
      args.sender,
      args.contract_id,
      args.function_name,
      args.token_in,
      args.amount_in,
      args.token_out,
      args.amount_out,
      args.burn_block_time,
      args.tx_status,
      args.source,
      args.raw_event_json
    )
    .run();
  return { inserted: (meta.meta?.changes ?? 0) > 0 };
}

async function readSwap(
  db: D1Database,
  txid: string
): Promise<SwapRow | null> {
  const sql = `
    SELECT
      txid, sender, contract_id, function_name,
      token_in, amount_in, token_out, amount_out,
      burn_block_time, tx_status, source, scored_value, scored_at
    FROM swaps
    WHERE txid = ?1
  `;
  const row = await db.prepare(sql).bind(txid).first<{
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
  }>();
  if (!row) return null;
  return {
    ...row,
    source: row.source as SwapRow["source"],
  };
}

/**
 * Fetch a tx by id from Hiro. Returns a tagged result so the verifier can
 * distinguish "Hiro is down" (retryable) from "tx genuinely not found".
 */
export async function fetchTxFromHiro(
  env: VerifyEnv,
  txid: string,
  logger?: Logger
): Promise<
  | { ok: true; tx: HiroTxForSwap }
  | { ok: false; code: "tx_not_found" | "tx_fetch_failed"; reason: string }
> {
  const url = `${STACKS_API_BASE}/extended/v1/tx/${txid}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.HIRO_API_KEY) headers["x-hiro-api-key"] = env.HIRO_API_KEY;

  let response: Response;
  try {
    response = await stacksApiFetch(url, { method: "GET", headers }, { logger });
  } catch (err) {
    return {
      ok: false,
      code: "tx_fetch_failed",
      reason: `Hiro fetch error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (response.status === 404) {
    return { ok: false, code: "tx_not_found", reason: `Hiro returned 404 for ${txid}` };
  }
  if (!response.ok) {
    return {
      ok: false,
      code: "tx_fetch_failed",
      reason: `Hiro returned ${response.status}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      code: "tx_fetch_failed",
      reason: `Hiro response JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  return { ok: true, tx: body as HiroTxForSwap };
}

/**
 * Verify a single txid and persist it to D1 if it represents an allowlisted
 * swap by a registered sender. See module docstring for the contract.
 */
export async function verifyAndPersistSwap(
  env: VerifyEnv,
  db: D1Database,
  txid: string,
  source: SwapRow["source"],
  logger?: Logger
): Promise<VerifyResult> {
  // D1 readSwap runs FIRST — if the row already exists (idempotent
  // re-submission OR another ingestion path wrote it), short-circuit
  // before the Hiro fetch. Saves the wasted upstream call on every
  // duplicate submit and lets the route layer return 409 Conflict
  // promptly. The route is responsible for translating
  // { inserted: false } into a 409 with the existing_row payload.
  let existing: SwapRow | null = null;
  try {
    existing = await readSwap(db, txid);
  } catch (err) {
    logger?.warn?.("competition.verify.read_existing_failed", {
      error: String(err),
      txid,
    });
    return {
      status: "rejected",
      code: "db_unavailable",
      reason: `D1 read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (existing) {
    return { status: "verified", inserted: false, row: existing };
  }

  const fetchRes = await fetchTxFromHiro(env, txid, logger);
  if (!fetchRes.ok) {
    return { status: "rejected", code: fetchRes.code, reason: fetchRes.reason };
  }
  const tx = fetchRes.tx;

  if (PENDING_STATUSES.has(tx.tx_status)) {
    return { status: "pending" };
  }
  if (!TERMINAL_STATUSES.has(tx.tx_status)) {
    return {
      status: "rejected",
      code: "malformed_tx",
      reason: `Unknown tx_status '${tx.tx_status}'`,
    };
  }

  // Success-only gate per the comp spec (whoabuddy's reframing on the
  // attribution gist: "assert tx_status == success"). Non-success terminal
  // statuses — abort_by_response, abort_by_post_condition, dropped_* — are
  // schema-allowed in `swaps` for future-proofing but do NOT count toward
  // the competition. Reject before doing any further work (parse, FK check,
  // DB write); the schema's 8-status CHECK constraint stays so we can opt
  // in to recording failed attempts later without a migration.
  if (tx.tx_status !== "success") {
    return {
      status: "rejected",
      code: "tx_failed",
      reason: `Transaction reached terminal status '${tx.tx_status}' (not success). Failed swaps do not count toward the competition.`,
    };
  }

  // Comp-start gate. Trades whose burn_block_time predates the campaign
  // window do not count, regardless of other validity. Reject before the
  // sender / allowlist / parse stages so the scheduler catch-up pass can't
  // backfill pre-campaign history into `swaps` either.
  const txBurnTime = tx.burn_block_time ?? 0;
  if (txBurnTime < COMP_START_TIMESTAMP) {
    return {
      status: "rejected",
      code: "before_comp_start",
      reason: `Trade burn_block_time ${txBurnTime} is before competition start ${COMP_START_TIMESTAMP}.`,
    };
  }

  // Sender + allowlist gates. The allowlist check depends on a parsed
  // contract_call — fail fast if the tx isn't a contract call at all.
  if (tx.tx_type !== "contract_call" || !tx.contract_call) {
    return {
      status: "rejected",
      code: "malformed_tx",
      reason: `tx_type is '${tx.tx_type}'; expected contract_call`,
    };
  }

  const sender = tx.sender_address;
  let registered: boolean;
  try {
    registered = await senderIsRegistered(db, sender);
  } catch (err) {
    return {
      status: "rejected",
      code: "db_unavailable",
      reason: `D1 read failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!registered) {
    return {
      status: "rejected",
      code: "sender_not_registered",
      reason: `Sender ${sender} is not in registered_wallets`,
    };
  }

  if (!isAllowedSwap(tx.contract_call.contract_id, tx.contract_call.function_name)) {
    return {
      status: "rejected",
      code: "contract_not_allowlisted",
      reason: `Contract+function ${tx.contract_call.contract_id}::${tx.contract_call.function_name} not on competition allowlist`,
    };
  }

  const parseRes = parseSwapFromTx(tx);
  if (!parseRes.ok) {
    return {
      status: "rejected",
      code: parseRes.code === "invalid_amount" ? "invalid_amount" : "incomplete_events",
      reason: parseRes.reason,
    };
  }

  const burn_block_time = tx.burn_block_time ?? 0;

  const persistArgs: PersistArgs = {
    txid,
    sender,
    contract_id: parseRes.swap.contract_id,
    function_name: parseRes.swap.function_name,
    token_in: parseRes.swap.token_in,
    amount_in: parseRes.swap.amount_in,
    token_out: parseRes.swap.token_out,
    amount_out: parseRes.swap.amount_out,
    burn_block_time,
    tx_status: tx.tx_status,
    source,
    raw_event_json: parseRes.swap.raw_event_json,
  };

  let insertRes: { inserted: boolean };
  try {
    insertRes = await insertSwap(db, persistArgs);
  } catch (err) {
    return {
      status: "rejected",
      code: "db_unavailable",
      reason: `D1 insert failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!insertRes.inserted) {
    // Race: another path wrote the row between our readSwap and INSERT OR IGNORE.
    // Re-read so the caller sees the canonical row (with the winning source).
    let after: SwapRow | null = null;
    try {
      after = await readSwap(db, txid);
    } catch (err) {
      logger?.warn?.("competition.verify.read_after_insert_failed", {
        error: String(err),
        txid,
      });
    }
    if (after) {
      return { status: "verified", inserted: false, row: after };
    }
    // Should never happen — log + return the row we attempted to write so
    // the caller still gets a useful payload.
    logger?.warn?.("competition.verify.insert_skip_no_existing", { txid });
  }

  return {
    status: "verified",
    inserted: insertRes.inserted,
    row: {
      txid,
      sender,
      contract_id: persistArgs.contract_id,
      function_name: persistArgs.function_name,
      token_in: persistArgs.token_in,
      amount_in: persistArgs.amount_in,
      token_out: persistArgs.token_out,
      amount_out: persistArgs.amount_out,
      burn_block_time: persistArgs.burn_block_time,
      tx_status: persistArgs.tx_status,
      source: persistArgs.source,
      scored_value: null,
      scored_at: null,
    },
  };
}
