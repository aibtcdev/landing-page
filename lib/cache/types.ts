/**
 * Types for the KV-backed agent list cache.
 *
 * A single cached snapshot replaces O(N) KV scans across the home page,
 * agents page, /api/agents, and /api/leaderboard endpoints.
 */

/**
 * Pre-computed agent data stored in the cache.
 * Includes all fields needed by listing pages and API endpoints.
 */
export interface CachedAgent {
  stxAddress: string;
  btcAddress: string;
  stxPublicKey: string;
  btcPublicKey: string;
  taprootAddress: string | null;
  displayName: string | null;
  description: string | null;
  bnsName: string | null;
  owner: string | null;
  verifiedAt: string;
  lastActiveAt: string | null;
  checkInCount: number;
  erc8004AgentId: number | null;
  nostrPublicKey: string | null;
  lastIdentityCheck: string | null;
  referredBy: string | null;
  githubUsername: string | null;
  level: number;
  levelName: string;
  achievementCount: number;
  messageCount: number;
  unreadCount: number;
}

/**
 * The full cached snapshot stored in a single KV key.
 */
export interface CachedAgentList {
  agents: CachedAgent[];
  stats: {
    total: number;
    genesisCount: number;
    messageCount: number;
  };
  cachedAt: string;
}
