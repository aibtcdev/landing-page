/**
 * Per-agent balance fetcher: BTC L1 + STX + sBTC.
 *
 * Cost discipline (B3 runbook pattern):
 * - Upstream-failure sentinel `cache:dashboard:upstream-fail:{scope}:{addr}`
 *   with 60s TTL. When set, that fetch is skipped — protects against one
 *   slow agent forcing every rebuild to retry the same dead upstream.
 * - No per-agent KV cache for the result itself (the dashboard snapshot
 *   already holds that). One snapshot key, no fan-out writes.
 * - All upstream calls go through `stacksApiFetch` (Hiro) or a hand-rolled
 *   AbortSignal-bounded fetch (mempool.space) so nothing hangs the worker.
 *
 * No USD valuation — we only surface raw balances for BTC L1, STX, sBTC.
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
 * Fetch Stacks balances (STX + every fungible token the address holds) from
 * Hiro. We only care about STX and sBTC out of the response — other SIP-10s
 * are dropped. Returns null when the upstream fails or the sentinel is set.
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
 * Convert raw integer balance (string or bigint) to a number scaled by
 * decimals. Acceptable precision for display — agent balances rarely exceed
 * the safe integer range once divided by decimals.
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
 * Find the sBTC balance entry inside Hiro's fungible_tokens map.
 * Hiro returns asset ids in the form `SP….contract-name::token-name`.
 */
function extractSbtcRaw(
  fungibles: Record<string, HiroFungibleTokenEntry> | undefined
): string {
  if (!fungibles) return "0";
  for (const [assetId, entry] of Object.entries(fungibles)) {
    const [contract] = assetId.split("::");
    if (contract === SBTC_CONTRACT_ID) return entry.balance ?? "0";
  }
  return "0";
}

export interface AgentBalanceFetchResult {
  tokens: TokenBalance[];
  /** Set when at least one upstream failed and the result is partial. */
  partial?: boolean;
}

/**
 * Fetch BTC L1 + STX + sBTC for a single agent. Runs the two upstream
 * calls in parallel. Tokens with zero balance are dropped from the result.
 */
export async function fetchAgentBalances(
  stxAddress: string,
  btcAddress: string,
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
    tokens.push({
      symbol: "BTC",
      balance: btcSats.toString(),
      decimals: BTC_DECIMALS,
      amount: toAmount(btcSats, BTC_DECIMALS),
    });
  }

  if (stacksBalances) {
    const stxRaw = stacksBalances.stx?.balance;
    if (stxRaw && stxRaw !== "0") {
      tokens.push({
        symbol: "STX",
        balance: stxRaw,
        decimals: STX_DECIMALS,
        amount: toAmount(stxRaw, STX_DECIMALS),
      });
    }
    const sbtcRaw = extractSbtcRaw(stacksBalances.fungible_tokens);
    if (sbtcRaw !== "0") {
      tokens.push({
        symbol: "sBTC",
        balance: sbtcRaw,
        decimals: SBTC_DECIMALS,
        amount: toAmount(sbtcRaw, SBTC_DECIMALS),
      });
    }
  }

  const partial = btcSats === null || stacksBalances === null;
  return partial ? { tokens, partial } : { tokens };
}
