/**
 * Fold stored legion events into what the page renders: numbered proposals
 * (each with a derived phase, bucket and predicted outcome), the agents that
 * have acted on each side, and the activity wire. Pure, no I/O.
 *
 * Mirrors the contracts branch for branch (lib/legion/constants.ts has the
 * source link). Every window counts BURN blocks, so every phase decision here
 * compares against the Bitcoin tip.
 *
 * Print events, per legion:
 *   propose       proposalId, proposer, link, title, proposerWeight, payout,
 *                 voteEnd, votableAtOpen, vault   (+ description, stored at ingest)
 *   vote          proposalId, voter, support, weight, rationale
 *   conclude      proposalId, outcome passed|failed, reason, yesWeight, noWeight,
 *                 recipient + payout on a pass
 *   redeem-vault  won, shares, sats, totalCredits
 *   claim-credit  who, sats, creditLeft
 */

import { asNumber, asString } from "./clarity";
import type { EventRow } from "./chainhook";
import { STATUS, type LegionParams, type LegionSide } from "./constants";

/** Where a proposal sits, matching the contract's own `get-phase`. */
export type Phase = "pending" | "voting" | "concludable" | "expired" | "passed" | "failed";

/** The three buckets the page filters by. */
export type StatusBucket = "pending" | "verified" | "rejected";

/**
 * Why a proposal ended as it did, read verbatim from the conclude event.
 *   paid-shares    passed while the market traded; 3,000 shares moved to the proposer
 *   credited       passed after the market froze; recorded as a credit on the vault
 *   no-voters      fewer than minVoters distinct agents voted yes
 *   voted-down     yes weight under the threshold share of cast weight
 *   not-holding    the proposer sold below the floor before conclude
 *   pot-short      the vault could not cover the payout on top of live credits
 *   not-concluded  the conclude window closed with nobody calling it
 */
export type Reason =
  | ""
  | "paid-shares"
  | "credited"
  | "no-voters"
  | "voted-down"
  | "not-holding"
  | "pot-short"
  | "not-concluded";

export interface Ballot {
  voter: string;
  support: boolean;
  /** The voter's position at the moment it voted. */
  weight: number;
  /** Required by the contract and printed on chain. */
  rationale: string;
  blockHeight: number;
  txid: string;
}

export interface Proposal {
  side: LegionSide;
  contract: string;
  proposalId: number;
  proposer: string | null;
  title: string;
  link: string;
  /** From `get-proposal-meta`, stored at ingest. Empty if that read failed. */
  description: string;
  /** Shares an approval pays, fixed at propose. */
  payout: number | null;
  /** The proposer's position when it proposed. */
  proposerWeight: number | null;
  /** Burn height voting closes at. */
  voteEnd: number | null;
  /** Circulating supply on this side less the vault, at propose. */
  votableAtOpen: number | null;
  /** What the vault held when this was proposed. */
  vaultAtOpen: number | null;
  yesWeight: number;
  noWeight: number;
  voterCount: number;
  yesVoterCount: number;
  votes: Ballot[];
  status: number;
  reason: Reason;
  /** Who a pass paid. Always the proposer: there is no recipient field. */
  recipient: string | null;
  proposeTxid: string | null;
  concludeTxid: string | null;
  /** Unix seconds of the propose and conclude blocks. Display only. */
  proposedAt: number | null;
  concludedAt: number | null;
}

export interface Prediction {
  approvalPct: number;
  votersMet: boolean;
  thresholdMet: boolean;
  /** Proposer still holds the floor. Null when the live read failed. */
  holdingMet: boolean | null;
  /** Vault covers live credits plus this payout. Null when the read failed. */
  potMet: boolean | null;
  outcome: "PASSED" | "NO_VOTERS" | "VOTED_DOWN" | "NOT_HOLDING" | "POT_SHORT";
}

export interface DisplayProposal extends Proposal {
  phase: Phase;
  bucket: StatusBucket;
  /** Burn height it was proposed at: voteEnd − voteWindow − voteDelay. */
  openedAt: number | null;
  /** Height at which the current phase gives way to the next. */
  nextBoundary: number | null;
  /** What `conclude` would write on the tally so far, while undecided. */
  prediction: Prediction | null;
  /** The proposer's live weight, when it was read. */
  proposerWeightNow: number | null;
  key: string;
  anchor: string;
}

/**
 * An agent that has acted on one side. There is no roster to read: anyone
 * holding the floor is a member, so this lists the principals that have
 * proposed or voted, with their live weight beside the record.
 */
export interface Member {
  who: string;
  /** Live shares on this side, or null when not read. */
  weight: number | null;
  proposals: number;
  votes: number;
  firstBlock: number;
  firstTxid: string;
}

export interface FeedItem {
  txid: string;
  event: string;
  side: LegionSide;
  proposalId: number | null;
  blockHeight: number;
  data: Record<string, unknown>;
}

