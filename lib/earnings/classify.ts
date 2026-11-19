/**
 * Counterparty classification (issue #978, Phase 1).
 *
 * Classification is txid-based against our OWN D1 records (not on-chain memos):
 * a confirmed inbox payment, or a paid bounty whose winner is the recipient.
 * Falls back to sender-is-a-registered-agent (agent_peer), else unclassified.
 *
 * x402_endpoint is intentionally inert: no enumerable x402 payTo catalog exists
 * (per-agent dynamic payTo), so it cannot be distinguished here. inbox_message +
 * bounty + agent_peer give the 3 active classifiers the #978 DoD requires.
 *
 * NOTE: agent_peer counts every agent→agent inflow as an earning in Phase 1.
 * The self_funded / ring exclusions land in Phase 2 (anti-gaming) before any of
 * this is exposed via the public API (Phase 3).
 */

import type { Classification, InboundTransfer, SourceClass } from "./types";

function earning(
  sourceClass: SourceClass,
  sourceSubclass: string | null
): Classification {
  return { sourceClass, sourceSubclass, excludedReason: null, isEarning: true };
}

export async function classifyTransfer(
  db: D1Database,
  transfer: InboundTransfer
): Promise<Classification> {
  // 1. inbox_message — txid matches a confirmed inbound inbox payment to this agent.
  const inbox = await db
    .prepare(
      `SELECT message_id FROM inbox_messages
       WHERE payment_txid = ?1 AND payment_status = 'confirmed' AND to_stx_address = ?2
       LIMIT 1`
    )
    .bind(transfer.txId, transfer.recipientAgentStx)
    .first<{ message_id: string }>();
  if (inbox) return earning("inbox_message", inbox.message_id);

  // 2. bounty — txid is a verified bounty payout to this agent. Every member
  // of a winning team is paid (and recorded) on their own row, so each one is
  // credited with their own transfer, never with the lead's.
  // Bounties pay in sBTC, and the transfer must be the recorded payout
  // amount: another transfer to the member inside the same payout tx is not
  // bounty income and goes through the agent_peer anti-gaming checks below.
  // (Rows backfilled from before the amount was stored match on txid alone.)
  const isSbtc = transfer.asset === "sbtc";
  const bounty = isSbtc
    ? await db
        .prepare(
          `SELECT bounty_id AS id FROM bounty_submission_members
           WHERE paid_txid = ?1 AND member_stx_address = ?2
             AND (paid_amount_sats = ?3 OR paid_amount_sats IS NULL)
           ORDER BY paid_amount_sats IS NULL
           LIMIT 1`
        )
        .bind(transfer.txId, transfer.recipientAgentStx, transfer.amountRaw)
        .first<{ id: string }>()
    : null;
  if (bounty) return earning("bounty", bounty.id);

  // 3. agent_peer — sender is another registered agent.
  const peer = await db
    .prepare(`SELECT 1 AS x FROM agents WHERE stx_address = ?1 LIMIT 1`)
    .bind(transfer.senderStx)
    .first<{ x: number }>();
  if (peer) return earning("agent_peer", null);

  // 4. x402_endpoint — inert (no payTo catalog). Skipped.

  // 5. Unmatched → unclassified, excluded from earnings (surfaced for review).
  //    exchange_or_external requires a seeded known-funder list (Phase 2+).
  return {
    sourceClass: "unclassified",
    sourceSubclass: null,
    excludedReason: "unclassified",
    isEarning: false,
  };
}
