/**
 * Anti-gaming (issue #978, Phase 2).
 *
 * Runs only on `agent_peer` earnings (inbox/bounty are already proven legit by
 * the txid match; everything else is already excluded). Flips an earning →
 * excluded when it looks like an operator paying themselves:
 *
 *  - manual override   — operator-flagged exclude/include/reclassify (any class)
 *  - alt-address       — sender & recipient agents share an `owner` (X handle)
 *  - self_funded       — sender & recipient share a first-funder address
 *  - ring              — A→B→A round-trip within 14d for a similar amount
 *
 * First-funder is immutable, so it's cached forever in `address_first_funder`:
 * at most ~2 Hiro calls per address EVER, not per transfer.
 */

import {
  EARNINGS_RING_WINDOW_SECONDS,
  EARNINGS_RING_AMOUNT_TOLERANCE,
  FIRST_FUNDER_FAILED_RETRY_MS,
  EARNING_SOURCE_CLASSES,
} from "./constants";
import { fetchTransfersPage, extractInboundTransfers } from "./ingest";
import type { Classification, InboundTransfer, SourceClass } from "./types";
import type { Logger } from "../logging";

interface AntiGamingEnv {
  DB: D1Database;
  VERIFIED_AGENTS: KVNamespace;
  HIRO_API_KEY?: string;
}

// ── First-funder lookup (cached) ─────────────────────────────────────────

interface FirstFunderResult {
  firstFunder: string | null;
  block: number | null;
  status: "ok" | "none" | "failed";
}

/** Read the address's oldest tx and take the sender of its first inbound
 *  transfer. An address's first on-chain tx is almost always its funding
 *  (you must receive before you can pay fees), so this is a reliable signal. */
async function fetchFirstFunderFromChain(
  env: AntiGamingEnv,
  address: string,
  logger: Logger
): Promise<FirstFunderResult> {
  const head = await fetchTransfersPage(env, address, 0, 1, logger);
  if (!head) return { firstFunder: null, block: null, status: "failed" };
  if (head.total === 0) return { firstFunder: null, block: null, status: "none" };

  const oldestOffset = Math.max(0, head.total - 1);
  const tail =
    oldestOffset === 0 ? head : await fetchTransfersPage(env, address, oldestOffset, 1, logger);
  if (!tail) return { firstFunder: null, block: null, status: "failed" };

  const result = tail.results[0];
  if (!result) return { firstFunder: null, block: null, status: "none" };

  const inbound = extractInboundTransfers(result, address);
  if (inbound.length === 0) {
    return { firstFunder: null, block: result.tx?.block_height ?? null, status: "none" };
  }
  return { firstFunder: inbound[0].senderStx, block: inbound[0].stxBlockHeight, status: "ok" };
}

/** Cached first-funder. Returns the funder STX (only for an 'ok' lookup), else null. */
export async function getFirstFunder(
  env: AntiGamingEnv,
  address: string,
  now: number,
  logger: Logger
): Promise<string | null> {
  const cached = await env.DB.prepare(
    `SELECT first_funder_stx, lookup_status, fetched_at
     FROM address_first_funder WHERE address = ?1`
  )
    .bind(address)
    .first<{ first_funder_stx: string | null; lookup_status: string; fetched_at: number }>();

  if (cached) {
    if (cached.lookup_status === "ok") return cached.first_funder_stx;
    if (cached.lookup_status === "none") return null;
    // 'failed' — only re-fetch once it's stale.
    if (now - cached.fetched_at < FIRST_FUNDER_FAILED_RETRY_MS) return null;
  }

  const res = await fetchFirstFunderFromChain(env, address, logger);
  await env.DB.prepare(
    `INSERT INTO address_first_funder
       (address, first_funder_stx, first_funded_block, lookup_status, fetched_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(address) DO UPDATE SET
       first_funder_stx   = excluded.first_funder_stx,
       first_funded_block = excluded.first_funded_block,
       lookup_status      = excluded.lookup_status,
       fetched_at         = excluded.fetched_at`
  )
    .bind(address, res.firstFunder, res.block, res.status, now)
    .run();

  return res.status === "ok" ? res.firstFunder : null;
}

// ── Heuristic helpers ────────────────────────────────────────────────────

async function getManualOverride(
  db: D1Database,
  txId: string,
  eventIndex: number
): Promise<{ action: string; new_source_class: string | null } | null> {
  return db
    .prepare(
      `SELECT action, new_source_class FROM earnings_manual_override
       WHERE tx_id = ?1 AND event_index = ?2`
    )
    .bind(txId, eventIndex)
    .first<{ action: string; new_source_class: string | null }>();
}

