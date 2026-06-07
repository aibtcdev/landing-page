/**
 * Agent L2 (sBTC) balances, read from the HOLDINGS_KV namespace that the
 * aibtc-dashboard holdings scanner populates. We are a read-only consumer —
 * the scanner (a separate worker) owns writes. See wrangler.jsonc HOLDINGS_KV.
 *
 * Key `holdings:all` holds the full ranked snapshot; each holder carries an
 * sBTC (`sbtc`) and BTC L1 (`btc`) balance, both in sats.
 */

const HOLDINGS_ALL_KEY = "holdings:all";

interface HolderEntry {
  stxAddress: string;
  /** sBTC balance in sats (Bitcoin on Stacks). */
  sbtc: number;
  /** BTC L1 confirmed balance in sats; null if not yet fetched. */
  btc: number | null;
}

interface HoldingsAll {
  holders: HolderEntry[];
}

/**
 * Build a map of STX address → sBTC balance (sats) from the holdings snapshot.
 * Returns an empty map if the binding is absent (local dev) or the scan has
 * not produced a snapshot yet — callers treat a missing entry as "unknown".
 */
export async function getL2BalancesByStxAddress(
  kv: KVNamespace | undefined
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!kv) return map;

  const raw = await kv.get(HOLDINGS_ALL_KEY);
  if (!raw) return map;

  try {
    const parsed = JSON.parse(raw) as HoldingsAll;
    for (const holder of parsed.holders ?? []) {
      map.set(holder.stxAddress, holder.sbtc);
    }
  } catch {
    // Malformed snapshot — degrade to "no balances" rather than crashing the page.
  }

  return map;
}
