/**
 * Competition scheduler catch-up sweep — walks registered_wallets and
 * re-verifies recent Hiro tx history. `verifyAndPersistSwap` applies the
 * full competition eligibility gate: registered + Genesis + ERC-8004
 * identity. Phase 3.1 PR-D.
 *
 * Pairs with the agent-submit fast path (POST /api/competition/trades):
 * agent-submit catches everything the agent does (the agent already knows
 * its own txid); this scheduler catches everything the fast path missed.
 * Both converge on the same `swaps` row via INSERT OR IGNORE on `txid` —
 * first writer wins; second writer is a no-op.
 *
 * Cost shape:
 *   - Max 100 addresses per execution. Tuned for a 15-min cadence: at the
 *     current ~430 registered wallets, the full list cycles in roughly
 *     5 runs (~75 min). Single Hiro client, single rate-limit budget.
 *   - Resume from D1 cursor (`competition_state.competition_scheduler_cursor`) so subsequent
 *     runs continue where the previous one stopped. Moved from KV to D1
 *     per @whoabuddy's #738 review note that cursor state belongs alongside
 *     the data it gates.
 *
 * Returns a structured summary for the logs:
 *   { scanned, found, inserted, alreadyKnown, rejected, rejectionReasons, pending, cursor }
 *
 * SchedulerDO owns cadence and manual refresh. No public operator endpoint
 * or shared-secret route is required.
 */

import type { Logger } from "@/lib/logging";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE } from "@/lib/identity/constants";
import { verifyAndPersistSwap, type VerifyFailureCode } from "./verify";
import { isAllowedSwap } from "./allowlist";
import {
  clearCompetitionSchedulerCursor,
  getCompetitionSchedulerCursor,
  setCompetitionSchedulerCursor,
} from "./state";

/** Per-run cap on addresses scanned. Scheduler resumes from the D1 cursor next run. */
export const COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN = 100;

/** Per-address tx history page size. */
const HIRO_TX_PAGE_LIMIT = 25;

export interface CompetitionSchedulerRejectionReasons {
  sender_not_registered: number;
  sender_not_genesis: number;
  contract_not_allowlisted: number;
  tx_not_found: number;
  tx_fetch_failed: number;
  tx_failed: number;
  before_comp_start: number;
  malformed_tx: number;
  invalid_amount: number;
  incomplete_events: number;
  db_unavailable: number;
  verify_threw: number;
}

export interface CompetitionSchedulerSummary {
  scanned: number;
  found: number;
  inserted: number;
  alreadyKnown: number;
  rejected: number;
  rejectionReasons: CompetitionSchedulerRejectionReasons;
  pending: number;
  /** Next address (stx_address) to resume from, or null if the walk wrapped. */
  cursor: string | null;
}

interface AddressTxEntry {
  tx_id?: string;
  tx_type?: string;
  contract_call?: {
    contract_id?: string;
    function_name?: string;
  };
}

function emptyRejectionReasons(): CompetitionSchedulerRejectionReasons {
  return {
    sender_not_registered: 0,
    sender_not_genesis: 0,
    contract_not_allowlisted: 0,
    tx_not_found: 0,
    tx_fetch_failed: 0,
    tx_failed: 0,
    before_comp_start: 0,
    malformed_tx: 0,
    invalid_amount: 0,
    incomplete_events: 0,
    db_unavailable: 0,
    verify_threw: 0,
  };
}

function recordRejection(
  summary: CompetitionSchedulerSummary,
  reason: VerifyFailureCode | "verify_threw"
) {
  summary.rejected++;
  summary.rejectionReasons[reason]++;
}

async function fetchAddressTxs(
  env: { HIRO_API_KEY?: string },
  stxAddress: string,
  logger?: Logger
): Promise<AddressTxEntry[]> {
  const url = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/transactions?limit=${HIRO_TX_PAGE_LIMIT}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.HIRO_API_KEY) {
    // `x-api-key` is Hiro's documented header; `x-hiro-api-key` is deprecated
    // and stopped authenticating — sending only it makes the sweep anonymous,
    // which gets 429-rate-limited on the shared Worker IP and stalls the cron.
    headers["x-api-key"] = env.HIRO_API_KEY;
    headers["x-hiro-api-key"] = env.HIRO_API_KEY;
  }

  try {
    const response = await stacksApiFetch(url, { method: "GET", headers }, { logger });
    if (!response.ok) {
      logger?.warn?.("competition.scheduler.hiro_non_ok", {
        stxAddress,
        status: response.status,
      });
      return [];
    }
    const body = (await response.json()) as { results?: AddressTxEntry[] };
    return body.results ?? [];
  } catch (err) {
    logger?.warn?.("competition.scheduler.hiro_threw", {
      stxAddress,
      error: String(err),
    });
    return [];
  }
}

