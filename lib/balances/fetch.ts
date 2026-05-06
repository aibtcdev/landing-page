/**
 * Per-agent balance fetcher: BTC L1 + Stacks (STX + sBTC + SIP-10s).
 *
 * Cost discipline (B3 runbook pattern):
 * - Upstream-failure sentinel `cache:dashboard:upstream-fail:{scope}:{addr}`
 *   with 60s TTL. When set, that fetch is skipped — protects against one
 *   slow agent forcing every rebuild to retry the same dead upstream.
 * - No per-agent KV cache for the result itself (the dashboard snapshot
 *   already holds that). One snapshot key, no fan-out writes.
 * - All upstream calls go through `stacksApiFetch` (Hiro) or a hand-rolled
 *   AbortSignal-bounded fetch (mempool.space) so nothing hangs the worker.
 */

import { stacksApiFetch, buildHiroHeaders } from "@/lib/stacks-api-fetch";
import { STACKS_API_BASE } from "@/lib/identity/constants";
import type { Logger } from "@/lib/logging";
import {
  BALANCE_FETCH_TIMEOUT_MS,
  BTC_DECIMALS,
  MEMPOOL_API_BASE,
  SBTC_CONTRACT_ID,
  SBTC_DECIMALS,
  STX_DECIMALS,
  UPSTREAM_FAIL_PREFIX,
  UPSTREAM_FAIL_TTL_SECONDS,
} from "./constants";
import type { PriceSnapshot } from "./prices";
import type { TokenBalance } from "./types";

interface MempoolAddressStats {
  funded_txo_sum?: number;
  spent_txo_sum?: number;
}

interface MempoolAddressResponse {
  chain_stats?: MempoolAddressStats;
  mempool_stats?: MempoolAddressStats;
}

interface HiroFungibleTokenEntry {
  balance?: string;
}

interface HiroBalancesResponse {
  stx?: { balance?: string };
  fungible_tokens?: Record<string, HiroFungibleTokenEntry>;
}

async function isUpstreamFailed(
  kv: KVNamespace,
  scope: "btc" | "stx",
  address: string
): Promise<boolean> {
  const key = `${UPSTREAM_FAIL_PREFIX}${scope}:${address}`;
  return (await kv.get(key)) !== null;
}

async function markUpstreamFailed(
  kv: KVNamespace,
  scope: "btc" | "stx",
  address: string
): Promise<void> {
  const key = `${UPSTREAM_FAIL_PREFIX}${scope}:${address}`;
  try {
    await kv.put(key, "1", { expirationTtl: UPSTREAM_FAIL_TTL_SECONDS });
  } catch {
    // Best-effort — worst case is the next request retries the dead upstream
  }
}

/**
 * Sum confirmed BTC L1 balance (sats) from mempool.space.
 * Returns null when the upstream fails or the sentinel is set.
 */
