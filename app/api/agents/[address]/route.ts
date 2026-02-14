import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord } from "@/lib/types";
import { getAgentLevel, type ClaimStatus } from "@/lib/levels";
import { lookupBnsName } from "@/lib/bns";
import { getAgentAchievements, getAchievementDefinition } from "@/lib/achievements";
import { getCheckInRecord } from "@/lib/heartbeat";
import { detectAgentIdentity, getReputationSummary } from "@/lib/identity";
import { getAgentInbox, getSentIndex } from "@/lib/inbox/kv-helpers";

/**
 * Determine the address type and KV prefix from the format.
 *
 * - Stacks mainnet addresses start with "SP" or "SM"
 * - Bitcoin addresses: bc1 (Native SegWit), 1 (P2PKH), 3 (P2SH)
 * - BNS names end with ".btc"
 * - Returns null for unrecognized formats
 */
function getAddressTypeAndPrefix(
  address: string
): { type: "stx" | "btc" | "bns"; prefix: string } | null {
  // Stacks addresses
  if (address.startsWith("SP") || address.startsWith("SM")) {
    return { type: "stx", prefix: "stx:" };
  }

  // Bitcoin addresses
  if (
    address.startsWith("bc1") ||
    address.startsWith("1") ||
    address.startsWith("3")
  ) {
    return { type: "btc", prefix: "btc:" };
  }

  // BNS names
  if (address.endsWith(".btc")) {
    return { type: "bns", prefix: "bns:" };
  }

  return null;
}

/**
 * Look up agent by BNS name.
 *
 * Currently searches by scanning stored agents and matching the
 * agent.bnsName field (case-insensitive).
 *
 * Note: reverse lookup via Hiro API / a dedicated BNS index is a
 * potential future optimization; this function does not perform it.
 */
async function findAgentByBns(
  kv: KVNamespace,
  bnsName: string
): Promise<AgentRecord | null> {
  // Strategy: load all agents and check for matching bnsName
  // This is acceptable because we already load all agents for /api/agents
  // and the dataset is small-to-medium (<10k agents).
  //
  // Future optimization if needed:
  // - Store reverse index at `bns:{name}` -> btcAddress
  // - Update reverse index during registration and BNS refresh

  const agents: AgentRecord[] = [];
  let cursor: string | undefined;
  let listComplete = false;

  while (!listComplete) {
    const listResult = await kv.list({
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
        } catch {
          return null;
        }
      })
    );
    agents.push(...values.filter((v): v is AgentRecord => v !== null));
  }

  // Find agent with matching bnsName (case-insensitive)
  return (
    agents.find(
      (agent) =>
        agent.bnsName &&
        agent.bnsName.toLowerCase() === bnsName.toLowerCase()
    ) ?? null
  );
}

