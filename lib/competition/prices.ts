/**
 * Historical USD price store for the trading-comp leaderboard.
 *
 * Built on Tenero's OHLC endpoint so P/L is computed against the price that
 * actually prevailed at each swap's `burn_block_time` — not today's prices.
 *
 * Split into two surfaces with strict separation:
 *
 * - **Read path** (`getCachedHistory`, `getCachedHistories`, `priceAt`) —
 *   consumed by the P/L aggregator. Pure KV read; NEVER fetches upstream.
 *   Returns `null` for tokens the cron hasn't filled yet, OR for a
 *   timestamp bucket that has no candle (e.g., gap in OHLC coverage).
 *
 * - **Refresh path** (`refreshTokenHistory`, `refreshAllHistories`) —
 *   consumed by the leaderboard-refresh cron. Hits
 *   `https://api.tenero.io/v1/stacks/tokens/{contract_id}/ohlc?period=1h&from=...&to=...`
 *   for each token in `REFRESHABLE_ASSET_IDS`, writes one KV blob per token
 *   containing every candle's bucket-start → close price.
 *
 * Why per-token blobs (not per-bucket keys): the request-path lookup is
 *   `priceAt(history, burn_block_time)` which is O(1) hash lookup once the
 *   history is in memory. One KV read per token used in the comp beats one
 *   read per swap.
 *
 * Tenero native STX:
 *   Native STX prices come from `/v1/stacks/tokens/stx/ohlc` — Tenero
 *   accepts the literal address `"stx"`, which matches our `STX_ASSET_ID`
 *   synthetic id. SIP-10 contract ids have their `::asset` suffix stripped
 *   for the URL because Tenero's API doesn't include it.
 *
 * Caveat: tokens we can't price (Tenero returns no candle for a bucket, or
 * the token isn't in TOKEN_DECIMALS) read back as `null`. The P/L
 * calculator skips trades whose legs have null prices rather than treating
 * them as zero — keeps the leaderboard honest (unpriced ≠ zero economic
 * value).
 */

import type { Logger } from "@/lib/logging";
import { STX_ASSET_ID } from "./parse";
import { TOKEN_DECIMALS } from "./decimals";

const TENERO_BASE = "https://api.tenero.io/v1/stacks";

/** KV prefix for cached per-token price histories. One key per asset id. */
export const PRICE_HISTORY_PREFIX = "comp:price-history:";

/**
 * KV TTL for cached histories. Sized longer than the leaderboard snapshot
 * TTL so the histories survive across a few failed cron ticks; if the
 * snapshot disappears we'd rather rebuild from cached histories than
 * re-fetch every candle from Tenero.
 */
export const PRICE_HISTORY_TTL_SECONDS = 24 * 60 * 60;

/**
 * OHLC bucket period. 1h chosen for two reasons:
 *   1. Coarse enough that one Tenero fetch (limit=1000) covers ~42 days
 *      of comp activity in a single call.
 *   2. Fine enough that intraday volatility (matters for fast-moving
 *      tokens like sBTC) is captured.
 */
export const PRICE_OHLC_PERIOD = "1h" as const;
export const PRICE_OHLC_PERIOD_SECONDS = 60 * 60;

/** Per-attempt timeout for upstream OHLC fetches. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Bucket a unix-seconds timestamp to the OHLC period it belongs to.
 * Tenero's candle for time `t` covers [t, t + period). Pricing a swap at
 * `burn_block_time` means looking up the candle that contains it.
 */
export function bucketOf(unixSeconds: number, periodSeconds = PRICE_OHLC_PERIOD_SECONDS): number {
  if (!Number.isFinite(unixSeconds) || unixSeconds < 0) return 0;
  return Math.floor(unixSeconds / periodSeconds) * periodSeconds;
}

/**
 * Cached price history blob for a single asset id. `candles` is a
 * sparse map of bucket-start unix seconds → close USD price. Sparse so a
 * gap in Tenero coverage maps to `undefined` (skip from P/L) rather than
 * zero.
 *
 * Stored as JSON in KV with the numeric bucket keys serialised as
 * strings — `priceAt` handles the lookup transparently.
 */
export interface PriceHistory {
  fetchedAt: string;
  period: typeof PRICE_OHLC_PERIOD;
  /** Earliest bucket-start covered by this history. */
  fromTs: number;
  /** Latest bucket-start covered by this history. */
  toTs: number;
  candles: Record<string, number>;
}

interface TeneroOhlcCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface TeneroOhlcResponse {
  statusCode: number;
  message?: string;
  data: TeneroOhlcCandle[] | null;
}

/**
 * Strip the `::asset` suffix off a Stacks SIP-10 asset id to get the
 * contract id Tenero expects. Native STX (`STX_ASSET_ID = "stx"`) passes
 * through unchanged — Tenero's OHLC endpoint accepts `stx` as the literal
 * address.
 */
