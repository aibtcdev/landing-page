/**
 * Index-time USD pricing (issue #978, Phase 1).
 *
 * Tenero serves spot prices only (no historical endpoint), so we price at index
 * time and persist price_usd + price_source alongside the raw amount. Because
 * the indexer runs continuously over recent txs, index-time ≈ tx-time. aeUSDC
 * uses the $1 peg; sBTC/STX read the Tenero KV cache (which itself holds the
 * last-good value for 24h). Unpriceable transfers are stored with amount_usd
 * NULL and repriced on a later pass.
 */

import { getCachedTokenPrice } from "../external/tenero/kv-cache";
import { assetInfoForAsset, type AssetInfo } from "./assets";
import type { InboundTransfer, Pricing } from "./types";

function finalize(
  transfer: InboundTransfer,
  assetInfo: AssetInfo,
  priceUsd: number,
  priceSource: Pricing["priceSource"],
  now: number
): Pricing {
  const amountUsd =
    (transfer.amountRaw / Math.pow(10, assetInfo.decimals)) * priceUsd;
  return { amountUsd, priceUsd, priceSource, pricedAt: now };
}

export async function priceTransfer(
  kv: KVNamespace,
  transfer: InboundTransfer,
  now: number
): Promise<Pricing> {
  const assetInfo = assetInfoForAsset(transfer.asset);

  // aeUSDC → $1 peg, no Tenero lookup.
  if (assetInfo.stablecoin) {
    return finalize(transfer, assetInfo, 1, "stablecoin", now);
  }

  const cached = await getCachedTokenPrice(kv, assetInfo.teneroTokenId);
  if (cached && typeof cached.priceUsd === "number" && Number.isFinite(cached.priceUsd)) {
    return finalize(transfer, assetInfo, cached.priceUsd, "tenero", now);
  }

  // No price available (cache miss, or Tenero confirmed-null). Leave unpriced.
  return { amountUsd: null, priceUsd: null, priceSource: "none", pricedAt: now };
}
