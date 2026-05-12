/**
 * Shared agent lookup utilities.
 *
 * Looks up AgentRecords by BTC or STX address.
 * BTC lookups remain in KV; STX lookups have been migrated to D1
 * (Phase 4.0d — fail-closed, no KV fallback).
 * Used by inbox, outbox, heartbeat, and other API routes.
 */

import { computeLevel } from "@/lib/levels";
import {
  lookupProfileByStxAddress,
  mapRowToAgentRecord,
} from "@/lib/cache/agent-profile";
import type { AgentRecord, ClaimStatus } from "@/lib/types";

/**
 * Look up an agent by BTC, STX, or taproot address.
 * For taproot (bc1p) addresses, uses the taproot: reverse index to find
 * the canonical btcAddress, then looks up the full record.
 * For BTC addresses, uses KV (btc: key — pending P4.3 migration).
 * For STX addresses, uses D1 via lookupProfileByStxAddress (Phase 4.0d).
 *
 * @param kv - Cloudflare KV namespace (used for BTC and taproot paths)
 * @param address - BTC, STX, or taproot address to look up
 * @param db - D1Database binding (optional; fail-closed on missing or error)
 * @returns AgentRecord or null if not found
 */
export async function lookupAgent(
  kv: KVNamespace,
  address: string,
  db?: D1Database
): Promise<AgentRecord | null> {
  // Taproot addresses (bc1p...) use a reverse index
  if (address.startsWith("bc1p")) {
    const canonicalBtcAddress = await kv.get(`taproot:${address}`);
    if (!canonicalBtcAddress) return null;
    const data = await kv.get(`btc:${canonicalBtcAddress}`);
    if (!data) return null;
    try {
      return JSON.parse(data) as AgentRecord;
    } catch (e) {
      console.error(`Failed to parse agent record for taproot ${address}:`, e);
      return null;
    }
  }

  // STX addresses (SP..., SM...): D1 lookup — fail-closed on error or missing binding.
  if (address.startsWith("SP") || address.startsWith("SM")) {
    try {
      if (!db) {
        console.error(
          "lookupAgent: D1 binding (DB) unavailable for STX lookup; returning null (fail-closed)",
          { stxAddress: address }
        );
        return null;
      }
      const row = await lookupProfileByStxAddress(db, address);
      return row ? mapRowToAgentRecord(row) : null;
    } catch (d1Err) {
      console.error("lookupAgent: D1 STX lookup failed; returning null (fail-closed)", {
        stxAddress: address,
        error: String(d1Err),
      });
      return null;
    }
  }

  // BTC addresses (bc1q..., bc1...) — KV lookup (P4.3 pending).
  const btcData = await kv.get(`btc:${address}`);
  if (!btcData) return null;
  try {
    return JSON.parse(btcData) as AgentRecord;
  } catch (e) {
    console.error(`Failed to parse agent record for address ${address}:`, e);
    return null;
  }
}

// --- Level-gated lookup (used by heartbeat and other gated routes) ---

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
 * parallel when possible to minimize latency.
 *
 * STX path: uses D1 via lookupProfileByStxAddress (Phase 4.0d — fail-closed).
 * BTC path: uses KV (pending P4.3 migration).
 *
 * @param kv - Cloudflare KV namespace (used for BTC path and claim lookup)
 * @param address - BTC or STX address to look up
 * @param minLevel - Minimum required level (default 0 = any)
 * @param db - D1Database binding for STX lookups (optional; fail-closed on missing or error)
 */
export async function lookupAgentWithLevel(
  kv: KVNamespace,
  address: string,
  minLevel: number = 0,
  db?: D1Database
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

  // For btc addresses, fetch agent + claim in parallel (KV — pending P4.3).
  // For stx addresses, use D1 (Phase 4.0d — fail-closed), then fetch claim from KV.
  let agent: AgentRecord | null = null;
  let claimData: string | null;

  if (prefix === "btc") {
    const [agentData, claimRaw] = await Promise.all([
      kv.get(`btc:${address}`),
      kv.get(`claim:${address}`),
    ]);
    claimData = claimRaw;
    if (!agentData) {
      return notFoundError();
    }
    try {
      agent = JSON.parse(agentData) as AgentRecord;
    } catch {
      return { error: "Failed to parse stored agent data.", status: 500 };
    }
  } else {
    // STX path: D1 lookup — fail-closed on D1 error or missing binding.
    try {
      if (!db) {
        console.error(
          "lookupAgentWithLevel: D1 binding (DB) unavailable for STX lookup; returning not-found (fail-closed)",
          { stxAddress: address }
        );
        return notFoundError();
      }
      const row = await lookupProfileByStxAddress(db, address);
      if (!row) {
        return notFoundError();
      }
      agent = mapRowToAgentRecord(row);
    } catch (d1Err) {
      console.error(
        "lookupAgentWithLevel: D1 STX lookup failed; returning not-found (fail-closed)",
        { stxAddress: address, error: String(d1Err) }
      );
      return notFoundError();
    }
    claimData = await kv.get(`claim:${agent.btcAddress}`);
  }

  // Both branches above either set agent to a non-null AgentRecord or return early.
  // TypeScript cannot narrow through the if/else here, so we assert non-null.
  const resolvedAgent = agent!;

  if (!resolvedAgent.stxAddress) {
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

  const level = computeLevel(resolvedAgent, claim);

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

  return { agent: resolvedAgent, claim, level };
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
