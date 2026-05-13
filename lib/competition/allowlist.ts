/**
 * Allowlisted (contract_id, function_name) tuples for the AIBTC trading
 * competition verifier. Only swaps against these contract/function pairs are
 * persisted to D1; everything else is rejected with `contract_not_allowlisted`.
 *
 * Source of truth for contracts: Bitflow's published mainnet contracts page
 *   https://docs.bitflow.finance/bitflow-documentation/developers/deployed-contracts/stacks#mainnet-contracts
 * Source of truth for function names: each contract's on-chain ABI fetched
 * via Hiro `/v2/contracts/interface/{addr}/{name}` and cross-verified through
 * the AIBTC MCP `get_contract_info` tool. Only `access: "public"` functions
 * whose name contains "swap" are included — admin (`add-admin`,
 * `set-swap-status`, `change-swap-fee`, etc.) and read-only quote
 * (`get-quote-*`) functions are intentionally excluded.
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

/** Bitflow's primary mainnet deployer (stableswap pools + cross-DEX routers). */
const BITFLOW_DEPLOYER = "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M";
/** Bitflow XYK deployer (core + swap helper). Separate principal from above. */
const BITFLOW_XYK_DEPLOYER = "SM1793C4R5PZ4NS4VQ4WMP7SKKYVH8JZEWSZ9HCCR";
/** Bitflow DLMM deployer. */
const BITFLOW_DLMM_DEPLOYER = "SM1FKXGNZJWSTWDWXQZJNF7B5TV5ZB235JTCXYXKD";

/** Stableswap pools — all expose the same `swap-x-for-y` / `swap-y-for-x` pair. */
const STABLESWAP_FUNCTIONS = ["swap-x-for-y", "swap-y-for-x"] as const;

/** Cross-DEX routers (the common case — 2 swap helpers, plus admin we drop). */
const ROUTER_HELPER_AB = ["swap-helper-a", "swap-helper-b"] as const;

/**
 * Bitflow allowlist. Each tuple is one allowed (contract, function) call.
 * The verifier accepts a swap only when both columns match.
 */