/**
 * Page through registered_wallets starting from the cursor. Returns up to
 * COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN rows ordered by stx_address ASC so the cursor
 * is monotonic. When the walk wraps (no more rows after cursor), the next
 * call returns the head of the list and the cursor resets to null.
 */
async function fetchAddressPage(
  db: D1Database,
  cursor: string | null
): Promise<{ rows: { stx_address: string }[]; nextCursor: string | null }> {
  const sql = cursor
    ? `SELECT stx_address FROM registered_wallets WHERE stx_address > ?1 ORDER BY stx_address ASC LIMIT ?2`
    : `SELECT stx_address FROM registered_wallets ORDER BY stx_address ASC LIMIT ?1`;
  const stmt = cursor
    ? db.prepare(sql).bind(cursor, COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN)
    : db.prepare(sql).bind(COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN);
  const result = await stmt.all<{ stx_address: string }>();
  const rows = result.results ?? [];
  let nextCursor: string | null = null;
  if (rows.length === COMPETITION_SCHEDULER_MAX_ADDRESSES_PER_RUN) {
    nextCursor = rows[rows.length - 1].stx_address;
  }
  return { rows, nextCursor };
}

export interface RunCompetitionSchedulerOptions {
  /** Inject a custom address-history fetcher (for tests). */
  fetchAddressTxsImpl?: typeof fetchAddressTxs;
}

/**
 * Execute one scheduler sweep.
 *
 * The handoff: walk registered_wallets, fetch recent Hiro history per
 * address, filter by allowlist, submit each match via verifyAndPersistSwap
 * with source='cron'. The source label is retained for DB compatibility;
 * SchedulerDO owns cadence. The D1 cursor lets the sweep resume across runs
 * rather than always starting at the head.
 */
export async function runCompetitionScheduler(
  env: { DB: D1Database; HIRO_API_KEY?: string },
  logger?: Logger,
  options: RunCompetitionSchedulerOptions = {}
): Promise<CompetitionSchedulerSummary> {
  const txsFetcher = options.fetchAddressTxsImpl ?? fetchAddressTxs;

  const cursor = await getCompetitionSchedulerCursor(env.DB);
  const { rows, nextCursor } = await fetchAddressPage(env.DB, cursor);

  const summary: CompetitionSchedulerSummary = {
    scanned: rows.length,
    found: 0,
    inserted: 0,
    alreadyKnown: 0,
    rejected: 0,
    rejectionReasons: emptyRejectionReasons(),
    pending: 0,
    cursor: nextCursor,
  };

  for (const { stx_address } of rows) {
    const txs = await txsFetcher(env, stx_address, logger);
    for (const tx of txs) {
      if (tx.tx_type !== "contract_call") continue;
      if (!tx.contract_call?.contract_id || !tx.contract_call.function_name) continue;
      if (!isAllowedSwap(tx.contract_call.contract_id, tx.contract_call.function_name)) continue;
      if (!tx.tx_id) continue;
      summary.found++;
      try {
        const result = await verifyAndPersistSwap(env, env.DB, tx.tx_id, "cron", logger);
        if (result.status === "verified") {
          if (result.inserted) summary.inserted++;
          else summary.alreadyKnown++;
        } else if (result.status === "pending") {
          summary.pending++;
        } else {
          recordRejection(summary, result.code);
        }
      } catch (err) {
        recordRejection(summary, "verify_threw");
        logger?.warn?.("competition.scheduler.verify_threw", {
          stxAddress: stx_address,
          txid: tx.tx_id,
          error: String(err),
        });
      }
    }
  }

  // Persist next cursor. When nextCursor is null (we walked the tail),
  // clear the row so the next run starts fresh at the head.
  if (nextCursor) {
    await setCompetitionSchedulerCursor(env.DB, nextCursor);
  } else {
    await clearCompetitionSchedulerCursor(env.DB);
  }

  logger?.info?.("competition.scheduler.summary", { ...summary });
  return summary;
}