/**
 * GET /api/agents/:address — Individual agent lookup endpoint.
 *
 * Accepts:
 * - BTC address (bc1..., 1..., 3...)
 * - STX address (SP..., SM...)
 * - BNS name (*.btc)
 *
 * Returns full agent profile with:
 * - Agent record
 * - Level info (current level, next level)
 * - Achievements (all unlocked achievements)
 * - Check-in data (lastCheckInAt, checkInCount)
 *
 * Self-documenting on GET with no match.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  try {
    const { address } = await params;

    if (!address || address.trim().length === 0) {
      return NextResponse.json(
        {
          error: "Address parameter is required",
          usage: {
            endpoint: "GET /api/agents/:address",
            description:
              "Look up a specific agent by BTC address, STX address, or BNS name",
            acceptedFormats: {
              btc: ["bc1...", "1...", "3..."],
              stx: ["SP...", "SM..."],
              bns: ["*.btc"],
            },
            examples: [
              "/api/agents/bc1q...",
              "/api/agents/SP...",
              "/api/agents/alice.btc",
            ],
            responseFormat: {
              agent: "AgentRecord with full profile",
              level: "number (0-2)",
              levelName: "string (Unverified | Registered | Genesis)",
              nextLevel: "NextLevelInfo | null",
              achievements: "AchievementRecord[] (all unlocked achievements)",
              checkIn: "{ lastCheckInAt: string, checkInCount: number } | null",
              trust: "Trust metrics (level, onChain identity, reputation)",
              activity: "Activity metrics (lastActiveAt, checkInCount, hasCheckedIn, hasInboxMessages, unreadInboxCount)",
              capabilities: "Available capabilities based on level and registration (heartbeat, inbox, x402, reputation, paid-attention)",
            },
            relatedEndpoints: {
              allAgents: "/api/agents - List all agents with pagination",
              verify: "/api/verify/:address - Legacy verification endpoint",
              leaderboard:
                "/api/leaderboard - Ranked agents with level distribution",
            },
          },
        },
        { status: 400 }
      );
    }

    const addressInfo = getAddressTypeAndPrefix(address);

    if (!addressInfo) {
      return NextResponse.json(
        {
          error:
            "Invalid address format. Expected a Bitcoin address (bc1..., 1..., 3...), " +
            "Stacks address (SP..., SM...), or BNS name (*.btc).",
          usage: {
            endpoint: "GET /api/agents/:address",
            acceptedFormats: {
              btc: ["bc1...", "1...", "3..."],
              stx: ["SP...", "SM..."],
              bns: ["*.btc"],
            },
          },
        },
        { status: 400 }
      );
    }

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY;

    // Look up agent by address type
    let agent: AgentRecord | null = null;

    if (addressInfo.type === "bns") {
      // BNS lookup: search for matching bnsName
      agent = await findAgentByBns(kv, address);
    } else {
      // Direct KV lookup by BTC or STX address
      const key = addressInfo.prefix + address;
      const value = await kv.get(key);
      if (value) {
        try {
          agent = JSON.parse(value) as AgentRecord;
        } catch {
          return NextResponse.json(
            { error: "Failed to parse agent record" },
            { status: 500 }
          );
        }
      }
    }

    // Agent not found
    if (!agent) {
      return NextResponse.json(
        {
          found: false,
          address,
          addressType: addressInfo.type,
          error: "Agent not found. This address is not registered.",
          nextSteps: {
            action: "Register as a new agent",
            endpoint: "POST /api/register",
            documentation: "https://aibtc.com/llms-full.txt",
          },
        },
        { status: 404 }
      );
    }

    // Lazy BNS refresh: if bnsName is missing, try to look it up.
    // Fire-and-forget so it doesn't block the response.
    if (!agent.bnsName && agent.stxAddress) {
      void lookupBnsName(agent.stxAddress, hiroApiKey, kv).then((bnsName) => {
        if (bnsName) {
          agent.bnsName = bnsName;
          const updated = JSON.stringify(agent);
          Promise.all([
            kv.put(`stx:${agent.stxAddress}`, updated),
            kv.put(`btc:${agent.btcAddress}`, updated),
          ]);
        }
      }).catch(() => {});
    }

    // Look up claim, achievements, check-in, identity, inbox, and sent index in parallel
    const [claimData, achievements, checkInRecord, identity, inboxIndex, sentIndex] = await Promise.all([
      kv.get(`claim:${agent.btcAddress}`),
      getAgentAchievements(kv, agent.btcAddress),
      getCheckInRecord(kv, agent.btcAddress),
      // Use cached identity if available, otherwise detect
      // Note: use != null (not truthiness) because agent-id 0 is valid but falsy
      agent.erc8004AgentId != null
        ? Promise.resolve({ agentId: agent.erc8004AgentId, stxAddress: agent.stxAddress })
        : detectAgentIdentity(agent.stxAddress, hiroApiKey, kv),
      getAgentInbox(kv, agent.btcAddress),
      getSentIndex(kv, agent.btcAddress),
    ]);

    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        // ignore parse errors
      }
    }

    // Fetch reputation summary if identity exists (non-critical, don't fail the whole response)
    let reputation = null;
    if (identity) {
      try {
        reputation = await getReputationSummary(identity.agentId, hiroApiKey, kv);
      } catch {
        // Reputation is optional metadata — continue without it
      }
    }

    const levelInfo = getAgentLevel(agent, claim);
    const checkIn = checkInRecord
      ? {
          lastCheckInAt: checkInRecord.lastCheckInAt,
          checkInCount: checkInRecord.checkInCount,
        }
      : null;

    // Compute trust metrics
    const trust = {
      level: levelInfo.level,
      levelName: levelInfo.levelName,
      onChainIdentity: !!identity,
      reputationScore: reputation?.summaryValue ?? null,
      reputationCount: reputation?.count ?? 0,
    };

    // Compute activity metrics
    const activity = {
      lastActiveAt: agent.lastActiveAt ?? null,
      checkInCount: (checkInRecord?.checkInCount ?? agent.checkInCount) ?? 0,
      hasCheckedIn: !!checkInRecord,
      hasInboxMessages: !!inboxIndex,
      unreadInboxCount: inboxIndex?.unreadCount ?? 0,
      sentCount: sentIndex?.messageIds.length ?? 0,
    };

    // Compute capabilities (derived from level and registration state)
    const capabilities: string[] = [];
    if (levelInfo.level >= 1) {
      capabilities.push("heartbeat");
    }
    // Inbox/x402 capability based on having an STX address (not inbox history)
    if (agent.stxAddress) {
      capabilities.push("inbox");
      capabilities.push("x402");
    }
    if (identity) {
      capabilities.push("reputation");
    }
    if (levelInfo.level >= 2) {
      capabilities.push("paid-attention");
    }

    return NextResponse.json(
      {
        found: true,
        address,
        addressType: addressInfo.type,
        agent: {
          stxAddress: agent.stxAddress,
          btcAddress: agent.btcAddress,
          displayName: agent.displayName,
          description: agent.description,
          bnsName: agent.bnsName,
          verifiedAt: agent.verifiedAt,
          owner: agent.owner,
          stxPublicKey: agent.stxPublicKey,
          btcPublicKey: agent.btcPublicKey,
          lastActiveAt: agent.lastActiveAt,
          checkInCount: agent.checkInCount,
          erc8004AgentId: identity?.agentId ?? agent.erc8004AgentId ?? null,
        },
        ...levelInfo,
        achievements: achievements.map((record) => {
          const def = getAchievementDefinition(record.achievementId);
          return {
            id: record.achievementId,
            name: def?.name ?? "Unknown",
            description: def?.description ?? "",
            category: def?.category ?? "onchain",
            unlockedAt: record.unlockedAt,
            ...(record.metadata && { metadata: record.metadata }),
          };
        }),
        checkIn,
        trust,
        activity,
        capabilities,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Agent lookup failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
