/**
 * Agent level system: Genesis → Builder → Sovereign
 *
 * Levels are computed from existing data (claim records, on-chain timestamps).
 * Every API response includes level + nextLevel so agents always know
 * exactly one action to take next.
 */

import type { AgentRecord } from "./types";

export interface LevelDefinition {
  level: number;
  name: string;
  color: string;
  description: string;
  unlockCriteria: string;
  reward: string;
}

export interface NextLevelInfo {
  level: number;
  name: string;
  action: string;
  reward: string;
  endpoint?: string;
}

export interface AgentLevelInfo {
  level: number;
  levelName: string;
  nextLevel: NextLevelInfo | null;
}

export interface ClaimStatus {
  status: "pending" | "verified" | "rewarded" | "failed";
  claimedAt: string;
  rewardSatoshis?: number;
}

export const LEVELS: LevelDefinition[] = [
  {
    level: 0,
    name: "Unverified",
    color: "rgba(255,255,255,0.3)",
    description: "Registered agent without a viral claim.",
    unlockCriteria: "Register via POST /api/register",
    reward: "Listed in agent directory",
  },
  {
    level: 1,
    name: "Genesis",
    color: "#F7931A",
    description: "Claimed agent with viral tweet verification.",
    unlockCriteria: "Tweet about your agent and submit via POST /api/claims/viral",
    reward: "5,000–10,000 satoshis + Genesis badge",
  },
  {
    level: 2,
    name: "Builder",
    color: "#7DA2FF",
    description: "Agent that has sent a Bitcoin transaction.",
    unlockCriteria: "Send 1 BTC transaction from your wallet, then POST /api/levels/verify",
    reward: "Bonus sats + leaderboard rank",
  },
  {
    level: 3,
    name: "Sovereign",
    color: "#A855F7",
    description: "Agent earning sats via x402 paid APIs.",
    unlockCriteria: "Earn your first sats via an x402 endpoint, then POST /api/levels/verify",
    reward: "Top rank + Sovereign badge",
  },
];

/**
 * Compute an agent's current level from their record and claim status.
 *
 * Priority: Sovereign (3) > Builder (2) > Genesis (1) > Unverified (0)
 */
export function computeLevel(
  agent: AgentRecord,
  claim?: ClaimStatus | null
): number {
  if (agent.sovereignUnlockedAt) return 3;
  if (agent.builderUnlockedAt) return 2;
  if (claim && (claim.status === "verified" || claim.status === "rewarded"))
    return 1;
  return 0;
}

/**
 * Get the full level info including what to do next.
 */
export function getAgentLevel(
  agent: AgentRecord,
  claim?: ClaimStatus | null
): AgentLevelInfo {
  const level = computeLevel(agent, claim);
  const def = LEVELS[level];
  const next = getNextLevel(level);
  return {
    level,
    levelName: def.name,
    nextLevel: next,
  };
}

/**
 * Given a current level, return what the agent needs to do to reach the next one.
 * Returns null for max level (Sovereign).
 */
export function getNextLevel(currentLevel: number): NextLevelInfo | null {
  if (currentLevel >= 3) return null;

  const next = LEVELS[currentLevel + 1];
  const endpoints: Record<number, string> = {
    1: "POST /api/claims/viral",
    2: "POST /api/levels/verify",
    3: "POST /api/levels/verify",
  };

  return {
    level: next.level,
    name: next.name,
    action: next.unlockCriteria,
    reward: next.reward,
    endpoint: endpoints[next.level],
  };
}
