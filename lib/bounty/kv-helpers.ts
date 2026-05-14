/**
 * KV helpers for the bounty system.
 *
 * No record mirror — D1 is sole source of truth. KV is used only for txid
 * uniqueness across bounties (defense in depth: the D1 unique partial index
 * already enforces this, but the KV reservation lets us reject a duplicate
 * before doing the expensive Hiro fetch).
 *
 * Callers pass txids as they came from Hiro (the canonical `tx_id` field).
 * No normalization in this layer — what Hiro returns is what gets stored.
 */

import { KV_PREFIXES, PAID_TXID_TTL_SECONDS } from "./constants";

/**
 * Has this txid already been used to mark another bounty paid?
 *
 * Returns the bountyId on a hit, or null on a miss. Callers should reject
 * with 409 on a hit. The D1 unique partial index is the durable enforcement
 * — this is the cheap pre-check.
 */
export async function isTxidRedeemed(
  kv: KVNamespace,
  txid: string
): Promise<string | null> {
  return await kv.get(`${KV_PREFIXES.PAID_TXID}${txid}`);
}

/**
 * Reserve a txid as having been used to pay a specific bounty.
 *
 * Called after successful on-chain verification + D1 UPDATE. The 365-day TTL
 * gives us plenty of headroom for chain history while keeping the key set
 * from growing unbounded.
 */
export async function reserveTxid(
  kv: KVNamespace,
  txid: string,
  bountyId: string
): Promise<void> {
  await kv.put(`${KV_PREFIXES.PAID_TXID}${txid}`, bountyId, {
    expirationTtl: PAID_TXID_TTL_SECONDS,
  });
}