/** Both agents declare the same (non-null) owner → same operator. */
async function sharesOwner(
  db: D1Database,
  senderStx: string,
  recipientStx: string
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM agents a1 JOIN agents a2 ON lower(a1.owner) = lower(a2.owner)
       WHERE a1.stx_address = ?1 AND a2.stx_address = ?2 AND a1.owner IS NOT NULL LIMIT 1`
    )
    .bind(senderStx, recipientStx)
    .first<{ x: number }>();
  return row != null;
}

/**
 * Find the reverse leg (recipient→sender) of a potential A→B→A ring.
 *
 * The window is SYMMETRIC (±14d around this leg), not backward-only: the two
 * legs are within 14d *of each other*, and the indexer does not process them in
 * chronological order (backfill walks newest-first), so the reverse leg may be
 * either older or newer than the leg currently being indexed. A backward-only
 * window would silently miss every ring discovered during backfill.
 */
async function findReverseLeg(
  db: D1Database,
  transfer: InboundTransfer
): Promise<{ tx_id: string; event_index: number } | null> {
  const windowStart = transfer.blockTime - EARNINGS_RING_WINDOW_SECONDS;
  const windowEnd = transfer.blockTime + EARNINGS_RING_WINDOW_SECONDS;
  const lo = Math.floor(transfer.amountRaw * (1 - EARNINGS_RING_AMOUNT_TOLERANCE));
  const hi = Math.ceil(transfer.amountRaw * (1 + EARNINGS_RING_AMOUNT_TOLERANCE));
  return db
    .prepare(
      `SELECT tx_id, event_index FROM agent_earnings
       WHERE recipient_agent_stx = ?1 AND sender_stx = ?2 AND asset = ?3
         AND amount_raw BETWEEN ?4 AND ?5
         AND block_time BETWEEN ?6 AND ?7
       LIMIT 1`
    )
    .bind(
      transfer.senderStx, // the reverse leg's recipient is this leg's sender
      transfer.recipientAgentStx, // …and its sender is this leg's recipient
      transfer.asset,
      lo,
      hi,
      windowStart,
      windowEnd
    )
    .first<{ tx_id: string; event_index: number }>();
}

async function markRing(db: D1Database, tx_id: string, event_index: number): Promise<void> {
  await db
    .prepare(
      `UPDATE agent_earnings SET excluded_reason = 'ring', is_earning = 0
       WHERE tx_id = ?1 AND event_index = ?2`
    )
    .bind(tx_id, event_index)
    .run();
}

// ── Orchestration ────────────────────────────────────────────────────────

function exclude(c: Classification, reason: Classification["excludedReason"]): Classification {
  return { ...c, excludedReason: reason, isEarning: false };
}

/**
 * Apply anti-gaming to a freshly-classified transfer. Manual overrides apply to
 * any class; the heuristics only touch `agent_peer` earnings.
 */
export async function applyAntiGaming(
  env: AntiGamingEnv,
  transfer: InboundTransfer,
  classification: Classification,
  now: number,
  logger: Logger
): Promise<Classification> {
  const db = env.DB;

  // Manual override wins over everything.
  const override = await getManualOverride(db, transfer.txId, transfer.eventIndex);
  if (override) {
    if (override.action === "exclude") return exclude(classification, "excluded_manual");
    if (override.action === "include") {
      return { ...classification, excludedReason: null, isEarning: true };
    }
    if (override.action === "reclassify" && override.new_source_class) {
      const sc = override.new_source_class as SourceClass;
      const isEarning = (EARNING_SOURCE_CLASSES as readonly string[]).includes(sc);
      return {
        sourceClass: sc,
        sourceSubclass: classification.sourceSubclass,
        excludedReason: isEarning ? null : "excluded_manual",
        isEarning,
      };
    }
  }

  // Heuristics only apply to agent→agent earnings.
  if (classification.sourceClass !== "agent_peer" || !classification.isEarning) {
    return classification;
  }

  // Alt-address: same operator per public metadata.
  if (await sharesOwner(db, transfer.senderStx, transfer.recipientAgentStx)) {
    return exclude(classification, "self_funded");
  }

  // Self-funded: shared first-funder. Only excludes on two confident 'ok' lookups.
  const [senderFunder, recipientFunder] = await Promise.all([
    getFirstFunder(env, transfer.senderStx, now, logger),
    getFirstFunder(env, transfer.recipientAgentStx, now, logger),
  ]);
  if (senderFunder && recipientFunder && senderFunder === recipientFunder) {
    return exclude(classification, "self_funded");
  }

  // Ring: a prior reverse leg exists → exclude both legs.
  const reverse = await findReverseLeg(db, transfer);
  if (reverse) {
    await markRing(db, reverse.tx_id, reverse.event_index);
    return exclude(classification, "ring");
  }

  return classification;
}
