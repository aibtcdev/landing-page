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

  // 2. bounty — txid matches a paid bounty whose accepted winner is this agent.
  const bounty = await db
    .prepare(
      `SELECT b.id FROM bounties b
       JOIN bounty_submissions s ON s.id = b.accepted_submission_id
       WHERE b.paid_txid = ?1 AND s.submitter_stx_address = ?2
       LIMIT 1`
    )
    .bind(transfer.txId, transfer.recipientAgentStx)
    .first<{ id: string }>();
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
