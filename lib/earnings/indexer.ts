/**
 * Earnings sweep orchestrator (issue #978, Phase 1).
 *
 * One cron tick: take the next slice of agents (round-robin cursor over
 * registered_wallets), and for each, either backfill history (bounded
 * pages/tick) or process only NEW txs since its high-water mark. Classify +
 * price + idempotently persist. Indexer-only — no agent self-report.
 *
 * Gated by EARNINGS_INDEX_ENABLED so it ships dormant and can be killed
 * instantly. Concurrency is bounded under Cloudflare's 6-connection cap.
 */

import {
  EARNINGS_MAX_AGENTS_PER_RUN,
  EARNINGS_FETCH_CONCURRENCY,
  EARNINGS_HIRO_PAGE_LIMIT,
  EARNINGS_MAX_PAGES_PER_AGENT,
  EARNING_SOURCE_CLASSES,
  EXCLUDED_SOURCE_CLASSES,
} from "./constants";
import {
  fetchTransfersPage,
  extractInboundTransfers,
  maxBlockHeight,
} from "./ingest";
import { classifyTransfer } from "./classify";
import { priceTransfer } from "./price";
import { applyAntiGaming } from "./anti-gaming";
import {
  getIndexState,
  setIndexState,
  persistEarningRows,
  getEarningsCursor,
  setEarningsCursor,
  fetchAgentPage,
} from "./d1";
import type {
  EarningRow,
  EarningsSweepSummary,
  InboundTransfer,
  SourceClass,
} from "./types";
import type { Logger } from "../logging";

interface EarningsEnv {
  DB: D1Database;
  VERIFIED_AGENTS: KVNamespace;
  HIRO_API_KEY?: string;
  EARNINGS_INDEX_ENABLED?: string;
  DEPLOY_ENV?: string;
}

interface AgentResult {
  transfersFound: number;
  inserted: number;
  alreadyKnown: number;
  earningRows: number;
  excludedRows: number;
  hiroCalls: number;
  bySourceClass: Record<SourceClass, number>;
}

// Derived from the source-class constants so a new class added in a later
// phase is counted automatically instead of being silently dropped.
function zeroBySource(): Record<SourceClass, number> {
  const out = {} as Record<SourceClass, number>;
  for (const c of [...EARNING_SOURCE_CLASSES, ...EXCLUDED_SOURCE_CLASSES]) {
    out[c] = 0;
  }
  return out;
}

async function resolveRow(
  env: EarningsEnv,
  transfer: InboundTransfer,
  now: number,
  logger: Logger
): Promise<EarningRow> {
  // Classification (D1 reads) and pricing (KV read) are independent — overlap them.
  const [classification, pricing] = await Promise.all([
    classifyTransfer(env.DB, transfer),
    priceTransfer(env.VERIFIED_AGENTS, transfer, now),
  ]);
  // Anti-gaming (Phase 2) can flip an agent_peer earning → excluded.
  const finalClassification = await applyAntiGaming(env, transfer, classification, now, logger);
  return { ...transfer, ...finalClassification, ...pricing, indexedAt: now };
}

/** Bounded-concurrency map (caps simultaneous outgoing connections at `n`). */
async function mapPool<T, R>(
  items: T[],
  n: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, () => worker())
  );
  return results;
}

