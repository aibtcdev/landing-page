/**
 * Asset detection + decimals + Tenero price-cache key, for the three in-scope
 * assets (sBTC, STX, aeUSDC). Anything else is ignored by the indexer.
 */

import { SBTC_CONTRACT_MAINNET } from "../bounty/constants";
import type { EarningAsset } from "./types";

export interface AssetInfo {
  asset: EarningAsset;
  decimals: number;
  /** Key for getCachedTokenPrice (matches the Tenero static-token-id form). */
  teneroTokenId: string;
  /** True → price is the $1 stablecoin peg, no Tenero lookup needed. */
  stablecoin: boolean;
}

// sBTC FT asset_identifier is `<contract>::sbtc-token`; the Tenero cache keys
// sBTC under that same `::`-suffixed form (STATIC_TOKEN_IDS).
export const SBTC_ASSET_ID = `${SBTC_CONTRACT_MAINNET}::sbtc-token`;

// Only aeUSDC is in scope among stablecoins (not USDA/USDCx/sUSDT). Match by the
// contract id (the part before `::`), since the asset name after `::` can vary.
const AEUSDC_CONTRACTS: ReadonlySet<string> = new Set([
  "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-aeusdc",
  "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc",
]);

/** STX native transfers (from Hiro `stx_transfers`). */
export const STX_ASSET_INFO: AssetInfo = {
  asset: "stx",
  decimals: 6,
  teneroTokenId: "stx",
  stablecoin: false,
};

/** Resolve an AssetInfo from our asset enum (for pricing a stored transfer). */
export function assetInfoForAsset(asset: EarningAsset): AssetInfo {
  switch (asset) {
    case "stx":
      return STX_ASSET_INFO;
    case "sbtc":
      return { asset: "sbtc", decimals: 8, teneroTokenId: SBTC_ASSET_ID, stablecoin: false };
    case "aeusdc":
      return { asset: "aeusdc", decimals: 6, teneroTokenId: "", stablecoin: true };
  }
}

/**
 * Resolve a Hiro FT `asset_identifier` to one of the three tracked assets, or
 * null if it isn't one we index.
 */
export function assetInfoForFt(assetIdentifier: string): AssetInfo | null {
  const contractId = assetIdentifier.split("::")[0];
  if (contractId === SBTC_CONTRACT_MAINNET) {
    return {
      asset: "sbtc",
      decimals: 8,
      teneroTokenId: SBTC_ASSET_ID,
      stablecoin: false,
    };
  }
  if (AEUSDC_CONTRACTS.has(contractId)) {
    return {
      asset: "aeusdc",
      decimals: 6,
      // aeUSDC is priced by the $1 peg, so teneroTokenId is unused; keep the
      // real id for completeness/debuggability.
      teneroTokenId: assetIdentifier,
      stablecoin: true,
    };
  }
  return null;
}
