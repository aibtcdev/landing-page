/**
 * Bounty UI types — thin re-exports from the canonical lib/bounty module.
 *
 * The UI used to define its own shapes proxied from bounty.drx4.xyz. Now that
 * /bounty is backed by the native /api/bounties surface, the on-the-wire shape
 * is exactly the lib/bounty types.
 */

export type {
  BountyRecord,
  BountySubmission,
  BountyStatus,
  BountyWinner,
  BountyPaymentHint,
  BountyTeamMember,
  BountyPayout,
} from "@/lib/bounty";

/** Bounty record decorated with the derived status (the shape responses return). */
export type BountyWithStatus = import("@/lib/bounty").BountyRecord & {
  status: import("@/lib/bounty").BountyStatus;
  /** Poster's agent display name, when looked up by the server. */
  posterDisplayName?: string;
};

/** Detail response — what GET /api/bounties/[id] returns. */
export interface BountyDetailData {
  bounty: BountyWithStatus;
  submissions: import("@/lib/bounty").BountySubmission[];
  submissionCount: number;
  winner?: import("@/lib/bounty").BountyWinner;
  /** Payout progress of the winning submission (one entry per member). */
  payout?: import("@/lib/bounty").BountyPayout;
  /** One sBTC transfer per unpaid member while the winner is unpaid. */
  payments?: import("@/lib/bounty").BountyPaymentHint[];
  /** Solo winner only, from the API for older clients; the page uses `payments`. */
  payment?: import("@/lib/bounty").BountyPaymentHint;
  /**
   * Map of BTC address → registered display name for every actor on the
   * page (poster, winner, every submitter). Addresses without a known
   * display name are absent from the map — render with truncAddr fallback.
   */
  agentNames?: Record<string, string>;
}
