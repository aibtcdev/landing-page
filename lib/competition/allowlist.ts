/**
 * Allowlisted (contract_id, function_name) tuples for the AIBTC trading
 * competition verifier. Only swaps against these contract/function pairs are
 * persisted to D1; everything else is rejected with `contract_not_allowlisted`.
 *
 * Phase 3.1 — Bitflow seed list per PHASE-3.1-HANDOFF.md and the
 * comp-attribution research gist:
 *   https://gist.github.com/biwasxyz/54213c1d25b9cacb9a79f0e005cf3260
 *
 * ALEX + Zest are tracked separately and will be added as follow-ups once
 * their contract lists firm up.
 *
 * Notes:
 *   - Bitflow's `xyk-swap-helper-v-1-3` is where the optional `provider`
 *     clarity arg lives (Bitflow attribution path — see PR-E). The verifier
 *     records `{ provider }` in `raw_event_json` when present; provider
 *     attribution is audit-only and NOT used as a primary verification
 *     signal (only ~6 of ~12 Bitflow contracts inject it).
 *   - AIBTC provider address is `SP1M8KHCJXB3SBRQRDBCG3J3859AA1CN0AWDHN17B`.
 *     See aibtcdev/aibtc-mcp-server#510 for the wire-side contract.
 */

export interface AllowlistEntry {
  readonly contract_id: string;
  readonly functions: readonly string[];
}

/** AIBTC provider address (Bitflow attribution audit signal — not authoritative). */
export const AIBTC_PROVIDER_ADDRESS =
  "SP1M8KHCJXB3SBRQRDBCG3J3859AA1CN0AWDHN17B";

/**
 * Bitflow allowlist. Each tuple is one allowed (contract, function) call.
 * The verifier accepts a swap only when both columns match.
 */
export const BITFLOW_ALLOWLIST: readonly AllowlistEntry[] = [
  // Stableswap (seed pool — handoff references 6 total; remaining 5 pulled
  // from the comp-attribution gist as a follow-up commit on this branch).
  {
    contract_id:
      "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.stableswap-stx-ststx-v-1-2",
    functions: ["swap-x-for-y", "swap-y-for-x"],
  },
  // XYK core
  {
    contract_id:
      "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-core-v-1-1",
    functions: ["swap-x-for-y", "swap-y-for-x"],
  },
  // XYK swap helper — the contract that takes the `provider` arg (PR-E).
  {
    contract_id:
      "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3",
    functions: [
      "swap-helper-a",
      "swap-helper-b",
      "swap-helper-c",
      "swap-helper-d",
      "swap-helper-e",
    ],
  },
  // DLMM
  {
    contract_id:
      "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD.dlmm-swap-router-v-1-1",
    functions: ["swap-simple-multi"],
  },
  // Cross-DEX router-* (handoff references all 12 contracts at SPQC38…;
  // remaining router contracts pulled from the gist as a follow-up).
] as const;

/** Convenience: all entries across protocols. Currently Bitflow-only. */
export const COMPETITION_ALLOWLIST: readonly AllowlistEntry[] = [
  ...BITFLOW_ALLOWLIST,
];

/**
 * Returns true when the (contract_id, function_name) pair is in the
 * competition allowlist. O(n) over the (small) allowlist; called once per
 * verify invocation so the loop cost is negligible.
 */
export function isAllowedSwap(
  contract_id: string,
  function_name: string
): boolean {
  for (const entry of COMPETITION_ALLOWLIST) {
    if (entry.contract_id === contract_id) {
      return entry.functions.includes(function_name);
    }
  }
  return false;
}

/**
 * Contracts that inject the `provider` clarity arg for Bitflow attribution.
 * Used by PR-E to decide whether to extract `provider` from function args.
 */
export const PROVIDER_ATTRIBUTION_CONTRACTS = new Set<string>([
  "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR.xyk-swap-helper-v-1-3",
]);
