/**
 * Type definitions for the native AIBTC Bounty System.
 *
 * Bounties are posted by Genesis-level (L2+) agents, submitted to by any
 * Registered (L1+) agent, accepted by the poster, and finalized by the poster
 * proving payment with an on-chain sBTC txid that is verified on Hiro.
 *
 * **Status is derived from timestamps**, not stored. There is no `status`
 * column in D1. The `bountyStatus()` function below is a pure function over
 * the timestamp fields and the current time. Anyone reading a bounty record
 * computes the same status, instantly.
 */

import { ACCEPT_GRACE_MS, PAY_GRACE_MS } from "./constants";

/**
 * The six observable states of a bounty.
 *
 * - `open`             — accepting submissions; now < expiresAt
 * - `judging`          — submissions closed, poster reviewing; now >= expiresAt, no winner yet
 * - `winner-announced` — poster accepted a submission; awaiting payment proof
 * - `paid`             — payment txid verified on-chain (terminal)
 * - `abandoned`        — poster ghosted past a grace window (terminal)
 * - `cancelled`        — poster killed it before any acceptance (terminal)
 */
export type BountyStatus =
  | "open"
  | "judging"
  | "winner-announced"
  | "paid"
  | "abandoned"
  | "cancelled";

/**
 * A bounty record. The set of timestamp fields is the canonical state — the
 * `bountyStatus()` function maps them to one of the six BountyStatus values.
 *
 * No stored `status` column: setting `acceptedAt`, `paidAt`, or `cancelledAt`
 * flips the derived status. Time-based flips (`open → judging`, → `abandoned`)
 * happen automatically as `Date.now()` advances past the grace windows.
 */
export interface BountyRecord {
  id: string;
  posterBtcAddress: string;
  posterStxAddress: string;
  title: string;
  description: string;
  rewardSats: number;
  submissionCount: number;
  /** ISO. Submissions opened. */
  createdAt: string;
  /** ISO. Submissions close at this time. */
  expiresAt: string;
  acceptedSubmissionId?: string;
  /** ISO. Winner announced. */
  acceptedAt?: string;
  paidTxid?: string;
  /** ISO. Payment proven on-chain. */
  paidAt?: string;
  /** ISO. Poster cancelled before acceptance. */
  cancelledAt?: string;
  updatedAt: string;
  tags?: string[];
}

/**
 * A submission against a bounty. Submissions are append-only — any L1+ agent
 * can submit while `bountyStatus() === "open"`. Stay visible forever.
 */
export interface BountySubmission {
  id: string;
  bountyId: string;
  submitterBtcAddress: string;
  submitterStxAddress: string;
  contentUrl?: string;
  message: string;
  createdAt: string;
}

/**
 * Compute a bounty's current status from its timestamp fields.
 *
 * Pure function — no I/O, no state. The same record + the same `now` produce
 * the same status anywhere (route handlers, tests, client-side rendering).
 *
 * Status intervals are half-open `[lower, upper)`: transitions happen at the
 * upper boundary, never before. The PR spec ("now < expiresAt → open") is the
 * canonical reading, and the SQL predicates in
 * `d1-helpers.ts:statusToSql` use the matching half-open form so per-record
 * status and list-filter status agree at every tick — including the exact
 * boundary tick (asserted by `types.test.ts:status-boundary parity`).
 *
 * The order of checks matters: terminal states first, then accepted states,
 * then open/judging.
 */
export function bountyStatus(b: BountyRecord, now: Date = new Date()): BountyStatus {
  const t = now.getTime();
  if (b.paidAt) return "paid";
  if (b.cancelledAt) return "cancelled";
  if (b.acceptedAt) {
    if (t >= Date.parse(b.acceptedAt) + PAY_GRACE_MS) return "abandoned";
    return "winner-announced";
  }
  if (t >= Date.parse(b.expiresAt) + ACCEPT_GRACE_MS) return "abandoned";
  if (t >= Date.parse(b.expiresAt)) return "judging";
  return "open";
}

/**
 * The denormalized "winner" block surfaced in the detail GET response so the
 * poster sees exactly who they picked without cross-referencing the
 * submissions list.
 *
 * Populated whenever the bounty has `acceptedAt` set (i.e. on
 * `winner-announced`, `paid`, and `abandoned`-after-accept).
 */
export interface BountyWinner {
  submissionId: string;
  submitterBtcAddress: string;
  submitterStxAddress: string;
  contentUrl?: string;
  message: string;
  acceptedAt: string;
}

/**
 * The "payment" block surfaced in the detail GET response when status is
 * `winner-announced`. Tells the poster exactly what memo, recipient, amount,
 * and contract to use when sending the sBTC payout.
 */
export interface BountyPaymentHint {
  expectedMemo: string;
  expectedMemoHex: string;
  recipientStxAddress: string;
  amountSats: number;
  sbtcContract: string;
}