export const BITFLOW_ALLOWLIST: readonly AllowlistEntry[] = [
  // -- Stableswap pools (6 pools) --
  {
    contract_id: `${BITFLOW_DEPLOYER}.stableswap-stx-ststx-v-1-2`,
    functions: STABLESWAP_FUNCTIONS,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.stableswap-usda-susdt-v-1-2`,
    functions: STABLESWAP_FUNCTIONS,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.stableswap-aeusdc-susdt-v-1-2`,
    functions: STABLESWAP_FUNCTIONS,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.stableswap-usda-aeusdc-v-1-2`,
    functions: STABLESWAP_FUNCTIONS,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.stableswap-usda-aeusdc-v-1-4`,
    functions: STABLESWAP_FUNCTIONS,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.stableswap-abtc-xbtc-v-1-2`,
    functions: STABLESWAP_FUNCTIONS,
  },

  // -- XYK --
  {
    contract_id: `${BITFLOW_XYK_DEPLOYER}.xyk-core-v-1-1`,
    functions: ["swap-x-for-y", "swap-y-for-x"],
  },
  // XYK swap helper — where the optional `provider` clarity arg lives
  // (Bitflow attribution path). Functions a..e are the multi-hop variants.
  // Not on the Bitflow docs page but live on-chain and called by the MCP.
  {
    contract_id: `${BITFLOW_XYK_DEPLOYER}.xyk-swap-helper-v-1-3`,
    functions: [
      "swap-helper-a",
      "swap-helper-b",
      "swap-helper-c",
      "swap-helper-d",
      "swap-helper-e",
    ],
  },
  // Router stableswap-xyk multihop — Bitflow SDK auto-routes here for
  // multi-hop swaps that compose a stableswap pool with an XYK pool
  // (e.g. sBTC -> STX -> stSTX). Same XYK deployer family as
  // `xyk-core-v-1-1` and `xyk-swap-helper-v-1-3` above; functionally the
  // multihop variant of the helper. Per-Hiro on-chain ABI exposes 9
  // swap-helper-* variants (a..i). Surfaced as a launch-window blocker
  // on issue #830 with a reproducer txid:
  // 0xd298a52d1197a36778c64b4cb1c83aebba12f3969d4a7a9a5f9add07252b2bc9
  // (Prime Spoke / agent_id 67, T+2.5min after launch, sBTC->stSTX).
  {
    contract_id: `${BITFLOW_XYK_DEPLOYER}.router-stableswap-xyk-multihop-v-1-2`,
    functions: [
      "swap-helper-a",
      "swap-helper-b",
      "swap-helper-c",
      "swap-helper-d",
      "swap-helper-e",
      "swap-helper-f",
      "swap-helper-g",
      "swap-helper-h",
      "swap-helper-i",
    ],
  },

  // -- DLMM router (8 swap variants per on-chain ABI) --
  // Previous seed only included `swap-simple-multi`, causing the other 7
  // variants to be rejected as `contract_not_allowlisted`.
  {
    contract_id: `${BITFLOW_DLMM_DEPLOYER}.dlmm-swap-router-v-1-1`,
    functions: [
      "swap-multi",
      "swap-simple-multi",
      "swap-x-for-y-same-multi",
      "swap-x-for-y-simple-multi",
      "swap-x-for-y-simple-range-multi",
      "swap-y-for-x-same-multi",
      "swap-y-for-x-simple-multi",
      "swap-y-for-x-simple-range-multi",
    ],
  },

  // -- Cross-DEX routers (13 contracts) --
  // Most expose only `swap-helper-a` and `swap-helper-b`. Two velar-alex
  // versions expose `swap-helper-a..p` (16 helpers each).
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-ststx-bitflow-arkadiko-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-ststx-bitflow-velar-v-1-2`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-ststx-bitflow-alex-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-ststx-bitflow-alex-v-1-2`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-ststx-bitflow-alex-v-2-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-ststx-bitflow-xyk-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-stx-usda-arkadiko-alex-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-xyk-arkadiko-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-xyk-velar-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-xyk-alex-v-1-1`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-xyk-alex-v-1-2`,
    functions: ROUTER_HELPER_AB,
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-velar-alex-v-1-1`,
    functions: [
      "swap-helper-a",
      "swap-helper-b",
      "swap-helper-c",
      "swap-helper-d",
      "swap-helper-e",
      "swap-helper-f",
      "swap-helper-g",
      "swap-helper-h",
      "swap-helper-i",
      "swap-helper-j",
      "swap-helper-k",
      "swap-helper-l",
      "swap-helper-m",
      "swap-helper-n",
      "swap-helper-o",
      "swap-helper-p",
    ],
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.router-velar-alex-v-1-2`,
    functions: [
      "swap-helper-a",
      "swap-helper-b",
      "swap-helper-c",
      "swap-helper-d",
      "swap-helper-e",
      "swap-helper-f",
      "swap-helper-g",
      "swap-helper-h",
      "swap-helper-i",
      "swap-helper-j",
      "swap-helper-k",
      "swap-helper-l",
      "swap-helper-m",
      "swap-helper-n",
      "swap-helper-o",
      "swap-helper-p",
    ],
  },

  // -- Wrappers (4 contracts) --
  // Bitflow-deployed adapters around external DEX protocols (Velar, ALEX,
  // Arkadiko). All four expose top-level public `swap-*` entry points and
  // can be called directly by the Bitflow SDK when it picks them over a
  // router for a given route. Excluded from earlier seed lists by oversight
  // (handoff text referenced "routers" only); legitimate Bitflow-routed
  // swaps were being rejected with `contract_not_allowlisted` when the SDK
  // chose this path.
  {
    contract_id: `${BITFLOW_DEPLOYER}.wrapper-velar-v-1-1`,
    functions: ["swap-helper-a", "swap-helper-b"],
  },
  // v-1-2 was deployed under the XYK principal (not the main BITFLOW_DEPLOYER
  // like v-1-1). Same `swap-helper-a` / `swap-helper-b` ABI. The Bitflow SDK
  // routes STX↔VELAR through this address; without this entry the verifier
  // rejects the swap as `contract_not_allowlisted` even though the trade is
  // a legitimate Bitflow-mediated execution.
  {
    contract_id: `${BITFLOW_XYK_DEPLOYER}.wrapper-velar-v-1-2`,
    functions: ["swap-helper-a", "swap-helper-b"],
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.wrapper-velar-multihop-v-1-1`,
    functions: ["swap-3", "swap-4", "swap-5"],
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.wrapper-alex-v-2-1`,
    functions: [
      "swap-helper",
      "swap-helper-a",
      "swap-helper-b",
      "swap-helper-c",
    ],
  },
  {
    contract_id: `${BITFLOW_DEPLOYER}.wrapper-arkadiko-v-1-1`,
    functions: ["swap-x-for-y", "swap-y-for-x"],
  },
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
  `${BITFLOW_XYK_DEPLOYER}.xyk-swap-helper-v-1-3`,
]);
