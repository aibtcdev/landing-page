/**
 * Active token set for the SchedulerDO's Tenero price-refresh task. The
 * leaderboard no longer reads this cache — it calls Tenero directly from
 * the browser and reads `decimals` straight from the response — so this
 * list is now only consumed by `/api/prices` and any other future server
 * consumer of `tenero:price:*` KV entries.
 *
 * Adding a new priceable token: probe Tenero's
 * `/v1/stacks/tokens/{contract_id}` first to confirm a 200 with a
 * non-null `price_usd`, then add the id here so the scheduler refreshes it.
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
