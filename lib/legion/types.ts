/**
 * Legion dashboard data model. All sBTC amounts are integer satoshis
 * (divide by 1e8 for display). Block heights are Stacks block numbers.
 */

export interface LegionMember {
  /** STX address (also the staker / voter identity). */
  address: string;
  /** Staked sBTC (sats) = voting weight. */
  stake: number;
  /** stake / totalStaked * 100, in [0, 100]. */
  weightPct: number;
  /** Wallet sBTC balance (sats), independent of stake. */
  sbtcBalance: number;
}

export interface LegionVote {
  /** Voter STX address. */
  address: string;
  /** true = YES, false = NO. */
  vote: boolean;
  /** Weight committed with the vote (sats). */
  amount: number;
  /** The on-chain `vote` transaction id (null if not recovered). */
  txid: string | null;
}

export interface LegionProposalStatus {
  createdBtc: number;
  voteStart: number;
  voteEnd: number;
  execStart: number;
  execEnd: number;
  yesWeight: number;
  noWeight: number;
  vetoWeight: number;
  totalStakedSnapshot: number;
  voterCount: number;
  metQuorum: boolean;
  metThreshold: boolean;
  vetoMetQuorum: boolean;
  vetoActivated: boolean;
  concluded: boolean;
  executed: boolean;
}

export interface LegionProposal {
  id: number;
  /** Who created the proposal. */
  proposer: string;
  desc: string;
  /** Who the treasury pays if the proposal passes. */
  recipient: string;
  /** Payout amount from the treasury (sats). */
  amount: number;
  status: LegionProposalStatus;
  /** The agents who actually voted, derived from on-chain vote txs. */
  votes: LegionVote[];
}

export interface LegionTreasury {
  /** Pooled sBTC (sats). null if the read failed. */
  balance: number | null;
  govWired: boolean;
  payoutWired: boolean;
  tokenWired: boolean;
}

export interface LegionSnapshot {
  /** Unix ms when this snapshot was assembled. */
  updatedAt: number;
  /** Stacks tip height at snapshot time. null if /v2/info failed. */
  blockHeight: number | null;
  treasury: LegionTreasury;
  /** Total staked across the legion (sats). null if the read failed. */
  totalStaked: number | null;
  /** Members sorted by stake descending. */
  members: LegionMember[];
  /** Proposals, newest first. */
  proposals: LegionProposal[];
  /** Per-read failure notes — present so partial outages are visible, not silent. */
  errors: string[];
}
