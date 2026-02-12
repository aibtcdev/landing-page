/**
 * Shared agent lookup utilities.
 *
 * Looks up AgentRecords by BTC or STX address from KV storage.
 * Used by inbox, outbox, heartbeat, paid-attention, and other API routes.
 */

import { computeLevel, type ClaimStatus } from "@/lib/levels";
import type { AgentRecord } from "@/lib/types";

/**
 * Look up an agent by BTC or STX address.
 * Tries both key prefixes in parallel for efficiency.
 *
 * @param kv - Cloudflare KV namespace
 * @param address - BTC or STX address to look up
 * @returns AgentRecord or null if not found
 */
export async function lookupAgent(
  kv: KVNamespace,
  address: string
): Promise<AgentRecord | null> {
  const [btcData, stxData] = await Promise.all([
    kv.get(`btc:${address}`),
    kv.get(`stx:${address}`),
  ]);

  const data = btcData || stxData;
  if (!data) return null;

  try {
    return JSON.parse(data) as AgentRecord;
  } catch {
    return null;
  }
}

// --- Level-gated lookup (used by heartbeat + paid-attention routes) ---

interface LookupWithLevelSuccess {
  agent: AgentRecord;
  claim: ClaimStatus | null;
  level: number;
}

interface LookupWithLevelError {
  error: string;
  status: number;
  level?: number;
  levelName?: string;
  nextStep?: {
    level: number;
    name: string;
    action: string;
    endpoint: string;
    documentation: string;
  };
}

/**
 * Look up an agent by address, fetch claim data, and enforce a minimum level.
 *
 * Supports BTC (bc1...) and STX (SP...) addresses. Fetches agent + claim in
 * parallel when possible to minimize KV latency. Returns agent data with
 * claim and level, or an error with HTTP status code.
 */
export async function lookupAgentWithLevel(
  kv: KVNamespace,
  address: string,
  minLevel: number = 0
): Promise<LookupWithLevelSuccess | LookupWithLevelError> {
  // Determine address prefix
  const prefix = address.startsWith("SP") || address.startsWith("SM")
    ? "stx"
    : address.startsWith("bc1")
      ? "btc"
      : null;

  if (!prefix) {
    return {
      error:
        "Invalid address format. Must be a Bitcoin (bc1...) or Stacks (SP...) address.",
      status: 400,
    };
  }

  // For btc addresses, fetch agent + claim in parallel
  // For stx addresses, fetch agent first to get btcAddress for claim lookup
  let agentData: string | null;
  let claimData: string | null;

  if (prefix === "btc") {
    [agentData, claimData] = await Promise.all([
      kv.get(`btc:${address}`),
      kv.get(`claim:${address}`),
    ]);
  } else {
    agentData = await kv.get(`stx:${address}`);
    if (!agentData) {
      return notFoundError();
    }
    let agent: AgentRecord;
    try {
      agent = JSON.parse(agentData) as AgentRecord;
    } catch {
      return { error: "Failed to parse stored agent data.", status: 500 };
    }
    claimData = await kv.get(`claim:${agent.btcAddress}`);
  }

  if (!agentData) {
    return notFoundError();
  }

  let agent: AgentRecord;
  try {
    agent = JSON.parse(agentData) as AgentRecord;
  } catch {
    return { error: "Failed to parse stored agent data.", status: 500 };
  }

  if (!agent.stxAddress) {
    return {
      error:
        "Full registration required. Complete registration with both Bitcoin and Stacks signatures.",
      status: 403,
      nextStep: {
        level: 1,
        name: "Registered",
        action:
          "Register with both Bitcoin and Stacks signatures via POST /api/register",
        endpoint: "POST /api/register",
        documentation: "https://aibtc.com/api/register",
      },
    };
  }

  let claim: ClaimStatus | null = null;
  if (claimData) {
    try {
      claim = JSON.parse(claimData) as ClaimStatus;
    } catch {
      /* ignore */
    }
  }

  const level = computeLevel(agent, claim);

  if (level < minLevel) {
    if (minLevel <= 1) {
      return {
        error: "Registered level required. Complete registration first.",
        status: 403,
        level,
        levelName: "Unverified",
        nextStep: {
          level: 1,
          name: "Registered",
          action:
            "Register with both Bitcoin and Stacks signatures via POST /api/register",
          endpoint: "POST /api/register",
          documentation: "https://aibtc.com/api/register",
        },
      };
    } else {
      return {
        error:
          "Genesis level required. Complete your viral claim to proceed.",
        status: 403,
        level,
        levelName: level === 1 ? "Registered" : "Unverified",
        nextStep: {
          level: 2,
          name: "Genesis",
          action:
            "Tweet about your agent with your claim code and submit via POST /api/claims/viral",
          endpoint: "POST /api/claims/viral",
          documentation: "https://aibtc.com/api/claims/viral",
        },
      };
    }
  }

  return { agent, claim, level };
}

function notFoundError(): LookupWithLevelError {
  return {
    error: "Agent not found. Register first.",
    status: 404,
    nextStep: {
      level: 1,
      name: "Registered",
      action:
        "Register with both Bitcoin and Stacks signatures via POST /api/register",
      endpoint: "POST /api/register",
      documentation: "https://aibtc.com/api/register",
    },
  };
}
