import type { AgentRecord } from "@/lib/types";

/**
 * Normalize an AgentRecord so every key is always present.
 * Optional fields default to null (strings/objects) or 0 (numbers).
 * Ensures agents always receive a predictable shape from any endpoint.
 */
export function normalizeAgentRecord(agent: AgentRecord) {
  return {
    stxAddress: agent.stxAddress,
    btcAddress: agent.btcAddress,
    stxPublicKey: agent.stxPublicKey,
    btcPublicKey: agent.btcPublicKey,
    taprootAddress: agent.taprootAddress ?? null,
    displayName: agent.displayName ?? null,
    description: agent.description ?? null,
    bnsName: agent.bnsName ?? null,
    owner: agent.owner ?? null,
    verifiedAt: agent.verifiedAt,
    lastActiveAt: agent.lastActiveAt ?? null,
    checkInCount: agent.checkInCount ?? 0,
    erc8004AgentId: agent.erc8004AgentId ?? null,
    nostrPublicKey: agent.nostrPublicKey ?? null,
    lastIdentityCheck: agent.lastIdentityCheck ?? null,
    referredBy: agent.referredBy ?? null,
  };
}
