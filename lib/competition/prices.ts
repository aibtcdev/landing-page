/**
 * USD price store for the trading-comp leaderboard.
 *
 * Split into two surfaces with strict separation:
 *
 * - **Read path** (`getCachedTokenPriceUsd`, `getCachedTokenPricesUsd`) —
 *   consumed by the leaderboard route. Pure KV read; NEVER fetches
 *   upstream. Returns `null` for tokens the cron hasn't filled yet.
 *
 * - **Refresh path** (`refreshTokenPrice`, `refreshAllPrices`) — consumed
 *   by the price-refresh cron. Hits Tenero (SIP-10s) / CoinGecko (native
 *   STX, since Tenero's wstx contract returns 0), writes to KV with a TTL
 *   that gives the cron some slack before stale data starts surfacing as
 *   null.
 *
 * Strategy per @secret-mars's PR #651 comment: Tenero (api.tenero.io,
 * public, no auth) for SIP-10 tokens; CoinGecko for native STX. KV-cached.
 *
 * Current-price model: the leaderboard uses today's prices × historical
 * amounts (not historical price-at-burn_block_time). True historical P/L
 * needs a `prices(token_id, captured_at)` D1 table — that's Phase 3.2.
 *
 * Caveat: tokens we can't price (Tenero returns 0 / 404, or the cron
 * hasn't run yet) read back as `null` here. The P/L calculator skips
 * trades whose legs have null prices rather than treating them as zero —
 * keeps the leaderboard honest (unpriced ≠ zero economic value).
 */

import type { Logger } from "@/lib/logging";
import { STX_ASSET_ID } from "./parse";
import { TOKEN_DECIMALS } from "./decimals";

const TENERO_BASE = "https://api.tenero.io/api/v1/stacks/tokens";
const COINGECKO_STX_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd";

/** KV prefix for cached USD prices. One key per asset id. */
export const PRICE_CACHE_PREFIX = "comp:price:";

/**
 * KV TTL for cached prices. Sized to be longer than the leaderboard
 * cron's cadence (every 30 min, see app/api/competition/leaderboard/
 * refresh/route.ts) so a single failed cron tick degrades to
 * stale-but-served rather than null-everywhere. 60 min = 2 ticks of slack.
 */
export const PRICE_CACHE_TTL_SECONDS = 60 * 60;

/** Per-attempt timeout for upstream price fetches. */
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Asset ids that should resolve via the STX (CoinGecko) path rather than
 * Tenero. wstx is the wrapped-STX token used inside Bitflow pools — same
 * economic value as native STX but Tenero doesn't price it directly, so
 * we alias it.
 */
const STX_EQUIVALENT_ASSET_IDS: ReadonlySet<string> = new Set([
  STX_ASSET_ID,
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.wstx::wstx",
]);

interface CachedPrice {
  price: number | null;
  fetchedAt: string;
}

/**
 * Strip the `::asset` suffix off a Stacks asset id to get the contract id
 * Tenero expects. `SP….ststx-token::ststx` → `SP….ststx-token`.
 */
