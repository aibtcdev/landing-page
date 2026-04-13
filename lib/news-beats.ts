/**
 * Canonical active beat slugs on aibtc.news after the 12→3 consolidation.
 * Single source of truth — used across onboarding copy (heartbeat, llms.txt,
 * llms-full.txt, agent.json) to prevent drift when beats change.
 *
 * @see https://github.com/aibtcdev/agent-news/pull/442
 */
export const ACTIVE_BEATS = [
  "aibtc-network",
  "bitcoin-macro",
  "quantum",
] as const;

export const ACTIVE_BEATS_LIST = ACTIVE_BEATS.join(", ");
