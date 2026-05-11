/**
 * 15-min catch-up cron — walks registered_wallets and re-verifies recent
 * Hiro tx history. Phase 3.1 PR-D.
 *
 * Pairs with the agent-submit fast path (POST /api/competition/trades):
 * agent-submit catches everything the agent does (the agent already knows
 * its own txid); this cron catches everything the fast path missed.
 * Both converge on the same `swaps` row via INSERT OR IGNORE on `txid` —
 * first writer wins; second writer is a no-op.
 *
 * Cost shape:
 *   - Max 100 addresses per execution. Tuned for a 15-min cadence: at the
 *     current ~430 registered wallets, the full list cycles in roughly
 *     5 runs (~75 min). Single Hiro client, single rate-limit budget.
 *   - Resume from KV cursor `comp:cron:cursor` so subsequent runs continue
 *     where the previous one stopped rather than retrying the head N times.
 *
 * Returns a structured summary for the logs:
 *   { scanned, found, inserted, alreadyKnown, rejected, pending, cursor }
 *
 * The wrangler scheduled trigger registration (and the bridge from the
 * Worker's scheduled() entrypoint to this code) is infrastructure wiring
 * tracked as a follow-up — the route is callable directly via HTTPS with
 * a shared-secret header for now.
 */

import type { Logger } from "@/lib/logging";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE } from "@/lib/identity/constants";
import { verifyAndPersistSwap } from "./verify";
import { isAllowedSwap } from "./allowlist";

/** Per-run cap on addresses scanned. Cron resumes from the KV cursor next run. */
export const CRON_MAX_ADDRESSES_PER_RUN = 100;
export const CRON_CURSOR_KV_KEY = "comp:cron:cursor";

/** Per-address tx history page size. */
const HIRO_TX_PAGE_LIMIT = 25;

export interface CronSummary {
  scanned: number;
  found: number;
  inserted: number;
  alreadyKnown: number;
  rejected: number;
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

async function fetchAddressTxs(
  env: { HIRO_API_KEY?: string },
  stxAddress: string,
  logger?: Logger
): Promise<AddressTxEntry[]> {
  const url = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/transactions?limit=${HIRO_TX_PAGE_LIMIT}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.HIRO_API_KEY) headers["x-hiro-api-key"] = env.HIRO_API_KEY;

  try {
    const response = await stacksApiFetch(url, { method: "GET", headers }, { logger });
    if (!response.ok) {
      logger?.warn?.("competition.cron.hiro_non_ok", {
        stxAddress,
        status: response.status,
      });
      return [];
    }
    const body = (await response.json()) as { results?: AddressTxEntry[] };
    return body.results ?? [];
  } catch (err) {
    logger?.warn?.("competition.cron.hiro_threw", {
      stxAddress,
      error: String(err),
    });
    return [];
  }
}

/**
 * Page through registered_wallets starting from the cursor. Returns up to
 * CRON_MAX_ADDRESSES_PER_RUN rows ordered by stx_address ASC so the cursor
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
    ? db.prepare(sql).bind(cursor, CRON_MAX_ADDRESSES_PER_RUN)
    : db.prepare(sql).bind(CRON_MAX_ADDRESSES_PER_RUN);
  const result = await stmt.all<{ stx_address: string }>();
  const rows = result.results ?? [];
  let nextCursor: string | null = null;
  if (rows.length === CRON_MAX_ADDRESSES_PER_RUN) {
    nextCursor = rows[rows.length - 1].stx_address;
  }
  return { rows, nextCursor };
}

export interface RunCronOptions {
  /** Override the KV cursor key. Used by tests for isolation. */
  cursorKey?: string;
  /** Inject a custom address-history fetcher (for tests). */
  fetchAddressTxsImpl?: typeof fetchAddressTxs;
}

/**
 * Execute one cron sweep.
 *
 * The handoff: walk registered_wallets, fetch recent Hiro history per
 * address, filter by allowlist, submit each match via verifyAndPersistSwap
 * with source='cron'. The KV cursor lets the sweep resume across runs
 * rather than always starting at the head.
 */
export async function runCompetitionCron(
  env: { DB: D1Database; VERIFIED_AGENTS: KVNamespace; HIRO_API_KEY?: string },
  logger?: Logger,
  options: RunCronOptions = {}
): Promise<CronSummary> {
  const cursorKey = options.cursorKey ?? CRON_CURSOR_KV_KEY;
  const txsFetcher = options.fetchAddressTxsImpl ?? fetchAddressTxs;

  const cursor = (await env.VERIFIED_AGENTS.get(cursorKey)) ?? null;
  const { rows, nextCursor } = await fetchAddressPage(env.DB, cursor);

  const summary: CronSummary = {
    scanned: rows.length,
    found: 0,
    inserted: 0,
    alreadyKnown: 0,
    rejected: 0,
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
          summary.rejected++;
        }
      } catch (err) {
        summary.rejected++;
        logger?.warn?.("competition.cron.verify_threw", {
          stxAddress: stx_address,
          txid: tx.tx_id,
          error: String(err),
        });
      }
    }
  }

  // Persist next cursor. When nextCursor is null (we walked the tail),
  // delete the key so the next run starts fresh at the head.
  if (nextCursor) {
    await env.VERIFIED_AGENTS.put(cursorKey, nextCursor);
  } else {
    await env.VERIFIED_AGENTS.delete(cursorKey);
  }

  logger?.info?.("competition.cron.summary", { ...summary });
  return summary;
}
