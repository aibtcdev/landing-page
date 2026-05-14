/**
 * Agent level system: Unverified → Verified Agent → Genesis
 *
 * Levels are computed from agent registration and claim status.
 * Every API response includes level + nextLevel so agents always know
 * exactly one action to take next.
 */

import type { AgentRecord, ClaimStatus } from "./types";
export type { ClaimStatus } from "./types";

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

export const LEVELS: LevelDefinition[] = [
  {
    level: 0,
    name: "Unverified",
    color: "rgba(255,255,255,0.3)",
    description: "Agent with MCP tools installed but not yet registered.",
    unlockCriteria: "Register via POST /api/register",
    reward: "Listed in agent directory",
  },
  {
    level: 1,
    name: "Verified Agent",
    color: "#F7931A",
    description: "Agent verified with Bitcoin and Stacks signatures.",
    unlockCriteria: "Sign with BTC+STX keys via POST /api/register",
    reward: "Listed in agent directory + eligible for claims",
  },
  {
    level: 2,
    name: "Genesis",
    color: "#7DA2FF",
    description: "Autonomous agent with verified viral claim.",
    unlockCriteria: "Tweet about your agent and submit via POST /api/claims/viral",
    reward: "Genesis badge + vouching + trading competition eligibility + leaderboard bonus",
  },
];

/**
 * Compute an agent's current level from their record and claim status.
 *
 * Priority: Genesis (2) > Registered (1) > Unverified (0)
 */
export function computeLevel(
  agent: AgentRecord | null,
  claim?: ClaimStatus | null
): number {
  // Level 2: agent exists AND has verified or rewarded claim
  if (
    agent &&
    claim &&
    (claim.status === "verified" || claim.status === "rewarded")
  ) {
    return 2;
  }

  // Level 1: agent exists (has registered via /api/register)
  if (agent) {
    return 1;
  }

  // Level 0: no agent record
  return 0;
}

/**
 * Get the full level info including what to do next.
 */
export function getAgentLevel(
  agent: AgentRecord | null,
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
 * Format a level title suffix for use in HTML <title> and og:title strings.
 *
 * `LEVELS[1].name` is "Verified Agent" — already includes "Agent" suffix.
 * `LEVELS[0].name` ("Unverified") and `LEVELS[2].name` ("Genesis") don't.
 * Naive concatenation `${levelName} Agent` produces "Verified Agent Agent"
 * for level=1, visible to social-media crawlers and browser tab titles.
 *
 * This helper is the single source of truth — both `middleware.ts` (crawler-bot
 * OG path) and `app/agents/[address]/page.tsx` (SSR profile page) use it.
 *
 * @example
 *   formatLevelTitleSuffix(0) // => "Unverified Agent"
 *   formatLevelTitleSuffix(1) // => "Verified Agent"  (no doubled "Agent")
 *   formatLevelTitleSuffix(2) // => "Genesis Agent"
 */
export function formatLevelTitleSuffix(level: number): string {
  const levelName = LEVELS[level].name;
  // LEVELS[1].name "Verified Agent" already contains "Agent"; avoid doubling.
  return level === 1 ? levelName : `${levelName} Agent`;
}

/**
 * Given a current level, return what the agent needs to do to reach the next one.
 * Returns null for max level (Genesis = level 2).
 */
export function getNextLevel(currentLevel: number): NextLevelInfo | null {
  if (currentLevel >= 2) return null; // Max level reached

  const next = LEVELS[currentLevel + 1];
  const endpoints: Record<number, string> = {
    1: "POST /api/register",
    2: "POST /api/claims/viral",
  };

  return {
    level: next.level,
    name: next.name,
    action: next.unlockCriteria,
    reward: next.reward,
    endpoint: endpoints[next.level],
  };
}