function toTeneroContractId(assetId: string): string {
  const idx = assetId.indexOf("::");
  return idx >= 0 ? assetId.slice(0, idx) : assetId;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

// ── Read path (request handlers; KV only) ─────────────────────────────────────

/**
 * Read one token's cached USD price. Returns null when the cron hasn't
 * filled this token's KV slot yet, when the cron last reported the token
 * as unpriceable, OR when KV itself errored on read.
 */
export async function getCachedTokenPriceUsd(
  kv: KVNamespace,
  assetId: string,
  logger?: Logger
): Promise<number | null> {
  const key = `${PRICE_CACHE_PREFIX}${assetId}`;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedPrice;
    return parsed.price ?? null;
  } catch (err) {
    logger?.warn?.("competition.prices.kv_read_failed", {
      assetId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Read many tokens' cached USD prices in parallel. Returns a Map keyed by
 * assetId; missing/uncached/unpriced tokens map to null.
 */
export async function getCachedTokenPricesUsd(
  kv: KVNamespace,
  assetIds: readonly string[],
  logger?: Logger
): Promise<Map<string, number | null>> {
  const unique = Array.from(new Set(assetIds));
  const entries = await Promise.all(
    unique.map(
      async (id) =>
        [id, await getCachedTokenPriceUsd(kv, id, logger)] as const
    )
  );
  return new Map(entries);
}

// ── Refresh path (cron-only; hits upstream) ───────────────────────────────────

/**
 * Asset ids the refresh cron should keep priced. Sourced from
 * `TOKEN_DECIMALS` so adding a token to that map (in lib/competition/
 * decimals.ts) automatically opts it in to refresh + leaderboard pricing.
 */
export const REFRESHABLE_ASSET_IDS: readonly string[] = Object.keys(TOKEN_DECIMALS);

async function fetchStxPriceFromCoingecko(
  logger?: Logger
): Promise<number | null> {
  try {
    const r = await fetchWithTimeout(COINGECKO_STX_URL);
    if (!r.ok) {
      logger?.warn?.("competition.prices.coingecko_non_ok", { status: r.status });
      return null;
    }
    const body = (await r.json()) as { blockstack?: { usd?: number } };
    const price = body.blockstack?.usd;
    return typeof price === "number" && price > 0 ? price : null;
  } catch (err) {
    logger?.warn?.("competition.prices.coingecko_threw", { error: String(err) });
    return null;
  }
}

async function fetchSip10PriceFromTenero(
  assetId: string,
  logger?: Logger
): Promise<number | null> {
  const contractId = toTeneroContractId(assetId);
  const url = `${TENERO_BASE}/${contractId}`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      logger?.warn?.("competition.prices.tenero_non_ok", {
        assetId,
        status: r.status,
      });
      return null;
    }
    const body = (await r.json()) as { price_usd?: number | string | null };
    const raw = body.price_usd;
    const price = typeof raw === "string" ? parseFloat(raw) : raw;
    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? price
      : null;
  } catch (err) {
    logger?.warn?.("competition.prices.tenero_threw", {
      assetId,
      error: String(err),
    });
    return null;
  }
}

/**
 * Refresh one token's USD price from upstream and write to KV. The TTL
 * (PRICE_CACHE_TTL_SECONDS) is intentionally longer than the cron's
 * cadence so a single failed cron tick degrades to stale-served rather
 * than null-everywhere.
 *
 * Returns the freshly-fetched price (or null if upstream reported the
 * token as unpriceable). Always writes — even null results are cached so
 * the read path doesn't have to re-distinguish "no data" from "upstream
 * said unpriceable" within the TTL window.
 */
export async function refreshTokenPrice(
  kv: KVNamespace,
  assetId: string,
  logger?: Logger
): Promise<number | null> {
  const fresh = STX_EQUIVALENT_ASSET_IDS.has(assetId)
    ? await fetchStxPriceFromCoingecko(logger)
    : await fetchSip10PriceFromTenero(assetId, logger);

  const key = `${PRICE_CACHE_PREFIX}${assetId}`;
  const payload: CachedPrice = { price: fresh, fetchedAt: new Date().toISOString() };
  try {
    await kv.put(key, JSON.stringify(payload), {
      expirationTtl: PRICE_CACHE_TTL_SECONDS,
    });
  } catch (err) {
    logger?.warn?.("competition.prices.kv_write_failed", {
      assetId,
      error: String(err),
    });
  }

  return fresh;
}

export interface RefreshSummary {
  scanned: number;
  priced: number;
  unpriced: number;
  errors: number;
}

/**
 * Refresh USD prices for every asset id in REFRESHABLE_ASSET_IDS.
 * Returns a summary the cron route can return in its response body.
 */
export async function refreshAllPrices(
  kv: KVNamespace,
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
        const price = await refreshTokenPrice(kv, assetId, logger);
        if (price != null) summary.priced++;
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