async function indexAgent(
  env: EarningsEnv,
  agentStx: string,
  // Earnings floor: only inflows at/after the agent's registration count.
  // Excludes pre-platform history (esp. agent_peer transfers between addresses
  // that only later registered) and lets backfill stop at registration instead
  // of walking to genesis. 0 = no floor (all-time fallback when verified_at is
  // missing).
  verifiedAtSec: number,
  logger: Logger,
  now: number
): Promise<AgentResult> {
  const { DB: db } = env;
  const state = await getIndexState(db, agentStx);

  const rows: EarningRow[] = [];
  let transfersFound = 0;
  let hiroCalls = 0;
  let maxBlock = state.lastIndexedBlock;
  let backfillOffset = state.backfillOffset;
  let backfillComplete = state.backfillComplete;

  const collect = async (results: Awaited<ReturnType<typeof fetchTransfersPage>>) => {
    if (!results) return;
    for (const result of results.results) {
      const transfers = extractInboundTransfers(result, agentStx);
      for (const t of transfers) {
        if (t.blockTime < verifiedAtSec) continue; // pre-registration → not earnings
        rows.push(await resolveRow(env, t, now, logger));
        transfersFound++;
      }
    }
    maxBlock = Math.max(maxBlock, maxBlockHeight(results.results));
  };

  // True once a page reaches transactions older than registration — since pages
  // are newest-first, everything beyond is pre-join and can be skipped.
  const reachedPreJoin = (results: Awaited<ReturnType<typeof fetchTransfersPage>>): boolean =>
    !!results &&
    results.results.some((r) => {
      const t = r.tx?.burn_block_time ?? 0;
      return t > 0 && t < verifiedAtSec;
    });

  if (!backfillComplete) {
    // Backfill: walk older pages from the saved offset, bounded per tick.
    let offset = backfillOffset;
    for (let p = 0; p < EARNINGS_MAX_PAGES_PER_AGENT; p++) {
      const page = await fetchTransfersPage(env, agentStx, offset, EARNINGS_HIRO_PAGE_LIMIT, logger);
      hiroCalls++;
      if (!page) break;
      await collect(page);
      offset += page.results.length;
      backfillOffset = offset;
      if (page.exhausted || reachedPreJoin(page)) {
        backfillComplete = true;
        backfillOffset = 0;
        break;
      }
    }
  } else {
    // Incremental: page newest-first, stop once we reach already-indexed blocks.
    let offset = 0;
    for (let p = 0; p < EARNINGS_MAX_PAGES_PER_AGENT; p++) {
      const page = await fetchTransfersPage(env, agentStx, offset, EARNINGS_HIRO_PAGE_LIMIT, logger);
      hiroCalls++;
      if (!page) break;
      const reachedKnown = page.results.some(
        (r) => (r.tx?.block_height ?? 0) <= state.lastIndexedBlock
      );
      // Only collect txs strictly newer than the high-water mark.
      const fresh = {
        ...page,
        results: page.results.filter((r) => (r.tx?.block_height ?? 0) > state.lastIndexedBlock),
      };
      await collect(fresh);
      offset += page.results.length;
      if (reachedKnown || page.exhausted) break;
    }
  }

  const { inserted, alreadyKnown } = await persistEarningRows(db, rows);
  await setIndexState(
    db,
    agentStx,
    { lastIndexedBlock: maxBlock, backfillOffset, backfillComplete },
    now
  );

  const bySourceClass = zeroBySource();
  let earningRows = 0;
  let excludedRows = 0;
  for (const r of rows) {
    bySourceClass[r.sourceClass]++;
    if (r.isEarning) earningRows++;
    else excludedRows++;
  }

  return { transfersFound, inserted, alreadyKnown, earningRows, excludedRows, hiroCalls, bySourceClass };
}

function emptySummary(enabled: boolean, cursor: string | null): EarningsSweepSummary {
  return {
    enabled,
    agentsScanned: 0,
    transfersFound: 0,
    inserted: 0,
    alreadyKnown: 0,
    earningRows: 0,
    excludedRows: 0,
    hiroCalls: 0,
    bySourceClass: zeroBySource(),
    cursor,
  };
}

export async function runEarningsSweep(
  env: EarningsEnv,
  logger: Logger,
  now: number = Date.now(),
  // `force` bypasses the EARNINGS_INDEX_ENABLED gate — used by the admin
  // refresh endpoint so an operator can verify a sweep without enabling the
  // always-on cron. The cron path never forces.
  force: boolean = false
): Promise<EarningsSweepSummary> {
  if (!force && env.EARNINGS_INDEX_ENABLED !== "true") {
    logger.info("earnings.skipped_disabled", {
      deployEnv: env.DEPLOY_ENV ?? "unset",
      earningsIndexEnabled: env.EARNINGS_INDEX_ENABLED ?? "unset",
    });
    return emptySummary(false, null);
  }

  const db = env.DB;
  const cursor = await getEarningsCursor(db);
  const agents = await fetchAgentPage(db, cursor, EARNINGS_MAX_AGENTS_PER_RUN);

  if (agents.length === 0) {
    // End of the roster — wrap the cursor back to the start for the next cycle.
    await setEarningsCursor(db, null);
    logger.info("earnings.cycle_complete", { fromCursor: cursor });
    return emptySummary(true, null);
  }

  const perAgent = await mapPool(agents, EARNINGS_FETCH_CONCURRENCY, (a) =>
    indexAgent(env, a.stxAddress, a.verifiedAtSec, logger, now)
  );

  const summary = emptySummary(true, null);
  summary.agentsScanned = agents.length;
  for (const r of perAgent) {
    summary.transfersFound += r.transfersFound;
    summary.inserted += r.inserted;
    summary.alreadyKnown += r.alreadyKnown;
    summary.earningRows += r.earningRows;
    summary.excludedRows += r.excludedRows;
    summary.hiroCalls += r.hiroCalls;
    for (const k of Object.keys(summary.bySourceClass) as SourceClass[]) {
      summary.bySourceClass[k] += r.bySourceClass[k];
    }
  }

  // Advance the cursor; a short page means we hit the end → wrap next tick.
  const nextCursor =
    agents.length === EARNINGS_MAX_AGENTS_PER_RUN
      ? agents[agents.length - 1].stxAddress
      : null;
  await setEarningsCursor(db, nextCursor);
  summary.cursor = nextCursor;

  logger.info("earnings.sweep_complete", {
    agentsScanned: summary.agentsScanned,
    transfersFound: summary.transfersFound,
    inserted: summary.inserted,
    earningRows: summary.earningRows,
    hiroCalls: summary.hiroCalls,
    cursor: summary.cursor,
  });

  return summary;
}
