/**
 * Submitted-trade volume + count per agent.
 *
 * What this surfaces:
 *   - `count` — number of swaps the agent submitted via the MCP path
 *     (`swaps.source = 'agent'`). The catch-up cron + future chainhook
 *     paths are excluded because the leaderboard is about MCP usage,
 *     not on-chain activity at large.
 *   - `volumeUsd` — sum of `amount_in × current_token_in_price` across
 *     those submissions. Input side only — we don't double-count the
 *     out leg. This is volume that moved THROUGH the agent's submitted
 *     trades, not a P&L number. No cost basis, no gains/losses.
 *
 * Pricing: one Tenero current-price call per distinct token_in seen in
 * the data. Live fetch on each /agents render — no KV cache, no cron.
 * With ~3 priceable tokens in practice the cost is ~3 parallel
 * round-trips at SSR time. Add caching if it ever shows up in latency
 * traces.
 *
 * Tokens we don't know (`token_in = 'unknown'` from a parser miss, or a
 * future SIP-10 not yet in `TOKEN_DECIMALS`): price is null, so the
 * trade is still counted but contributes 0 to volumeUsd. This is the
 * honest reading — we shouldn't impute a USD figure to a leg we can't
 * value.
 */

const TENERO_BASE = "https://api.tenero.io/v1/stacks";
const FETCH_TIMEOUT_MS = 5_000;

/**
 * On-chain decimals for the tokens we know how to price. Adding a new
 * token here requires:
 *   1. The token's canonical contract id (Tenero must return 200 for
 *      `${TENERO_BASE}/tokens/{contract_id}` — probe before adding).
 *   2. Its SIP-10 decimals figure (defaults to 6 below if unset, which
 *      is wrong for sBTC and friends — don't rely on the default).
 */
const TOKEN_DECIMALS: Readonly<Record<string, number>> = {
  // Native STX (synthetic asset id from parseSwapFromTx).
  stx: 6,
  // sBTC — Stacks-native wrapped BTC, 8 decimals.
  "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc": 8,
  // stSTX — liquid-staked STX, 6 decimals.
  "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx": 6,
};

function decimalsFor(assetId: string): number {
  return TOKEN_DECIMALS[assetId] ?? 6;
}

/**
 * Strip the `::asset` suffix off a SIP-10 asset id to get the contract
 * id Tenero indexes by. Native STX passes through as the literal `stx`,
 * which is what Tenero's tokens endpoint accepts for native STX.
 */
function toTeneroAddress(assetId: string): string {
  if (assetId === "stx") return "stx";
  const idx = assetId.indexOf("::");
  return idx >= 0 ? assetId.slice(0, idx) : assetId;
}

interface TeneroTokenResponse {
  statusCode: number;
  data: { price_usd?: number | string | null } | null;
}

/**
 * Fetch the current USD price for one asset id from Tenero. Returns
 * null on any failure (timeout, non-2xx, unparseable, zero price).
 * Unpriced tokens land as null and the volume aggregator treats them
 * as "skip from sum" rather than "impute zero."
 */
async function fetchTokenPriceUsd(assetId: string): Promise<number | null> {
  const addr = toTeneroAddress(assetId);
  if (!addr) return null;
  try {
    const r = await fetch(`${TENERO_BASE}/tokens/${encodeURIComponent(addr)}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as TeneroTokenResponse;
    const raw = body.data?.price_usd;
    const price = typeof raw === "string" ? parseFloat(raw) : raw;
    return typeof price === "number" && Number.isFinite(price) && price > 0
      ? price
      : null;
  } catch {
    return null;
  }
}

export interface AgentTradeSummary {
  /** Count of swaps the agent submitted via the MCP path. */
  count: number;
  /**
   * Sum of input-side USD across those swaps. May be lower than the
   * "true" volume when one or more legs hit an unpriceable token —
   * we'd rather under-report than make up a number.
   */
  volumeUsd: number;
  /**
   * Latest `burn_block_time` (unix seconds) across the agent's
   * MCP-submitted swaps. Surfaced in the UI as a relative-time column
   * so reviewers can see who's currently active.
   */
  latestTradeAt: number;
}

interface D1AggregateRow {
  sender: string;
  token_in: string;
  cnt: number;
  sum_in: number;
  latest_at: number;
}

/**
 * For every agent who has submitted at least one trade via the MCP,
 * return their submission count + USD volume moved (input side).
 *
 * Single D1 round-trip, parallel Tenero calls for prices, all
 * aggregated in JS. No caching — Tenero current-price endpoint is fast
 * enough to live-fetch on each /agents render with ~3 distinct tokens
 * in the data today.
 *
 * Returns an empty map on D1 unavailability or query failure so the
 * caller (the /agents page) can render unaffected.
 */
export async function getAgentSubmittedTradeSummary(
  db: D1Database
): Promise<Map<string, AgentTradeSummary>> {
  const sql = `
    SELECT sender, token_in,
           COUNT(*) AS cnt,
           SUM(amount_in) AS sum_in,
           MAX(burn_block_time) AS latest_at
    FROM swaps
    WHERE source = 'agent'
    GROUP BY sender, token_in
  `;
  let rows: D1AggregateRow[] = [];
  try {
    const result = await db.prepare(sql).all<D1AggregateRow>();
    rows = result.results ?? [];
  } catch {
    return new Map();
  }
  if (rows.length === 0) return new Map();

  // Distinct token_in values across all rows. Tenero gets one call per
  // token regardless of how many senders use it.
  const tokens = Array.from(new Set(rows.map((r) => r.token_in)));
  const priceEntries = await Promise.all(
    tokens.map(async (t) => [t, await fetchTokenPriceUsd(t)] as const)
  );
  const prices = new Map(priceEntries);

  const out = new Map<string, AgentTradeSummary>();
  for (const r of rows) {
    const existing =
      out.get(r.sender) ?? { count: 0, volumeUsd: 0, latestTradeAt: 0 };
    existing.count += r.cnt;
    const price = prices.get(r.token_in);
    if (price != null) {
      const human = r.sum_in / 10 ** decimalsFor(r.token_in);
      existing.volumeUsd += human * price;
    }
    if (r.latest_at > existing.latestTradeAt) {
      existing.latestTradeAt = r.latest_at;
    }
    out.set(r.sender, existing);
  }
  return out;
}
