/**
 * Stacks-canonical decimals for tokens we know how to value. Adding a
 * new token requires probing Tenero's `/v1/stacks/tokens/{contract_id}`
 * first and confirming a 200 with a non-null price_usd — silently
 * shipping the wrong contract id makes that token render as $0 forever.
 *
 * Keep in sync with `STATIC_TOKEN_IDS` in `lib/external/tenero/tokens.ts`
 * (consumed by `SchedulerDO` in `worker.ts`) so the scheduler refreshes
 * every token the leaderboard knows how to value.
 *
 * The unknown-token default is 6 (SIP-10 convention). Volume from
 * those legs stays $0 (no price in KV), which is the honest read — we'd
 * rather under-report than impute a number.
 *
 * Shared by `app/leaderboard/page.tsx` (server, for token id passthrough
 * with decimals attached) and `app/leaderboard/LeaderboardClient.tsx`
 * (client, for USD volume computation after `/api/prices` fetch).
 */
export const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  stx: 6,
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc": 8,
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx": 6,
};

export const DEFAULT_TOKEN_DECIMALS = 6;
