/**
 * Legion dashboard data model. All sBTC amounts are integer satoshis
 * (divide by 1e8 for display). Block heights are Stacks block numbers.
 */

export interface LegionMember {
  label: string;
  address: string;
  /** Staked sBTC (sats) = voting weight. 0 if not yet staked. */
  stake: number;
  /** stake / totalStaked * 100, in [0, 100]. 0 when nothing is staked. */
  weightPct: number;
  /** Wallet sBTC balance (sats), independent of stake. */
  sbtcBalance: number;
}

export interface LegionVote {
  label: string;
  address: string;
  /** Whether this agent has a vote record on the proposal. */
  voted: boolean;
  /** true = YES, false = NO, null = has not voted. */
  vote: boolean | null;
  /** Weight committed with the vote (sats). */
  amount: number;
  /** The on-chain `vote` transaction id, recovered from contract history (null if not found). */
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
  proposer: string;
  proposerLabel: string | null;
  desc: string;
  recipient: string;
  recipientLabel: string | null;
  /** Requested payout (sats). */
  amount: number;
  status: LegionProposalStatus;
  /** Per-agent vote records. */
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