function toTeneroAddress(assetId: string): string {
  if (assetId === STX_ASSET_ID) return "stx";
  const idx = assetId.indexOf("::");
  return idx >= 0 ? assetId.slice(0, idx) : assetId;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

// ── Read path (request handlers / aggregator; KV only) ────────────────────────

/**
 * Look up the close price for a token at a specific historical timestamp.
 * Returns null when the history is missing, the bucket has no candle, or
 * the bucket falls outside the history's covered range.
 */
export function priceAt(history: PriceHistory | null, unixSeconds: number): number | null {
  if (!history) return null;
  const bucket = bucketOf(unixSeconds);
  const close = history.candles[String(bucket)];
  return typeof close === "number" && Number.isFinite(close) && close > 0 ? close : null;
}

/** Read one token's cached price history. Null on miss or KV error. */
export async function getCachedHistory(
  kv: KVNamespace,
  assetId: string,
  logger?: Logger
): Promise<PriceHistory | null> {
  const key = `${PRICE_HISTORY_PREFIX}${assetId}`;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as PriceHistory;
  } catch (err) {
    logger?.warn?.("competition.prices.kv_read_failed", {
      assetId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Read many tokens' histories in parallel. Returns a Map keyed by
 * assetId; missing/uncached tokens map to null.
 */
export async function getCachedHistories(
  kv: KVNamespace,
  assetIds: readonly string[],
  logger?: Logger
): Promise<Map<string, PriceHistory | null>> {
  const unique = Array.from(new Set(assetIds));
  const entries = await Promise.all(
    unique.map(
      async (id) => [id, await getCachedHistory(kv, id, logger)] as const
    )
  );
  return new Map(entries);
}

// ── Refresh path (cron-only; hits upstream) ───────────────────────────────────

/**
 * Asset ids the refresh cron should keep priced. Sourced from
 * `TOKEN_DECIMALS` so adding a token to that map (in lib/competition/
 * decimals.ts) automatically opts it into refresh + leaderboard pricing.
 */
export const REFRESHABLE_ASSET_IDS: readonly string[] = Object.keys(TOKEN_DECIMALS);

async function fetchOhlcCandles(
  assetId: string,
  fromTs: number,
  toTs: number,
  logger?: Logger
): Promise<TeneroOhlcCandle[] | null> {
  const addr = toTeneroAddress(assetId);
  const url =
    `${TENERO_BASE}/tokens/${encodeURIComponent(addr)}/ohlc` +
    `?period=${PRICE_OHLC_PERIOD}&from=${fromTs}&to=${toTs}&limit=1000`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      logger?.warn?.("competition.prices.tenero_non_ok", {
        assetId,
        status: r.status,
      });
      return null;
    }
    const body = (await r.json()) as TeneroOhlcResponse;
    if (!Array.isArray(body.data)) return null;
    return body.data;
  } catch (err) {
    logger?.warn?.("competition.prices.tenero_threw", {
      assetId,
      error: String(err),
    });
    return null;
  }
}

function buildHistory(
  candles: TeneroOhlcCandle[],
  fromTs: number,
  toTs: number
): PriceHistory {
  const map: Record<string, number> = {};
  for (const c of candles) {
    if (typeof c.time === "number" && typeof c.close === "number" && c.close > 0) {
      map[String(bucketOf(c.time))] = c.close;
    }
  }
  return {
    fetchedAt: new Date().toISOString(),
    period: PRICE_OHLC_PERIOD,
    fromTs,
    toTs,
    candles: map,
  };
}

/**
 * Refresh one token's OHLC history for the [fromTs, toTs] window and
 * write to KV. Returns the freshly-built history (or null when upstream
 * gave us nothing). Always writes when we got at least one candle, even
 * if the window is sparse — the read path treats missing buckets as
 * "unpriced" naturally.
 *
 * On hard failure (network error, 5xx, no candles) we DO NOT write —
 * leaves the previous history intact so the next cron tick can try
 * again. The KV TTL of 24h gives us 48 cron ticks of slack at 30-min
 * cadence.
 */
export async function refreshTokenHistory(
  kv: KVNamespace,
  assetId: string,
  fromTs: number,
  toTs: number,
  logger?: Logger
): Promise<PriceHistory | null> {
  const candles = await fetchOhlcCandles(assetId, fromTs, toTs, logger);
  if (!candles || candles.length === 0) return null;

  const history = buildHistory(candles, fromTs, toTs);
  const key = `${PRICE_HISTORY_PREFIX}${assetId}`;
  try {
    await kv.put(key, JSON.stringify(history), {
      expirationTtl: PRICE_HISTORY_TTL_SECONDS,
    });
  } catch (err) {
    logger?.warn?.("competition.prices.kv_write_failed", {
      assetId,
      error: String(err),
    });
  }
  return history;
}

export interface RefreshSummary {
  /** Number of asset ids the refresh attempted. */
  scanned: number;
  /** Tokens that returned at least one usable candle. */
  priced: number;
  /** Tokens that returned no candles (Tenero gap or unknown token). */
  unpriced: number;
  /** Tokens whose refresh threw or returned a non-2xx upstream. */
  errors: number;
}

/**
 * Refresh OHLC histories for every asset id in REFRESHABLE_ASSET_IDS
 * over a single [fromTs, toTs] window. The cron determines the window
 * based on the earliest verified swap (so the comp's whole history is
 * priced) and `now`.
 */
export async function refreshAllHistories(
  kv: KVNamespace,
  fromTs: number,
  toTs: number,
  logger?: Logger
): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    scanned: REFRESHABLE_ASSET_IDS.length,
    priced: 0,
    unpriced: 0,
    errors: 0,
  };

  await Promise.all(
    REFRESHABLE_ASSET_IDS.map(async (assetId) => {
      try {
        const history = await refreshTokenHistory(kv, assetId, fromTs, toTs, logger);
        if (history && Object.keys(history.candles).length > 0) summary.priced++;
        else summary.unpriced++;
      } catch (err) {
        summary.errors++;
        logger?.warn?.("competition.prices.refresh_threw", {
          assetId,
          error: String(err),
        });
      }
    })
  );

  return summary;
}