async function fetchBtcL1Sats(
  btcAddress: string,
  kv: KVNamespace,
  logger?: Logger
): Promise<bigint | null> {
  if (await isUpstreamFailed(kv, "btc", btcAddress)) return null;
  try {
    const response = await fetch(`${MEMPOOL_API_BASE}/address/${btcAddress}`, {
      signal: AbortSignal.timeout(BALANCE_FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      await markUpstreamFailed(kv, "btc", btcAddress);
      logger?.warn("dashboard.balance.btc_upstream_error", {
        status: response.status,
        btcAddress,
      });
      return null;
    }
    const data = (await response.json()) as MempoolAddressResponse;
    const funded = BigInt(data.chain_stats?.funded_txo_sum ?? 0);
    const spent = BigInt(data.chain_stats?.spent_txo_sum ?? 0);
    return funded - spent;
  } catch (e) {
    await markUpstreamFailed(kv, "btc", btcAddress);
    logger?.warn("dashboard.balance.btc_upstream_error", {
      error: (e as Error).message,
      btcAddress,
    });
    return null;
  }
}

/**
 * Fetch all Stacks balances (STX + every fungible token the address holds)
 * from Hiro `/extended/v1/address/{principal}/balances`.
 * Returns null when the upstream fails or the sentinel is set.
 */
async function fetchStacksBalances(
  stxAddress: string,
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  logger?: Logger
): Promise<HiroBalancesResponse | null> {
  if (await isUpstreamFailed(kv, "stx", stxAddress)) return null;
  const url = `${STACKS_API_BASE}/extended/v1/address/${stxAddress}/balances`;
  try {
    const response = await stacksApiFetch(
      url,
      { method: "GET", headers: buildHiroHeaders(hiroApiKey) },
      { retries: 1, retries429: 2, logger }
    );
    if (!response.ok) {
      await markUpstreamFailed(kv, "stx", stxAddress);
      logger?.warn("dashboard.balance.stx_upstream_error", {
        status: response.status,
        stxAddress,
      });
      return null;
    }
    return (await response.json()) as HiroBalancesResponse;
  } catch (e) {
    await markUpstreamFailed(kv, "stx", stxAddress);
    logger?.warn("dashboard.balance.stx_upstream_error", {
      error: (e as Error).message,
      stxAddress,
    });
    return null;
  }
}

/**
 * Convert raw integer balance (string) to a number scaled by decimals.
 * Acceptable precision for display — agent balances rarely exceed
 * the number range once divided by decimals.
 */
function toAmount(rawBalance: string | bigint, decimals: number): number {
  const raw = typeof rawBalance === "bigint" ? rawBalance : BigInt(rawBalance);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = Number(raw / divisor);
  // Fractional component preserved separately to avoid BigInt → number truncation
  const frac = Number(raw % divisor) / Number(divisor);
  return whole + frac;
}

/**
 * Build a TokenBalance for a Stacks fungible token entry.
 * Returns null if balance is zero (we drop empty positions to keep the
 * snapshot lean).
 */
function buildSip10Balance(
  assetId: string,
  raw: string,
  prices: Record<string, number>
): TokenBalance | null {
  if (!raw || raw === "0") return null;
  // Hiro asset id format: "SP....contract-name::token-name"
  const [contract, tokenName] = assetId.split("::");
  // sBTC has known decimals + price
  if (contract === SBTC_CONTRACT_ID) {
    const amount = toAmount(raw, SBTC_DECIMALS);
    const price = prices.sBTC ?? 0;
    return {
      symbol: "sBTC",
      contract,
      balance: raw,
      decimals: SBTC_DECIMALS,
      amount,
      priceUsd: price,
      usdValue: amount * price,
    };
  }
  // Other SIP-10s: we don't have decimals on hand and no price source,
  // so we surface the raw balance with 0 decimals + 0 USD. UI can show
  // "untracked token — count only".
  return {
    symbol: tokenName ?? assetId,
    contract,
    balance: raw,
    decimals: 0,
    amount: Number(raw),
    priceUsd: 0,
    usdValue: 0,
  };
}

export interface AgentBalanceFetchResult {
  tokens: TokenBalance[];
  totalUsd: number;
  /** Set when at least one upstream failed and the result is partial. */
  partial?: boolean;
}

/**
 * Fetch every balance for a single agent and value it in USD.
 * Runs the BTC L1 + Stacks fetches in parallel.
 */
export async function fetchAgentBalances(
  stxAddress: string,
  btcAddress: string,
  prices: PriceSnapshot,
  kv: KVNamespace,
  hiroApiKey: string | undefined,
  logger?: Logger
): Promise<AgentBalanceFetchResult> {
  const [btcSats, stacksBalances] = await Promise.all([
    fetchBtcL1Sats(btcAddress, kv, logger),
    fetchStacksBalances(stxAddress, kv, hiroApiKey, logger),
  ]);

  const tokens: TokenBalance[] = [];

  if (btcSats !== null && btcSats > BigInt(0)) {
    const amount = toAmount(btcSats, BTC_DECIMALS);
    const price = prices.prices.BTC ?? 0;
    tokens.push({
      symbol: "BTC",
      balance: btcSats.toString(),
      decimals: BTC_DECIMALS,
      amount,
      priceUsd: price,
      usdValue: amount * price,
    });
  }

  if (stacksBalances) {
    const stxRaw = stacksBalances.stx?.balance;
    if (stxRaw && stxRaw !== "0") {
      const amount = toAmount(stxRaw, STX_DECIMALS);
      const price = prices.prices.STX ?? 0;
      tokens.push({
        symbol: "STX",
        balance: stxRaw,
        decimals: STX_DECIMALS,
        amount,
        priceUsd: price,
        usdValue: amount * price,
      });
    }
    const fungibles = stacksBalances.fungible_tokens ?? {};
    for (const [assetId, entry] of Object.entries(fungibles)) {
      const tb = buildSip10Balance(assetId, entry.balance ?? "0", prices.prices);
      if (tb) tokens.push(tb);
    }
  }

  const totalUsd = tokens.reduce((sum, t) => sum + t.usdValue, 0);
  const partial = btcSats === null || stacksBalances === null;
  return partial ? { tokens, totalUsd, partial } : { tokens, totalUsd };
}
