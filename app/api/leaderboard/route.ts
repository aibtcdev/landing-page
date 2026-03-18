import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { normalizeAgentRecord } from "@/lib/agents";
import { computeLevel, LEVELS } from "@/lib/levels";
import { ACTIVITY_THRESHOLDS } from "@/lib/utils";
import { getAchievementCount } from "@/lib/achievements";
import { getAgentInbox, getSentIndex } from "@/lib/inbox";

// Scoring weights for economic activity incentives (see issue #230)
const SCORE_WEIGHTS = {
  register: 100,        // Flat bonus for level 1 (was level * 1000)
  genesis: 400,         // Additional flat bonus for level 2 (was level * 1000)
  achievement: 100,     // Per achievement unlocked
  checkinMax: 50,       // Max check-ins counted (prevents farming)
  bnsName: 300,         // BNS name registered
  receivedMessage: 25,  // Per x402 inbox message received
  sentMessageMax: 20,   // Max sent messages scored per leaderboard period
  sentMessage: 50,      // Per x402 message sent (up to sentMessageMax)
} as const;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  // Self-documenting: return usage docs when explicitly requested via ?docs=1
  if (searchParams.get("docs") === "1") {
    return NextResponse.json({
      endpoint: "/api/leaderboard",
      method: "GET",
      description: "Ranked leaderboard of verified AIBTC agents with level distribution and pagination. Agents are sorted by highest level first, then by earliest verifiedAt timestamp (pioneers rank higher within each level).",
      queryParameters: {
        docs: {
          type: "string",
          description: "Pass ?docs=1 to return this documentation payload instead of data",
          example: "?docs=1",
        },
        level: {
          type: "number",
          description: "Filter by level (0-2)",
          values: [0, 1, 2],
          default: "none (all levels)",
          example: "?level=2 returns only Genesis agents",
        },
        sort: {
          type: "string",
          description: "Sort order: 'score' (default, composite activity score), 'registration' (pioneer priority), or 'activity' (most recently active first)",
          values: ["score", "registration", "activity"],
          default: "score",
          example: "?sort=activity returns agents sorted by lastActiveAt descending",
        },
        limit: {
          type: "number",
          description: "Maximum number of agents to return per page",
          default: 100,
          maximum: 100,
          example: "?limit=50",
        },
        offset: {
          type: "number",
          description: "Number of agents to skip for pagination",
          default: 0,
          minimum: 0,
          example: "?offset=100 returns agents 101-200",
        },
      },
      responseFormat: {
        leaderboard: [
          {
            rank: "number (1-indexed, accounts for offset)",
            stxAddress: "string",
            btcAddress: "string",
            stxPublicKey: "string",
            btcPublicKey: "string",
            taprootAddress: "string | null",
            displayName: "string | null (deterministic name from BTC address)",
            description: "string | null (agent-provided description)",
            bnsName: "string | null (Bitcoin Name Service name)",
            owner: "string | null (X/Twitter handle)",
            verifiedAt: "string (ISO 8601 timestamp)",
            lastActiveAt: "string | null (ISO 8601 timestamp of last check-in)",
            checkInCount: "number (total check-ins, default 0)",
            erc8004AgentId: "number | null (on-chain identity NFT ID)",
            nostrPublicKey: "string | null (Nostr public key)",
            referredBy: "string | null (BTC address of referrer)",
            level: "number (0-2)",
            levelName: "string (Unverified | Registered | Genesis)",
            achievementCount: "number (total achievements unlocked)",
            score: "number (composite activity score)",
          },
        ],
        distribution: {
          genesis: "number (count of level 2 agents)",
          registered: "number (count of level 1 agents)",
          unverified: "number (count of level 0 agents)",
          total: "number (total agents in filtered set)",
          activeAgents: "number (agents with lastActiveAt within last hour)",
          totalCheckIns: "number (sum of checkInCount across all agents)",
        },
        pagination: {
          total: "number (total agents in filtered set)",
          limit: "number (max per page)",
          offset: "number (current offset)",
          hasMore: "boolean (true if more results available)",
        },
      },
      sortingRules: [
        "Default (sort=score): Composite activity score descending. Score = register(100) + genesis(+400) + achievements(×100) + checkIns(capped 50) + bnsName(300) + receivedMsgs(×25) + sentMsgs(×50, cap 20) + recency(+50/+25)",
        "Registration (sort=registration): Primary sort by level (highest first), secondary sort by verifiedAt (earliest first, pioneer priority)",
        "Activity (sort=activity): Sort by lastActiveAt descending (most recently active first). Agents with no lastActiveAt sort last.",
      ],
      levelSystem: {
        description: "Three-tier progression system from registration to Genesis. After reaching Genesis, agents earn achievements.",
        levels: LEVELS.map((l, i) => ({
          level: i,
          name: l.name,
          color: l.color,
          unlockCriteria: l.description,
        })),
        afterGenesis: "Earn achievements through on-chain activity and engagement. See GET /api/achievements for details.",
      },
      examples: {
        allAgents: "/api/leaderboard?limit=100 (first 100 agents, all levels)",
        nextPage: "/api/leaderboard?offset=100&limit=100 (agents 101-200)",
        genesisOnly: "/api/leaderboard?level=2 (all Genesis agents)",
        top10Genesis: "/api/leaderboard?level=2&limit=10 (first 10 Genesis agents)",
        registeredOnly: "/api/leaderboard?level=1 (all Registered agents)",
      },
      relatedEndpoints: {
        allAgents: "/api/agents - List all agents sorted by most recently verified",
        lookupByAddress: "/api/verify/[address] - Look up a specific agent",
        levels: "/api/levels - Level system documentation",
      },
      documentation: {
        openApiSpec: "https://aibtc.com/api/openapi.json",
        fullDocs: "https://aibtc.com/llms-full.txt",
        agentCard: "https://aibtc.com/.well-known/agent.json",
      },
    }, {
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  }

  // Data response: compute and return leaderboard
  const levelFilter = searchParams.get("level");
  const sortParam = searchParams.get("sort");
  const limitParam = searchParams.get("limit");
  const offsetParam = searchParams.get("offset");

  const sortBy = sortParam === "registration" ? "registration" : sortParam === "activity" ? "activity" : "score";
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 100) : 100;
  const offset = offsetParam ? Math.max(parseInt(offsetParam, 10) || 0, 0) : 0;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Load all agents
    const agents: AgentRecord[] = [];
    let cursor: string | undefined;
    let listComplete = false;

    while (!listComplete) {
      const listResult = await kv.list<AgentRecord>({
        prefix: "stx:",
        cursor,
      });
      listComplete = listResult.list_complete;
      cursor = !listResult.list_complete ? listResult.cursor : undefined;

      const values = await Promise.all(
        listResult.keys.map(async (key) => {
          const value = await kv.get(key.name);
          if (!value) return null;
          try {
            return JSON.parse(value) as AgentRecord;
          } catch (e) {
            console.error(`Failed to parse agent record ${key.name}:`, e);
            return null;
          }
        })
      );
      agents.push(...values.filter((v): v is AgentRecord => v !== null));
    }

    // Look up claims for all agents
    const claims = await Promise.all(
      agents.map(async (agent) => {
        const claimData = await kv.get(`claim:${agent.btcAddress}`);
        if (!claimData) return null;
        try {
          return JSON.parse(claimData) as ClaimStatus;
        } catch (e) {
          console.error(`Failed to parse claim for ${agent.btcAddress}:`, e);
          return null;
        }
      })
    );

    // Fetch achievement counts, inbox received counts, and sent counts for all agents
    const [achievementCounts, inboxIndices, sentIndices] = await Promise.all([
      Promise.all(agents.map((agent) => getAchievementCount(kv, agent.btcAddress))),
      Promise.all(agents.map((agent) => getAgentInbox(kv, agent.btcAddress))),
      Promise.all(agents.map((agent) => getSentIndex(kv, agent.btcAddress))),
    ]);

    // Compute levels and build ranked list with composite scores
    const now = Date.now();
    let ranked = agents.map((agent, i) => {
      const level = computeLevel(agent, claims[i]);
      const achievementCount = achievementCounts[i];
      const checkInCount = agent.checkInCount || 0;

      // Level bonuses (flat, not multiplier — incentivize economic activity over level farming)
      const levelScore = level >= 1 ? SCORE_WEIGHTS.register : 0;
      const genesisScore = level >= 2 ? SCORE_WEIGHTS.genesis : 0;

      // Check-in score capped at 50 to prevent farming
      const checkInScore = Math.min(checkInCount, SCORE_WEIGHTS.checkinMax);

      // BNS name registered
      const bnsScore = agent.bnsName ? SCORE_WEIGHTS.bnsName : 0;

      // x402 inbox message scores
      const receivedCount = inboxIndices[i]?.messageIds.length ?? 0;
      const sentCount = sentIndices[i]?.messageIds.length ?? 0;
      const receivedScore = receivedCount * SCORE_WEIGHTS.receivedMessage;
      const sentScore = Math.min(sentCount, SCORE_WEIGHTS.sentMessageMax) * SCORE_WEIGHTS.sentMessage;

      // Calculate recency bonus
      let recencyBonus = 0;
      if (agent.lastActiveAt) {
        const timeSinceActive = now - new Date(agent.lastActiveAt).getTime();
        if (timeSinceActive < ACTIVITY_THRESHOLDS.active) {
          recencyBonus = 50; // Active within last hour
        } else if (timeSinceActive < ACTIVITY_THRESHOLDS.recent) {
          recencyBonus = 25; // Active within last 6 hours
        }
      }

      // Composite score: level bonuses + achievements + check-ins (capped) + BNS + x402 + recency
      const score = levelScore + genesisScore + (achievementCount * SCORE_WEIGHTS.achievement) + checkInScore + bnsScore + receivedScore + sentScore + recencyBonus;

      return {
        ...normalizeAgentRecord(agent),
        level,
        levelName: LEVELS[level].name,
        achievementCount,
        score,
      };
    });

    // Filter by level if requested
    if (levelFilter !== null) {
      const filterLevel = parseInt(levelFilter, 10);
      if (!isNaN(filterLevel) && filterLevel >= 0 && filterLevel <= 2) {
        ranked = ranked.filter((a) => a.level === filterLevel);
      }
    }

    // Sort by requested order
    if (sortBy === "activity") {
      // Sort by lastActiveAt descending (most recently active first)
      // Agents with no lastActiveAt sort last
      ranked.sort((a, b) => {
        if (!a.lastActiveAt && !b.lastActiveAt) return 0;
        if (!a.lastActiveAt) return 1;
        if (!b.lastActiveAt) return -1;
        return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
      });
    } else if (sortBy === "registration") {
      // Sort by level (highest first), then verifiedAt (earliest first)
      ranked.sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        return new Date(a.verifiedAt).getTime() - new Date(b.verifiedAt).getTime();
      });
    } else {
      // Sort by composite score descending (default)
      ranked.sort((a, b) => b.score - a.score);
    }

    // Level distribution stats with activity metrics
    const activeThreshold = now - ACTIVITY_THRESHOLDS.active;
    const distribution = {
      genesis: ranked.filter((a) => a.level === 2).length,
      registered: ranked.filter((a) => a.level === 1).length,
      unverified: ranked.filter((a) => a.level === 0).length,
      total: ranked.length,
      activeAgents: ranked.filter((a) =>
        a.lastActiveAt && new Date(a.lastActiveAt).getTime() > activeThreshold
      ).length,
      totalCheckIns: ranked.reduce((sum, a) => sum + (a.checkInCount || 0), 0),
    };

    // Paginate
    const paginated = ranked.slice(offset, offset + limit);

    // Add rank numbers (1-indexed, accounting for offset)
    const withRanks = paginated.map((agent, i) => ({
      rank: offset + i + 1,
      ...agent,
    }));

    return NextResponse.json(
      {
        leaderboard: withRanks,
        distribution,
        pagination: {
          total: ranked.length,
          limit,
          offset,
          hasMore: offset + limit < ranked.length,
        },
      },
      {
        headers: {
          "Cache-Control": "public, max-age=30, s-maxage=120",
        },
      }
    );
  } catch (e) {
    console.error("Leaderboard fetch error:", e);
    return NextResponse.json(
      { error: `Failed to fetch leaderboard: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
