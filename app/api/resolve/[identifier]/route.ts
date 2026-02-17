/**
 * GET /api/resolve/:identifier — Unified Agent Resolution Endpoint
 *
 * Resolves any agent identifier format to a canonical structured identity object.
 *
 * Accepted identifier formats:
 * - Numeric agent-id (e.g. "42") — looks up ERC-8004 NFT owner on-chain
 * - Taproot address (bc1p...) — resolves via taproot: reverse index
 * - Bitcoin address (bc1q..., 1..., 3...) — direct KV lookup
 * - Stacks address (SP..., SM...) — direct KV lookup
 * - BNS name (*.btc) — scans agents and matches bnsName field
 * - Display name (any other string) — scans agents and matches displayName field
 *
 * Returns a unified identity object with identity, trust, activity, and capabilities sections.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { uintCV } from "@stacks/transactions";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { getAgentLevel } from "@/lib/levels";
import { getAgentAchievements } from "@/lib/achievements";
import { getCheckInRecord } from "@/lib/heartbeat";
import { detectAgentIdentity, getReputationSummary } from "@/lib/identity";
import {
  callReadOnly,
  parseClarityValue,
  IDENTITY_REGISTRY_CONTRACT,
} from "@/lib/identity";
import { getCAIP19AgentId } from "@/lib/caip19";
import { getAgentInbox } from "@/lib/inbox/kv-helpers";

// ---------------------------------------------------------------------------
// Identifier type detection
// ---------------------------------------------------------------------------

type IdentifierType =
  | "agent-id"
  | "taproot"
  | "btc"
  | "stx"
  | "bns"
  | "display-name";

function detectIdentifierType(identifier: string): IdentifierType {
  // Numeric string → agent-id lookup
  if (/^\d+$/.test(identifier)) {
    return "agent-id";
  }

  // Taproot address (bc1p) — must come before generic bc1 check
  if (identifier.startsWith("bc1p")) {
    return "taproot";
  }

  // Bitcoin addresses (bc1q, 1..., 3...)
  if (
    identifier.startsWith("bc1") ||
    identifier.startsWith("1") ||
    identifier.startsWith("3")
  ) {
    return "btc";
  }

  // Stacks addresses
  if (identifier.startsWith("SP") || identifier.startsWith("SM")) {
    return "stx";
  }

  // BNS names
  if (identifier.endsWith(".btc")) {
    return "bns";
  }

  // Fallback: treat as display name
  return "display-name";
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Resolve an ERC-8004 agent-id to a Stacks address by calling get-owner on-chain.
 */
async function resolveAgentIdToStxAddress(
  agentId: number,
  hiroApiKey?: string
): Promise<string | null> {
  try {
    const result = await callReadOnly(
      IDENTITY_REGISTRY_CONTRACT,
      "get-owner",
      [uintCV(agentId)],
      hiroApiKey
    );
    const owner = parseClarityValue(result);
    return typeof owner === "string" ? owner : null;
  } catch {
    return null;
  }
}

/**
 * Scan all KV stx: keys to find an agent matching a predicate.
 * Used for BNS name and display name lookups.
 */
