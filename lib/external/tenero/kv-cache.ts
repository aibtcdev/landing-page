/**
 * KV cache layer for Tenero token prices.
 *
 * Single key per token (`tenero:price:{tokenId}`) with the price and the
 * timestamp it was written. The SchedulerDO's Tenero refresh task is the
 * only writer; SSR routes and `/api/prices` are read-only consumers.
 *
 * Writes use a generous TTL ceiling (24h) so a paused scheduler still leaves
 * a usable-but-stale value rather than nothing — the reader is responsible
 * for deciding whether a stale value is acceptable using `fetchedAt`.
 */

export const TENERO_PRICE_KV_PREFIX = "tenero:price:";

/** TTL ceiling for KV entries. Refresh cadence is 5min so this is just a safety net. */
export const TENERO_PRICE_KV_TTL_SECONDS = 24 * 60 * 60;

export interface CachedTokenPrice {
  /** USD price; null means Tenero confirmed no published price (vs. fetch failure). */
  priceUsd: number | null;
  /** Unix millis when this value was written. */
  fetchedAt: number;
  /** Optional: minute-remaining at write time, for adaptive cadence inspection. */
  minuteRemaining: number | null;
  /** Optional: month-remaining at write time. */
  monthRemaining: number | null;
}

function kvKey(tokenId: string): string {
  return `${TENERO_PRICE_KV_PREFIX}${tokenId}`;
}

export async function getCachedTokenPrice(
  kv: KVNamespace,
  tokenId: string
): Promise<CachedTokenPrice | null> {
  const raw = await kv.get(kvKey(tokenId), "json");
  if (!raw) return null;
  // Light shape check — anything unrecognized is treated as a cache miss
  // rather than throwing, since we read this from SSR paths that must
  // always render.
  const obj = raw as Partial<CachedTokenPrice>;
  if (typeof obj.fetchedAt !== "number") return null;
  return {
    priceUsd:
      typeof obj.priceUsd === "number" && Number.isFinite(obj.priceUsd)
        ? obj.priceUsd
        : null,
    fetchedAt: obj.fetchedAt,
    minuteRemaining:
      typeof obj.minuteRemaining === "number" ? obj.minuteRemaining : null,
    monthRemaining:
      typeof obj.monthRemaining === "number" ? obj.monthRemaining : null,
  };
}

export async function setCachedTokenPrice(
  kv: KVNamespace,
  tokenId: string,
  value: CachedTokenPrice
): Promise<void> {
  await kv.put(kvKey(tokenId), JSON.stringify(value), {
    expirationTtl: TENERO_PRICE_KV_TTL_SECONDS,
  });
}

/** Read many token prices in parallel — useful for SSR paths that need a Map. */
export async function getCachedTokenPrices(
  kv: KVNamespace,
  tokenIds: readonly string[]
): Promise<Map<string, CachedTokenPrice>> {
  const out = new Map<string, CachedTokenPrice>();
  if (tokenIds.length === 0) return out;
  const results = await Promise.all(
    tokenIds.map(async (id) => [id, await getCachedTokenPrice(kv, id)] as const)
  );
  for (const [id, cached] of results) {
    if (cached) out.set(id, cached);
  }
  return out;
}