export interface SideSummary {
  total: number;
  pending: number;
  verified: number;
  rejected: number;
}

export interface FoldContext {
  tip: number | null;
  rules: LegionParams;
  /** Live weights by principal, for whoever was read. */
  weights: ReadonlyMap<string, number>;
  /** Live vault, for the pot-short prediction. */
  vault: number | null;
  /** Live credits outstanding, for the pot-short prediction. */
  totalCredits: number | null;
}

export interface SideFold {
  proposals: DisplayProposal[];
  members: Member[];
  feed: FeedItem[];
  summary: SideSummary;
}

/** Mirrors `get-phase`: a terminal status wins, otherwise height arithmetic. */
export function derivePhase(p: Proposal, tip: number | null, rules: LegionParams): Phase {
  if (p.status === STATUS.PASSED) return "passed";
  if (p.status === STATUS.FAILED) return "failed";
  if (p.status === STATUS.EXPIRED) return "expired";
  if (p.voteEnd == null || tip == null) return "voting";
  const opens = p.voteEnd - rules.voteWindow;
  if (tip < opens) return "pending";
  if (tip < p.voteEnd) return "voting";
  if (tip < p.voteEnd + rules.concludeWindow) return "concludable";
  return "expired";
}

export function bucketFor(phase: Phase): StatusBucket {
  if (phase === "passed") return "verified";
  if (phase === "failed" || phase === "expired") return "rejected";
  return "pending";
}

export function nextBoundary(p: Proposal, phase: Phase, rules: LegionParams): number | null {
  if (p.voteEnd == null) return null;
  if (phase === "pending") return p.voteEnd - rules.voteWindow;
  if (phase === "voting") return p.voteEnd;
  if (phase === "concludable") return p.voteEnd + rules.concludeWindow;
  return null;
}

/**
 * The verdict `conclude` would write on the current tally, in the contract's
 * own branch order: yes voters, then threshold, then the proposer still
 * holding, then the pot. FLOOR on the percentage, because Clarity's `/`
 * truncates and a prediction that disagrees with the contract is worse than
 * none.
 */
export function predictOutcome(
  p: Proposal,
  rules: LegionParams,
  live: { proposerWeight: number | null; vault: number | null; totalCredits: number | null }
): Prediction {
  const cast = p.yesWeight + p.noWeight;
  const approvalPct = cast > 0 ? Math.floor((p.yesWeight * 100) / cast) : 0;
  const votersMet = p.yesVoterCount >= rules.minVoters;
  const thresholdMet = cast > 0 && approvalPct >= rules.votingThreshold;
  const holdingMet = live.proposerWeight == null ? null : live.proposerWeight >= rules.minPosition;
  const payout = p.payout ?? rules.payout;
  const potMet =
    live.vault == null || live.totalCredits == null ? null : live.vault >= live.totalCredits + payout;

  let outcome: Prediction["outcome"];
  if (!votersMet) outcome = "NO_VOTERS";
  else if (!thresholdMet) outcome = "VOTED_DOWN";
  else if (holdingMet === false) outcome = "NOT_HOLDING";
  else if (potMet === false) outcome = "POT_SHORT";
  else outcome = "PASSED";

  return { approvalPct, votersMet, thresholdMet, holdingMet, potMet, outcome };
}

function blank(side: LegionSide, contract: string, id: number): Proposal {
  return {
    side,
    contract,
    proposalId: id,
    proposer: null,
    title: "",
    link: "",
    description: "",
    payout: null,
    proposerWeight: null,
    voteEnd: null,
    votableAtOpen: null,
    vaultAtOpen: null,
    yesWeight: 0,
    noWeight: 0,
    voterCount: 0,
    yesVoterCount: 0,
    votes: [],
    status: STATUS.OPEN,
    reason: "",
    recipient: null,
    proposeTxid: null,
    concludeTxid: null,
    proposedAt: null,
    concludedAt: null,
  };
}

function stampOf(e: EventRow): number | null {
  return e.block_time ?? (e.recorded_at != null ? Math.floor(e.recorded_at / 1000) : null);
}

function chronological(events: readonly EventRow[]): EventRow[] {
  return [...events].sort((a, b) => a.block_height - b.block_height || a.event_index - b.event_index);
}

/**
 * Principals that have proposed or voted on one legion, most recently active
 * first. The server reads live weights for the head of this list.
 */
export function participantsOf(events: readonly EventRow[], contract: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...chronological(events)].reverse()) {
    if (e.contract_id !== contract) continue;
    const who =
      e.event === "propose" ? asString(e.data.proposer) : e.event === "vote" ? asString(e.data.voter) : null;
    if (who && !seen.has(who)) {
      seen.add(who);
      out.push(who);
    }
  }
  return out;
}

