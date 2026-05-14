/**
 * Token price fetcher built on the Tenero wrapper.
 *
 * Single responsibility: given a token id (in the form `stx`,
 * `SP...contract::asset`, or a bare contract id), call Tenero's
 * `/v1/stacks/tokens/{contract_id}` endpoint and return a numeric USD price
 * or null if the token isn't priced.
 *
 * Tenero's contract-id form drops the `::asset` suffix; native STX passes
 * through as the literal `"stx"`. The mapping lives here (not in the wrapper)
 * because it's price-endpoint-specific — other Tenero endpoints may want a
 * different shape.
 */

import { teneroFetch, extractTeneroRateLimit, type TeneroRateLimit } from "../tenero-fetch";
import type { Logger } from "../../logging";
import { getStablecoinUsdFallback } from "./stablecoin-fallbacks";

export interface TeneroPriceResult {
  /** Parsed USD price, or null when the token has no published price or the fetch failed. */
  priceUsd: number | null;
  /** Final response status (0 when the fetch threw before getting one). */
  status: number;
  /** Rate-limit headers from the final response — surfaced for the scheduler's adaptive logic. */
  rateLimit: TeneroRateLimit;
}

/** Strip the `::asset` suffix; native STX passes through as `"stx"`. */
export function tokenIdToTeneroAddress(tokenId: string): string {
  if (tokenId === "stx") return "stx";
  const idx = tokenId.indexOf("::");
  return idx >= 0 ? tokenId.slice(0, idx) : tokenId;
}

/**
 * Fetch a single token's USD price from Tenero. Never throws on non-2xx —
 * callers (the scheduler refresh task) want to keep going on partial failure
 * and have the rate-limit info surfaced for cadence decisions.
 */
export async function fetchTokenPriceUsd(
  tokenId: string,
  logger?: Logger,
  apiKey?: string
): Promise<TeneroPriceResult> {
  const addr = tokenIdToTeneroAddress(tokenId);
  const stablecoinFallback = getStablecoinUsdFallback(tokenId);
  if (stablecoinFallback) {
    logger?.info("tenero.price_stablecoin_fallback_used", {
      tokenId,
      teneroAddress: addr,
      symbol: stablecoinFallback.symbol,
      priceUsd: stablecoinFallback.priceUsd,
    });
    return {
      priceUsd: stablecoinFallback.priceUsd,
      status: 200,
      rateLimit: { minuteRemaining: null, monthRemaining: null, type: null },
    };
  }

  const path = `/tokens/${encodeURIComponent(addr)}`;

  let response: Response;
  try {
    response = await teneroFetch(path, { logger, apiKey });
  } catch (error) {
    logger?.warn("tenero.price_fetch_network_error", {
      tokenId,
      teneroAddress: addr,
      error: String(error),
    });
    return {
      priceUsd: null,
      status: 0,
      rateLimit: { minuteRemaining: null, monthRemaining: null, type: null },
    };
  }

  const rateLimit = extractTeneroRateLimit(response);

  if (!response.ok) {
    logger?.warn("tenero.price_fetch_non_2xx", {
      tokenId,
      teneroAddress: addr,
      status: response.status,
      rlMinuteRemaining: rateLimit.minuteRemaining,
      rlMonthRemaining: rateLimit.monthRemaining,
    });
    return { priceUsd: null, status: response.status, rateLimit };
  }

  let priceUsd: number | null = null;
  try {
    const body = (await response.json()) as { data?: { price_usd?: number | string | null } };
    const raw = body.data?.price_usd;
    const parsed = typeof raw === "string" ? parseFloat(raw) : raw;
    priceUsd =
      typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
        ? parsed
        : null;
  } catch (error) {
    logger?.warn("tenero.price_fetch_parse_error", {
      tokenId,
      teneroAddress: addr,
      error: String(error),
    });
    priceUsd = null;
  }

  return { priceUsd, status: response.status, rateLimit };
}
