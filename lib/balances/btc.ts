/**
 * Fetch an agent's BTC balance across L1 (native Bitcoin) and L2 (sBTC on
 * Stacks). Used on the agent profile page; non-critical, so failures on
 * either side degrade to 0 rather than throwing.
 *
 * Caching: BOTH legs make an external call on every profile SSR (which runs
 * on every view, crawlers/OG bots included), so both are cached when a KV
 * namespace is supplied. The L2 leg hits Hiro's `/balances` under the shared
 * HIRO_API_KEY (metered against quota); the L1 leg hits mempool.space, which
 * is public but rate-limited — an uncached call per hit risks throttling and
 * adds an avoidable round-trip. `fetchL1Sats` / `fetchL2Sats` therefore each
 * read/write a short-TTL KV cache, collapsing repeat views of the same profile
 * into one upstream call per leg. Balances change slowly relative to crawler
 * cadence, so a 30-minute TTL is a good staleness/quota trade.
 */

import { SBTC_CONTRACTS } from "@/lib/inbox/constants";
import { STACKS_API_BASE } from "@/lib/identity/constants";

/** KV key prefixes + shared TTL for the balance caches (one key per leg). */
const L1_BALANCE_CACHE_PREFIX = "cache:btc-balance:";
const L2_BALANCE_CACHE_PREFIX = "cache:sbtc-balance:";
const BALANCE_CACHE_TTL_SECONDS = 30 * 60; // 30 minutes

export interface BtcBalance {
  /** Native L1 BTC balance in satoshis. 0 if fetch failed or address has no history. */
  l1Sats: number;
  /** sBTC balance on Stacks in satoshis (sBTC is 1:1 with BTC at 8 decimals). 0 if fetch failed. */
  l2Sats: number;
}

const SBTC_ASSET_ID = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.name}::${SBTC_CONTRACTS.mainnet.name}`;

/**
 * Parse a satoshi string (Stacks `/balances` returns decimal strings) into
 * a JS number safely. BigInt round-trip preserves precision exactly within
 * `Number.MAX_SAFE_INTEGER` (≈9.007e15) and clamps above it.
 *
 * Both sBTC and L1 BTC are bounded by ~21M BTC × 1e8 ≈ 2.1e15 sats — well
 * inside safe-int range — so the clamp is purely defensive against
 * malformed upstream responses.
 */
function parseSatsString(raw: string): number {
  let big: bigint;
  try {
    big = BigInt(raw);
  } catch {
    return 0;
  }
  // Use `BigInt(0)` rather than `0n` — tsconfig target is below ES2020.
  if (big <= BigInt(0)) return 0;
  const ceiling = BigInt(Number.MAX_SAFE_INTEGER);
  return big > ceiling ? Number.MAX_SAFE_INTEGER : Number(big);
}

async function fetchL1Sats(btcAddress: string, kv?: KVNamespace): Promise<number> {
  const cacheKey = `${L1_BALANCE_CACHE_PREFIX}${btcAddress}`;

  // Cache hit: one KV read replaces a rate-limited mempool.space call.
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached !== null) return parseSatsString(cached);
  }

  const url = `https://mempool.space/api/address/${btcAddress}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  // Only cache authoritative answers — a transient failure returns 0 uncached
  // so the next view retries.
  if (!res.ok) return 0;
  // mempool.space returns funded_txo_sum / spent_txo_sum as JSON numbers.
  // JSON.parse loses precision past 2^53 silently, so re-narrow with BigInt
  // via String(...) — preserves the parsed value when within safe range and
  // signals overflow (returns 0 via the catch) for malformed responses.
  const body = (await res.json()) as {
    chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number };
  };
  const fundedRaw = body.chain_stats?.funded_txo_sum;
  const spentRaw = body.chain_stats?.spent_txo_sum;
  const funded =
    typeof fundedRaw === "number" && Number.isFinite(fundedRaw) ? fundedRaw : 0;
  const spent =
    typeof spentRaw === "number" && Number.isFinite(spentRaw) ? spentRaw : 0;
  const sats = Math.max(0, funded - spent);

  if (kv) {
    // Best-effort write — a cache-write failure must never fail the read.
    try {
      await kv.put(cacheKey, String(sats), {
        expirationTtl: BALANCE_CACHE_TTL_SECONDS,
      });
    } catch {
      // ignore: the balance is still returned; only the cache write was lost.
    }
  }
  return sats;
}

async function fetchL2Sats(
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace
): Promise<number> {
  const cacheKey = `${L2_BALANCE_CACHE_PREFIX}${stxAddress}`;

  // Cache hit: one KV read replaces a metered Hiro call.
  if (kv) {
    const cached = await kv.get(cacheKey);
    if (cached !== null) return parseSatsString(cached);
  }

  const url = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/balances`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (hiroApiKey) {
    // `x-api-key` is Hiro's documented header; `x-hiro-api-key` is deprecated.
    headers["x-api-key"] = hiroApiKey;
    headers["x-hiro-api-key"] = hiroApiKey;
  }
  const res = await fetch(url, { headers });
  // Only cache authoritative answers (a real balance, including a genuine 0).
  // A transient upstream failure returns 0 uncached so the next view retries.
  if (!res.ok) return 0;
  const body = (await res.json()) as {
    fungible_tokens?: Record<string, { balance?: string }>;
  };
  const raw = body.fungible_tokens?.[SBTC_ASSET_ID]?.balance ?? "0";
  const sats = parseSatsString(raw);

  if (kv) {
    // Best-effort write — a cache-write failure must never fail the read.
    try {
      await kv.put(cacheKey, String(sats), {
        expirationTtl: BALANCE_CACHE_TTL_SECONDS,
      });
    } catch {
      // ignore: the balance is still returned; only the cache write was lost.
    }
  }
  return sats;
}

export async function fetchBtcBalance(
  btcAddress: string,
  stxAddress: string,
  hiroApiKey?: string,
  kv?: KVNamespace
): Promise<BtcBalance> {
  const [l1, l2] = await Promise.allSettled([
    fetchL1Sats(btcAddress, kv),
    fetchL2Sats(stxAddress, hiroApiKey, kv),
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
