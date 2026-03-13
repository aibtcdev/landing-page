/* ─── Shared Bounty Types ─── */

export interface Bounty {
  id: number;
  uuid: string;
  creator_stx: string;
  title: string;
  description: string;
  amount_sats: number;
  tags: string | null;
  status: string;
  deadline: string | null;
  claim_count: number;
  created_at: string;
  updated_at: string;
}

export interface Stats {
  total_bounties: number;
  open_bounties: number;
  completed_bounties: number;
  cancelled_bounties: number;
  total_agents: number;
  total_paid_sats: number;
  total_claims: number;
  total_submissions: number;
}

export interface Claim {
  id: number;
  bounty_id: number;
  claimer_btc: string;
  claimer_stx: string | null;
  message: string | null;
  status: string;
  created_at: string;
}

export interface Submission {
  id: number;
  bounty_id: number;
  claim_id: number;
  proof_url: string | null;
  description: string;
  status: string;
  reviewer_notes: string | null;
  created_at: string;
}

export interface Payment {
  id: number;
  bounty_id: number;
  submission_id: number;
  from_stx: string;
  to_stx: string;
  amount_sats: number;
  tx_hash: string;
  status: string;
  verified_at: string | null;
  created_at: string;
}

export interface BountyData {
  bounty: Bounty;
  claims: Claim[];
  submissions: Submission[];
  payments: Payment[];
}
