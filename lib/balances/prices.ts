/**
 * Token price fetcher for the dashboard.
 *
 * Single CoinGecko call returns BTC + STX. sBTC is treated as 1:1 with BTC.
 * Cached in KV (`cache:prices`) with a 5-minute TTL so each rebuild reuses
 * the same price snapshot.
 *
 * On upstream failure we serve stale prices if any exist, otherwise return
 * zeros and surface the error to the caller (which logs it). Per the B3
 * runbook pattern we do NOT log per-call success at INFO — only sampled
 * cache events and unconditional WARN on upstream failure.
 */

import {
  COINGECKO_PRICE_URL,
  PRICE_CACHE_KEY,
  PRICE_CACHE_TTL_SECONDS,
} from "./constants";
import { samplingFor, type Logger } from "@/lib/logging";

const FETCH_TIMEOUT_MS = 6_000;

export interface PriceSnapshot {
  /** Symbol (uppercase) → USD price. Always includes BTC, STX, sBTC keys. */
  prices: Record<string, number>;
  /** ISO 8601 timestamp the upstream call resolved. */
  fetchedAt: string;
}

/** Internal CoinGecko response shape. */
interface CoinGeckoResponse {
  bitcoin?: { usd?: number };
  blockstack?: { usd?: number };
}

function emptySnapshot(): PriceSnapshot {
  return {
    prices: { BTC: 0, sBTC: 0, STX: 0 },
    fetchedAt: new Date(0).toISOString(),
  };
}

async function fetchFromCoinGecko(
  logger?: Logger
): Promise<PriceSnapshot | null> {
  try {
    const response = await fetch(COINGECKO_PRICE_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      logger?.warn("dashboard.prices.upstream_error", {
        status: response.status,
      });
      return null;
    }
    const data = (await response.json()) as CoinGeckoResponse;
    const btcUsd = data.bitcoin?.usd ?? 0;
    const stxUsd = data.blockstack?.usd ?? 0;
    return {
      prices: { BTC: btcUsd, sBTC: btcUsd, STX: stxUsd },
      fetchedAt: new Date().toISOString(),
    };
  } catch (e) {
    logger?.warn("dashboard.prices.upstream_error", {
      error: (e as Error).message,
    });
    return null;
  }
}

/**
 * Get the current price snapshot — KV-cached for 5 minutes.
 *
 * Returns the cached snapshot when fresh. On cache miss, fetches CoinGecko
 * and writes the result. On upstream failure with no cache, returns zeros
 * (rebuilds will still produce a usable snapshot — totals will be 0).
 */
export async function getPriceSnapshot(
  kv: KVNamespace,
  logger?: Logger
): Promise<PriceSnapshot> {
  const cached = await kv.get(PRICE_CACHE_KEY);
  if (cached) {
    try {
      const snap = JSON.parse(cached) as PriceSnapshot;
      const sample = samplingFor("cache.event", "dashboard.prices.hit");
      if (sample.keep) {
        logger?.info("dashboard.prices.cache_hit", {
          sampled: true,
          sample_rate: sample.rate,
        });
      }
      return snap;
    } catch {
      // Corrupted entry — drop it and refetch.
      await kv.delete(PRICE_CACHE_KEY).catch(() => {});
    }
  }

  const fresh = await fetchFromCoinGecko(logger);
  if (!fresh) return emptySnapshot();

  try {
    await kv.put(PRICE_CACHE_KEY, JSON.stringify(fresh), {
      expirationTtl: PRICE_CACHE_TTL_SECONDS,
    });
  } catch {
    // Best-effort — caller still gets the fresh snapshot
  }
  return fresh;
}
