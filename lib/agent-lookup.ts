/**
 * Shared agent lookup utility.
 *
 * Looks up an AgentRecord by BTC or STX address from KV storage.
 * Used by inbox, outbox, and other API routes that need to resolve agents.
 */

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
