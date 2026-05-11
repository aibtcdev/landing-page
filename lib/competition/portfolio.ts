/**
 * Per-agent wallet portfolio for the trading-comp leaderboard.
 *
 * Tenero exposes a wallet holdings_value endpoint that aggregates every
 * indexed token + native STX balance into a single USD figure. We fetch
 * one of these per agent during the 30-min leaderboard cron tick and
 * surface the result alongside the historical-P/L numbers so the UI can
 * show "what's this agent actually worth right now" next to "how well
 * did they trade."
 *
 * Cache model (same shape as prices.ts):
 *   - KV key `comp:portfolio:{stx_address}` → CachedPortfolio
 *   - 2h TTL (4 cron ticks of slack — matches the leaderboard snapshot)
 *   - Refresh path (cron): hits Tenero, writes KV. On failure, keeps the
 *     previous cached value so the portfolio doesn't blink to null on
 *     transient upstream issues.
 *   - Read path (cron consumer / pnl): pure KV. Never fetches.
 *
 * Tenero scope note: this is wallet-wide value, NOT competition-scoped.
 * If an agent holds tokens from non-allowlisted swaps (airdrops, OTC,
 * LP positions), Tenero counts them. We surface it as-is because the UI
 * label says "Portfolio" (current wallet value), not "Competition P/L."
 */

import type { Logger } from "@/lib/logging";

const TENERO_BASE = "https://api.tenero.io/v1/stacks";

/** KV prefix for cached per-agent portfolios. */
export const PORTFOLIO_CACHE_PREFIX = "comp:portfolio:";

/**
 * KV TTL for cached portfolios. Aligned with the leaderboard snapshot
 * TTL — after 4 failed cron ticks the snapshot disappears, so keeping
 * portfolio caches alive past that point doesn't buy anything.
 */
export const PORTFOLIO_CACHE_TTL_SECONDS = 2 * 60 * 60;

/** Per-attempt timeout for Tenero wallet fetches. */
const FETCH_TIMEOUT_MS = 8_000;

/**
 * Shape we persist per agent. `null` value fields mean Tenero
 * authoritatively said the agent has no tracked holdings — distinct
 * from "we couldn't fetch" (which doesn't write, falling back to the
 * previous cache).
 */
export interface AgentPortfolio {
  stx_address: string;
  native_value_usd: number | null;
  token_value_usd: number | null;
  total_value_usd: number | null;
  token_count: number | null;
  fetchedAt: string;
}

interface TeneroWalletHoldingsResponse {
  statusCode: number;
  message?: string;
  data: {
    wallet_address?: string;
    native_amount?: number | null;
    native_value_usd?: number | null;
    token_value_usd?: number | null;
    total_value_usd?: number | null;
    total_raw_value_usd?: number | null;
    total_adjusted_value_usd?: number | null;
    token_count?: number | null;
  } | null;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

function num(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ── Read path (KV only) ───────────────────────────────────────────────────────

/**
 * Read one agent's cached portfolio. Returns null on KV miss / parse
 * failure — callers should fall back to the empty-portfolio shape so
 * the snapshot row schema stays stable.
 */
export async function getCachedPortfolio(
  kv: KVNamespace,
  stxAddress: string,
  logger?: Logger
): Promise<AgentPortfolio | null> {
  const key = `${PORTFOLIO_CACHE_PREFIX}${stxAddress}`;
  try {
    const raw = await kv.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as AgentPortfolio;
  } catch (err) {
    logger?.warn?.("competition.portfolio.kv_read_failed", {
      stxAddress,
      error: String(err),
    });
    return null;
  }
}

// ── Refresh path (cron-only; hits upstream) ───────────────────────────────────

async function fetchPortfolioFromTenero(
  stxAddress: string,
  logger?: Logger
): Promise<AgentPortfolio | null> {
  const url = `${TENERO_BASE}/wallets/${encodeURIComponent(stxAddress)}/holdings_value`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      logger?.warn?.("competition.portfolio.tenero_non_ok", {
        stxAddress,
        status: r.status,
      });
      return null;
    }
    const body = (await r.json()) as TeneroWalletHoldingsResponse;
    const data = body.data;
    if (!data) return null;
    return {
      stx_address: stxAddress,
      native_value_usd: num(data.native_value_usd),
      token_value_usd: num(data.token_value_usd),
      total_value_usd: num(data.total_value_usd),
      token_count: num(data.token_count),
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger?.warn?.("competition.portfolio.tenero_threw", {
      stxAddress,
      error: String(err),
    });
    return null;
  }
}

/**
 * Refresh one agent's portfolio from Tenero and write to KV. Returns
 * the freshly-fetched portfolio, or null when the upstream errored.
 *
 * On null upstream we DO NOT write — the previous cached value (if any)
 * stays intact so a transient Tenero failure doesn't blink the agent's
 * portfolio number to null in the UI. The KV TTL guarantees eventual
 * eviction after a sustained outage.
 */
export async function refreshAgentPortfolio(
  kv: KVNamespace,
  stxAddress: string,
  logger?: Logger
): Promise<AgentPortfolio | null> {
  const fresh = await fetchPortfolioFromTenero(stxAddress, logger);
  if (!fresh) return null;

  const key = `${PORTFOLIO_CACHE_PREFIX}${stxAddress}`;
  try {
    await kv.put(key, JSON.stringify(fresh), {
      expirationTtl: PORTFOLIO_CACHE_TTL_SECONDS,
    });
  } catch (err) {
    logger?.warn?.("competition.portfolio.kv_write_failed", {
      stxAddress,
      error: String(err),
    });
  }
  return fresh;
}

export interface PortfolioRefreshSummary {
  /** Number of agents the refresh attempted. */
  scanned: number;
  /** Agents whose holdings_value came back from Tenero. */
  fetched: number;
  /** Agents that fell back to the previous cached value. */
  fallback_from_cache: number;
  /** Agents with neither fresh nor cached data. */
  missing: number;
}

/**
 * Refresh portfolios for a batch of stx addresses. For each agent:
 *   1. Try a fresh Tenero fetch.
 *   2. If that fails, read the previous cached value.
 *   3. If neither works, the row's portfolio_total_usd ends up null —
 *      the snapshot stays valid, just with one un-populated portfolio.
 *
 * Returns the resolved portfolio map (keyed by stx_address) plus a
 * summary the cron route can echo in its response.
 */
export async function refreshAndReadPortfolios(
  kv: KVNamespace,
  stxAddresses: readonly string[],
  logger?: Logger
): Promise<{
  map: Map<string, AgentPortfolio | null>;
  summary: PortfolioRefreshSummary;
}> {
  const unique = Array.from(new Set(stxAddresses));
  const summary: PortfolioRefreshSummary = {
    scanned: unique.length,
    fetched: 0,
    fallback_from_cache: 0,
    missing: 0,
  };

  const entries = await Promise.all(
    unique.map(async (addr) => {
      const fresh = await refreshAgentPortfolio(kv, addr, logger);
      if (fresh) {
        summary.fetched++;
        return [addr, fresh] as const;
      }
      const cached = await getCachedPortfolio(kv, addr, logger);
      if (cached) {
        summary.fallback_from_cache++;
        return [addr, cached] as const;
      }
      summary.missing++;
      return [addr, null] as const;
    })
  );

  return { map: new Map(entries), summary };
}
