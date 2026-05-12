/**
 * Active token set for Tenero price refresh. Locked to this static list
 * (not dynamically discovered from `swaps.token_in`) because the
 * leaderboard's `TOKEN_DECIMALS` table is the authority on what's
 * priceable — discovering a token here that the leaderboard doesn't know
 * the decimals for would fall back to `?? 6` and silently render the
 * wrong USD figure with `allPriced: true`.
 *
 * Adding a new priceable token is a deliberate two-step edit: add to
 * this list AND to `TOKEN_DECIMALS` in `app/leaderboard/page.tsx`, plus
 * a Tenero probe to confirm `/v1/stacks/tokens/{contract_id}` returns
 * 200 with a non-null `price_usd`.
 *
 * Future work (per #768 review): if this grows past ~30 tokens, consider
 * splitting Tenero refresh into per-tick chunks so a slow run can't blow
 * the alarm budget.
 */
export const STATIC_TOKEN_IDS: readonly string[] = [
  "stx",
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc",
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx",
];