export function foldSide(
  events: readonly EventRow[],
  side: LegionSide,
  contract: string,
  ctx: FoldContext
): SideFold {
  const mine = events.filter((e) => e.contract_id === contract);
  const byId = new Map<number, Proposal>();
  const members = new Map<string, Member>();

  const ensure = (id: number): Proposal => {
    let p = byId.get(id);
    if (!p) {
      p = blank(side, contract, id);
      byId.set(id, p);
    }
    return p;
  };
  const touch = (who: string, e: EventRow, kind: "proposals" | "votes") => {
    let m = members.get(who);
    if (!m) {
      m = {
        who,
        weight: ctx.weights.get(who) ?? null,
        proposals: 0,
        votes: 0,
        firstBlock: e.block_height,
        firstTxid: e.txid,
      };
      members.set(who, m);
    }
    m[kind] += 1;
  };

  for (const e of chronological(mine)) {
    const d = e.data;
    const id = asNumber(d.proposalId);
    switch (e.event) {
      case "propose": {
        if (id == null) break;
        const p = ensure(id);
        p.proposer = asString(d.proposer);
        p.title = asString(d.title) ?? "";
        p.link = asString(d.link) ?? "";
        p.description = asString(d.description) ?? "";
        p.payout = asNumber(d.payout);
        p.proposerWeight = asNumber(d.proposerWeight);
        p.voteEnd = asNumber(d.voteEnd);
        p.votableAtOpen = asNumber(d.votableAtOpen);
        p.vaultAtOpen = asNumber(d.vault);
        p.proposeTxid = e.txid;
        p.proposedAt = stampOf(e);
        if (p.proposer) touch(p.proposer, e, "proposals");
        break;
      }
      case "vote": {
        if (id == null) break;
        const p = ensure(id);
        const weight = asNumber(d.weight) ?? 0;
        const support = d.support === true;
        if (support) {
          p.yesWeight += weight;
          p.yesVoterCount += 1;
        } else {
          p.noWeight += weight;
        }
        p.voterCount += 1;
        const voter = asString(d.voter) ?? "";
        p.votes.push({
          voter,
          support,
          weight,
          rationale: asString(d.rationale) ?? "",
          blockHeight: e.block_height,
          txid: e.txid,
        });
        if (voter) touch(voter, e, "votes");
        break;
      }
      case "conclude": {
        if (id == null) break;
        const p = ensure(id);
        const outcome = asString(d.outcome);
        if (outcome === "passed") p.status = STATUS.PASSED;
        else if (outcome === "failed") p.status = STATUS.FAILED;
        p.reason = (asString(d.reason) ?? "") as Reason;
        p.recipient = asString(d.recipient);
        p.concludeTxid = e.txid;
        p.concludedAt = stampOf(e);
        break;
      }
      default:
        break;
    }
  }

  const proposals: DisplayProposal[] = [...byId.values()]
    .sort((a, b) => b.proposalId - a.proposalId)
    .map((p) => {
      const phase = derivePhase(p, ctx.tip, ctx.rules);
      const votingLive = phase === "voting" || phase === "concludable";
      const proposerWeightNow = p.proposer ? ctx.weights.get(p.proposer) ?? null : null;
      // A lapsed proposal carries no conclude event and so no reason. The
      // contract's own `get-proposal` merges "not-concluded" onto it; so does this.
      const reason: Reason =
        phase === "expired" && !p.concludeTxid && p.reason === "" ? "not-concluded" : p.reason;
      return {
        ...p,
        reason,
        phase,
        bucket: bucketFor(phase),
        openedAt: p.voteEnd != null ? p.voteEnd - ctx.rules.voteWindow - ctx.rules.voteDelay : null,
        nextBoundary: nextBoundary(p, phase, ctx.rules),
        prediction: votingLive
          ? predictOutcome(p, ctx.rules, {
              proposerWeight: proposerWeightNow,
              vault: ctx.vault,
              totalCredits: ctx.totalCredits,
            })
          : null,
        proposerWeightNow,
        key: `${contract}#${p.proposalId}`,
        anchor: `proposal-${side}-${p.proposalId}`,
      };
    });

  const feed: FeedItem[] = [...mine]
    .sort((a, b) => b.block_height - a.block_height || b.event_index - a.event_index)
    .slice(0, 60)
    .map((e) => ({
      txid: e.txid,
      event: e.event,
      side,
      proposalId: e.proposal_id,
      blockHeight: e.block_height,
      data: e.data,
    }));

  return {
    proposals,
    members: [...members.values()].sort((a, b) => a.firstBlock - b.firstBlock),
    feed,
    summary: {
      total: proposals.length,
      pending: proposals.filter((p) => p.bucket === "pending").length,
      verified: proposals.filter((p) => p.bucket === "verified").length,
      rejected: proposals.filter((p) => p.bucket === "rejected").length,
    },
  };
}
