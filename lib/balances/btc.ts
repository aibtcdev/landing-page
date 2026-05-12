/**
 * Fetch an agent's BTC balance across L1 (native Bitcoin) and L2 (sBTC on
 * Stacks). Used on the agent profile page; non-critical, so failures on
 * either side degrade to 0 rather than throwing.
 *
 * Both APIs are public and free; no caching layer here — profile pages are
 * SSR'd, low-volume, and balances change frequently enough that a cache
 * would mostly serve stale numbers anyway.
 */

import { SBTC_CONTRACTS } from "@/lib/inbox/constants";
import { STACKS_API_BASE } from "@/lib/identity/constants";

export interface BtcBalance {
  /** Native L1 BTC balance in satoshis. 0 if fetch failed or address has no history. */
  l1Sats: number;
  /** sBTC balance on Stacks in satoshis (sBTC is 1:1 with BTC at 8 decimals). 0 if fetch failed. */
  l2Sats: number;
}

const SBTC_ASSET_ID = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.name}::${SBTC_CONTRACTS.mainnet.name}`;

async function fetchL1Sats(btcAddress: string): Promise<number> {
  const url = `https://mempool.space/api/address/${btcAddress}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return 0;
  const body = (await res.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const funded = body.chain_stats?.funded_txo_sum ?? 0;
  const spent = body.chain_stats?.spent_txo_sum ?? 0;
  return Math.max(0, funded - spent);
}

async function fetchL2Sats(stxAddress: string, hiroApiKey?: string): Promise<number> {
  const url = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/balances`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hiroApiKey) headers["x-hiro-api-key"] = hiroApiKey;
  const res = await fetch(url, { headers });
  if (!res.ok) return 0;
  const body = (await res.json()) as {
    fungible_tokens?: Record<string, { balance?: string }>;
  };
  const raw = body.fungible_tokens?.[SBTC_ASSET_ID]?.balance ?? "0";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function fetchBtcBalance(
  btcAddress: string,
  stxAddress: string,
  hiroApiKey?: string
): Promise<BtcBalance> {
  const [l1, l2] = await Promise.allSettled([
    fetchL1Sats(btcAddress),
    fetchL2Sats(stxAddress, hiroApiKey),
  ]);
  return {
    l1Sats: l1.status === "fulfilled" ? l1.value : 0,
    l2Sats: l2.status === "fulfilled" ? l2.value : 0,
  };
}

/** Format sats as BTC with up to 8 decimals, trailing zeros trimmed. */
export function formatBtc(sats: number): string {
  if (sats <= 0) return "0";
  const btc = sats / 1e8;
  return btc.toFixed(8).replace(/\.?0+$/, "");
}
