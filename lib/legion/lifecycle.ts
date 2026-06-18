/**
 * Pure derivation of a proposal's lifecycle stage from its block-height windows
 * and the current chain tip. Windows are read from `get-proposal-status` and are
 * NEVER hardcoded — test-fast governance uses short windows, production uses long
 * ones, and this function reads whatever the contract reports.
 */

import type { LegionProposalStatus } from "./types";

export type LegionStage =
  | "pending"
  | "voting"
  | "veto"
  | "execution"
  | "concluded"
  | "expired";

export interface LifecycleInfo {
  stage: LegionStage;
  label: string;
  /** Set only when concluded. */
  outcome: "executed" | "rejected" | null;
  /** Would pass right now per the constitution (quorum, threshold, voters, no veto). */
  passing: boolean;
  /** Blocks until the next stage transition, or null if terminal / height unknown. */
  blocksUntilNext: number | null;
  /** Label of the stage we transition into next, or null if terminal. */
  nextLabel: string | null;
}

const STAGE_LABELS: Record<LegionStage, string> = {
  pending: "Pending",
  voting: "Voting",
  veto: "Veto window",
  execution: "Execution",
  concluded: "Concluded",
  expired: "Expired",
};

/** The ordered, non-terminal lifecycle stages shown in the tracker. */
export const LIFECYCLE_STAGES: ReadonlyArray<{ stage: LegionStage; label: string }> = [
  { stage: "pending", label: "Created" },
  { stage: "voting", label: "Voting" },
  { stage: "veto", label: "Veto" },
  { stage: "execution", label: "Execution" },
  { stage: "concluded", label: "Concluded" },
];

export function isPassing(status: LegionProposalStatus): boolean {
  return (
    status.metQuorum &&
    status.metThreshold &&
    status.voterCount >= 2 &&
    !status.vetoActivated
  );
}

export function deriveLifecycle(
  status: LegionProposalStatus,
  blockHeight: number | null,
): LifecycleInfo {
  const passing = isPassing(status);

  // `concluded` is authoritative regardless of where the tip sits.
  if (status.concluded) {
    return {
      stage: "concluded",
      label: STAGE_LABELS.concluded,
      outcome: status.executed ? "executed" : "rejected",
      passing,
      blocksUntilNext: null,
      nextLabel: null,
    };
  }

  // Without a tip height we can't place the proposal on the timeline.
  if (blockHeight == null) {
    return {
      stage: "pending",
      label: STAGE_LABELS.pending,
      outcome: null,
      passing,
      blocksUntilNext: null,
      nextLabel: null,
    };
  }

  const b = blockHeight;
  const { voteStart, voteEnd, execStart, execEnd } = status;

  if (b < voteStart) {
    return mk("pending", passing, voteStart - b, STAGE_LABELS.voting);
  }
  if (b < voteEnd) {
    return mk("voting", passing, voteEnd - b, STAGE_LABELS.veto);
  }
  if (b < execStart) {
    return mk("veto", passing, execStart - b, STAGE_LABELS.execution);
  }
  if (b < execEnd) {
    return mk("execution", passing, execEnd - b, STAGE_LABELS.concluded);
  }

  // Past the execution window and never concluded.
  return {
    stage: "expired",
    label: STAGE_LABELS.expired,
    outcome: null,
    passing,
    blocksUntilNext: null,
    nextLabel: null,
  };
}

function mk(
  stage: LegionStage,
  passing: boolean,
  blocksUntilNext: number,
  nextLabel: string,
): LifecycleInfo {
  return {
    stage,
    label: STAGE_LABELS[stage],
    outcome: null,
    passing,
    blocksUntilNext,
    nextLabel,
  };
}
