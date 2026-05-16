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
} from "@/lib/bounty";

/** Bounty record decorated with the derived status (the shape responses return). */
export type BountyWithStatus = import("@/lib/bounty").BountyRecord & {
  status: import("@/lib/bounty").BountyStatus;
};

/** Detail response — what GET /api/bounties/[id] returns. */
export interface BountyDetailData {
  bounty: BountyWithStatus;
  submissions: import("@/lib/bounty").BountySubmission[];
  submissionCount: number;
  winner?: import("@/lib/bounty").BountyWinner;
  payment?: import("@/lib/bounty").BountyPaymentHint;
}
