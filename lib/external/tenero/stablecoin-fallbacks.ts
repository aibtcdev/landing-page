/**
 * USD-pegged Stacks assets we intentionally price at $1 when Tenero does not
 * publish a usable price. Contract ids are normalized without the SIP-010
 * `::asset` suffix so callers may pass either shape.
 */

export interface StablecoinUsdFallback {
  symbol: string;
  priceUsd: number;
  /** On-chain SIP-010 decimals. */
  decimals: number;
}

const USD_PEGGED_TOKEN_FALLBACKS: Readonly<Record<string, StablecoinUsdFallback>> = {
  "SP120SBRBQJ00MCWS7TM5R8WJNTTKD5K0HFRC2CNE.usdcx": {
    symbol: "USDCx",
    priceUsd: 1,
    decimals: 6,
  },
  "SP3K8BC0PPEVCV7NZ6QSRWPQ2JE9E5B6N3PA0KBR9.token-aeusdc": {
    symbol: "aeUSDC",
    priceUsd: 1,
    decimals: 6,
  },
  "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc": {
    symbol: "aeUSDC",
    priceUsd: 1,
    decimals: 6,
  },
};

export function getStablecoinUsdFallback(
  tokenId: string
): StablecoinUsdFallback | null {
  const idx = tokenId.indexOf("::");
  const normalized = idx >= 0 ? tokenId.slice(0, idx) : tokenId;
  return USD_PEGGED_TOKEN_FALLBACKS[normalized] ?? null;
}
