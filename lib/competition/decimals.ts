/**
 * Decimals lookup for tokens that appear in the comp's allowlisted contracts.
 *
 * Used by the P/L calculator (lib/competition/pnl.ts) to convert raw on-chain
 * amounts in `swaps` (stored as integers) into human-readable units before
 * multiplying by USD price.
 *
 * Per Phase 3.1 PR-A's parse.ts, native STX transfers are stored under the
 * synthetic asset id `"stx"` (STX_ASSET_ID). SIP-10 tokens use their full
 * Stacks asset identifier in the form `SP….contract::asset`. We map both
 * shapes to their decimals.
 *
 * **Scope discipline**: only include tokens whose contract id is the
 * canonical one Tenero indexes (verified by hitting
 * `https://api.tenero.io/v1/stacks/tokens/{contract_id}` and getting a 200
 * with a non-null `price_usd`). Tokens with multiple variants on chain
 * (wstx, alex, usdh) are NOT included here yet — many of those addresses
 * correspond to test deployments or deprecated v0 contracts, and shipping
 * the wrong one means every leg involving that token reads back as
 * unpriced. Add tokens here ONLY after probing Tenero and confirming the
 * exact contract id that the verifier persists from a real Bitflow swap.
 *
 * Tokens we don't know default to 6 (the Stacks SIP-10 convention) so a
 * future token added to the allowlist parses without code changes — the
 * leaderboard may surface a 0 USD value for it until we add an explicit
 * decimals entry, but it won't crash.
 */

import { STX_ASSET_ID } from "./parse";

/** Stacks-canonical decimals by asset id. Add tokens as they enter the allowlist. */
export const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  // Native STX (synthetic id used by parseSwapFromTx for stx_asset events).
  // Priced via Tenero's OHLC at `/v1/stacks/tokens/stx/ohlc`.
  [STX_ASSET_ID]: 6,

  // sBTC — 1:1 with BTC, 8 decimals like BTC itself.
  // Probed: GET /v1/stacks/tokens/SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token → 200.
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc": 8,

  // stSTX — liquid-staked STX, 6 decimals.
  // Probed: GET /v1/stacks/tokens/SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token → 200.
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx": 6,
} as const;

/**
 * Decimals for an asset id. Returns 6 for unknown assets — Stacks SIP-10
 * default. Callers needing strict behaviour should look up `TOKEN_DECIMALS`
 * directly and treat absence as "unpriceable".
 */
export function decimalsFor(assetId: string): number {
  return TOKEN_DECIMALS[assetId] ?? 6;
}

/**
 * Whether the asset id is known to this map. Useful for the P/L calculator
 * to decide whether to skip a trade entirely (unknown token = no reliable
 * USD value) versus assume the SIP-10 default.
 */
export function hasKnownDecimals(assetId: string): boolean {
  return assetId in TOKEN_DECIMALS;
}