async function findAgentByScan(
  kv: KVNamespace,
  predicate: (agent: AgentRecord) => boolean
): Promise<AgentRecord | null> {
  let cursor: string | undefined;
  let listComplete = false;

  while (!listComplete) {
    const listResult = await kv.list({ prefix: "stx:", cursor });
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

    const match = values
      .filter((v): v is AgentRecord => v !== null)
      .find(predicate);

    if (match) return match;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Self-documentation response
// ---------------------------------------------------------------------------

function buildUsageResponse() {
  return NextResponse.json(
    {
      endpoint: "GET /api/resolve/:identifier",
      description:
        "Resolve any agent identifier to a canonical structured identity object. " +
        "Returns identity, trust, activity, and capabilities sections in a single response.",
      acceptedFormats: {
        "agent-id": [
          "42",
          "0",
          "100",
          "— numeric ERC-8004 on-chain agent ID",
        ],
        taproot: ["bc1p... — taproot Bitcoin address (P2TR, SegWit v1)"],
        btc: [
          "bc1q... — native SegWit Bitcoin address",
          "1... — legacy P2PKH address",
          "3... — P2SH address",
        ],
        stx: ["SP... — Stacks mainnet address", "SM... — Stacks mainnet multisig"],
        bns: ["name.btc — BNS name registered on Stacks"],
        "display-name": ["Swift Raven — deterministic display name"],
      },
      examples: [
        "/api/resolve/42",
        "/api/resolve/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        "/api/resolve/bc1pzl1p3gjmrst6nq54yfq6d75cz2vu0lmxjmrhqrm765yl7n2xlkqquvsqf",
        "/api/resolve/SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE",
        "/api/resolve/alice.btc",
        "/api/resolve/Swift%20Raven",
      ],
      responseFormat: {
        found: "boolean",
        identifier: "string (the queried identifier)",
        identifierType:
          "agent-id | taproot | btc | stx | bns | display-name",
        identity: {
          stxAddress: "SP... Stacks address",
          btcAddress: "bc1q... Bitcoin address",
          taprootAddress: "bc1p... taproot address or null",
          displayName: "deterministic display name",
          bnsName: "BNS name or null",
          agentId: "ERC-8004 on-chain agent ID (number) or null",
          caip19:
            "CAIP-19 identifier (stacks:1/sip009:.../{agentId}) or null",
        },
        trust: {
          level: "0 | 1 | 2",
          levelName: "Unverified | Registered | Genesis",
          onChainIdentity: "boolean",
          reputationScore: "number or null",
          reputationCount: "number",
        },
        activity: {
          lastActiveAt: "ISO 8601 timestamp or null",
          checkInCount: "number",
          hasInboxMessages: "boolean",
          unreadInboxCount: "number",
        },
        capabilities:
          "string[] — available features: heartbeat, inbox, x402, reputation, paid-attention",
      },
      relatedEndpoints: {
        agents: "/api/agents — List all agents with pagination",
        agentProfile: "/api/agents/:address — Agent profile by address",
        verify: "/api/verify/:address — Legacy verification endpoint",
        achievements:
          "/api/achievements?btcAddress=... — Agent achievement lookup",
      },
    },
    { status: 200 }
  );
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> }
) {
  try {
    const { identifier } = await params;

    // Self-document when no identifier is provided
    if (!identifier || identifier.trim().length === 0) {
      return buildUsageResponse();
    }

    const identifierType = detectIdentifierType(identifier);

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const hiroApiKey = env.HIRO_API_KEY;

    // -----------------------------------------------------------------------
    // Resolve identifier to AgentRecord
    // -----------------------------------------------------------------------

    let agent: AgentRecord | null = null;

    if (identifierType === "agent-id") {
      const agentId = parseInt(identifier, 10);
      if (isNaN(agentId) || agentId < 0) {
        return NextResponse.json(
          {
            found: false,
            identifier,
            identifierType,
            error: "Invalid agent-id. Must be a non-negative integer.",
          },
          { status: 400 }
        );
      }

      // Resolve agent-id to STX address via on-chain call
      const stxAddress = await resolveAgentIdToStxAddress(agentId, hiroApiKey);
      if (!stxAddress) {
        return NextResponse.json(
          {
            found: false,
            identifier,
            identifierType,
            error: `Agent ID ${agentId} not found on-chain or has no owner.`,
            note: "Agent IDs are sequential ERC-8004 identity NFT token IDs. Use POST /api/register and then call register-with-uri on identity-registry-v2 to receive an ID.",
          },
          { status: 404 }
        );
      }

      // Look up agent record by STX address
      const data = await kv.get(`stx:${stxAddress}`);
      if (data) {
        try {
          agent = JSON.parse(data) as AgentRecord;
          // Ensure the stored erc8004AgentId matches what we found on-chain
          if (agent.erc8004AgentId == null) {
            agent.erc8004AgentId = agentId;
          }
        } catch {
          return NextResponse.json(
            { error: "Failed to parse agent record." },
            { status: 500 }
          );
        }
      } else {
        // On-chain identity exists but agent not registered on platform
        return NextResponse.json(
          {
            found: false,
            identifier,
            identifierType,
            error: `Agent ID ${agentId} is minted on-chain (owner: ${stxAddress}) but this address is not registered on the AIBTC platform.`,
            nextSteps: {
              action: "Register as a new agent",
              endpoint: "POST /api/register",
              documentation: "https://aibtc.com/llms-full.txt",
            },
          },
          { status: 404 }
        );
      }
    } else if (identifierType === "taproot") {
      // Taproot: resolve via taproot: reverse index
      const canonicalBtcAddress = await kv.get(`taproot:${identifier}`);
      if (canonicalBtcAddress) {
        const value = await kv.get(`btc:${canonicalBtcAddress}`);
        if (value) {
          try {
            agent = JSON.parse(value) as AgentRecord;
          } catch {
            return NextResponse.json(
              { error: "Failed to parse agent record." },
              { status: 500 }
            );
          }
        }
      }
    } else if (identifierType === "btc") {
      const data = await kv.get(`btc:${identifier}`);
      if (data) {
        try {
          agent = JSON.parse(data) as AgentRecord;
        } catch {
          return NextResponse.json(
            { error: "Failed to parse agent record." },
            { status: 500 }
          );
        }
      }
    } else if (identifierType === "stx") {
      const data = await kv.get(`stx:${identifier}`);
      if (data) {
        try {
          agent = JSON.parse(data) as AgentRecord;
        } catch {
          return NextResponse.json(
            { error: "Failed to parse agent record." },
            { status: 500 }
          );
        }
      }
    } else if (identifierType === "bns") {
      // BNS: scan all agents and match bnsName (case-insensitive)
      agent = await findAgentByScan(
        kv,
        (a) =>
          !!a.bnsName &&
          a.bnsName.toLowerCase() === identifier.toLowerCase()
      );
    } else {
      // Display name: scan all agents and match displayName (case-insensitive)
      agent = await findAgentByScan(
        kv,
        (a) =>
          !!a.displayName &&
          a.displayName.toLowerCase() === identifier.toLowerCase()
      );
    }

    // -----------------------------------------------------------------------
    // Not found
    // -----------------------------------------------------------------------

    if (!agent) {
      return NextResponse.json(
        {
          found: false,
          identifier,
          identifierType,
          error: "Agent not found. This identifier is not registered.",
          nextSteps: {
            action: "Register as a new agent",
            endpoint: "POST /api/register",
            documentation: "https://aibtc.com/llms-full.txt",
          },
        },
        { status: 404 }
      );
    }

    // -----------------------------------------------------------------------
    // Enrich agent data (parallel fetches — same pattern as /api/agents/[address])
    // -----------------------------------------------------------------------

    const [claimData, achievements, checkInRecord, identity, inboxIndex] =
      await Promise.all([
        kv.get(`claim:${agent.btcAddress}`),
        getAgentAchievements(kv, agent.btcAddress),
        getCheckInRecord(kv, agent.btcAddress),
        // Use cached identity if available; erc8004AgentId 0 is valid (falsy but != null)
        agent.erc8004AgentId != null
          ? Promise.resolve({
              agentId: agent.erc8004AgentId,
              owner: agent.stxAddress,
              uri: "",
            })
          : detectAgentIdentity(agent.stxAddress, hiroApiKey, kv),
        getAgentInbox(kv, agent.btcAddress),
      ]);

    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch {
        // ignore
      }
    }

    // Fetch reputation if on-chain identity exists (non-critical)
    let reputation = null;
    if (identity) {
      try {
        reputation = await getReputationSummary(
          identity.agentId,
          hiroApiKey,
          kv
        );
      } catch {
        // Reputation is optional — continue without it
      }
    }

    const levelInfo = getAgentLevel(agent, claim);
    const resolvedAgentId = identity?.agentId ?? agent.erc8004AgentId ?? null;

    // -----------------------------------------------------------------------
    // Build response sections
    // -----------------------------------------------------------------------

    const identitySection = {
      stxAddress: agent.stxAddress,
      btcAddress: agent.btcAddress,
      taprootAddress: agent.taprootAddress ?? null,
      displayName: agent.displayName ?? null,
      bnsName: agent.bnsName ?? null,
      agentId: resolvedAgentId,
      caip19: getCAIP19AgentId(resolvedAgentId),
    };

    const trust = {
      level: levelInfo.level,
      levelName: levelInfo.levelName,
      onChainIdentity: !!identity,
      reputationScore: reputation?.summaryValue ?? null,
      reputationCount: reputation?.count ?? 0,
    };

    const activity = {
      lastActiveAt: agent.lastActiveAt ?? null,
      checkInCount:
        (checkInRecord?.checkInCount ?? agent.checkInCount) ?? 0,
      hasInboxMessages: !!inboxIndex,
      unreadInboxCount: inboxIndex?.unreadCount ?? 0,
    };

    // Capabilities derived from level and registration state
    const capabilities: string[] = [];
    if (levelInfo.level >= 1) {
      capabilities.push("heartbeat");
    }
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
        identifier,
        identifierType,
        identity: identitySection,
        trust,
        activity,
        capabilities,
        // Include level progression info for convenience
        nextLevel: levelInfo.nextLevel,
        achievementCount: achievements.length,
      },
      {
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Resolution failed: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
