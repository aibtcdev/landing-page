/**
 * Swap event parser for the trading-comp verifier.
 *
 * Walks the FT/STX transfer events on a Hiro `extended/v1/tx/{txid}` response
 * and produces (token_in, amount_in, token_out, amount_out) plus the
 * `raw_event_json` audit trail that gets persisted on the swap row.
 *
 * Phase 3.1 PR-B — covers Bitflow stableswap, xyk, dlmm, and cross-DEX
 * router shapes. The parser is intentionally protocol-agnostic at the event
 * layer: rather than special-case each contract, it identifies the agent
 * (tx sender) and finds the largest outbound + inbound transfer touching
 * that principal. This works for all four Bitflow allowlist shapes today
 * and degrades cleanly to "incomplete_events" when the tx is multi-leg
 * (Zest supply+borrow); the multi-leg swap_legs table is a future migration.
 *
 * Phase 3.1 PR-E — when the contract is in PROVIDER_ATTRIBUTION_CONTRACTS
 * (currently `xyk-swap-helper-v-1-3`), the parser also extracts the
 * `provider` clarity arg and records it under `raw_event_json.provider`
 * so the AIBTC attribution audit can later cross-check against the
 * AIBTC_PROVIDER_ADDRESS without changing schema.
 */

import { PROVIDER_ATTRIBUTION_CONTRACTS } from "./allowlist";

/**
 * Pseudo asset id used to represent native STX in the swaps table.
 * sBTC and other SIP-010 tokens already have real contract ids that look
 * like `SP….ststx-token::ststx`; we mint a synthetic id for STX so the
 * `token_in` / `token_out` columns can stay NOT NULL.
 */
export const STX_ASSET_ID = "stx";

/**
 * Hiro `event_type` values that identify an STX transfer event.
 *
 * The mainnet `/extended/v1/tx/{txid}` endpoint returns `stx_asset` today
 * (verified against tx `0x46bc5587…f0ee0e4` — Bitflow stableswap-stx-ststx).
 * The older blockchain-api and some downstream tooling emit
 * `stx_transfer_event` / `stx_transfer`; both are kept here so the parser
 * stays correct if we read from a different Hiro version or a self-hosted
 * indexer. STX events in the Hiro response do NOT carry an `asset_id`, so
 * we synthesize STX_ASSET_ID from the event_type discriminator.
 */
const STX_EVENT_TYPES: ReadonlySet<string> = new Set([
  "stx_asset",
  "stx_transfer_event",
  "stx_transfer",
]);

/** Minimal contract-call shape from the Hiro tx response. */
export interface HiroContractCall {
  contract_id: string;
  function_name: string;
  function_args: Array<{
    name?: string;
    type?: string;
    repr?: string;
  }>;
}

interface HiroAssetEvent {
  asset_event_type?: "transfer" | "mint" | "burn";
  sender?: string;
  recipient?: string;
  amount?: string;
  asset_id?: string;
}

interface HiroEvent {
  event_index?: number;
  event_type?: string;
  asset?: HiroAssetEvent;
}

/** Subset of the Hiro tx response that the parser needs. */
export interface HiroTxForSwap {
  tx_id: string;
  tx_status: string;
  sender_address: string;
  tx_type: string;
  burn_block_time?: number;
  burn_block_time_iso?: string;
  contract_call?: HiroContractCall;
  events?: HiroEvent[];
}

export interface ParsedSwap {
  contract_id: string;
  function_name: string;
  token_in: string;
  amount_in: number;
  token_out: string;
  amount_out: number;
  /** Optional audit blob written verbatim to `swaps.raw_event_json`. */
  raw_event_json: string;
}

export type ParseFailureCode =
  | "not_contract_call"
  | "missing_contract_call"
  | "no_transfer_events"
  | "incomplete_events"
  | "invalid_amount";

export type ParseResult =
  | { ok: true; swap: ParsedSwap }
  | { ok: false; code: ParseFailureCode; reason: string };

interface TransferLeg {
  asset_id: string;
  amount: number;
  counterparty: string;
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  // Hiro returns amounts as decimal strings. Use Number — js-numbers are
  // 2^53; Bitflow swap amounts on sBTC (8 decimals) and STX (6 decimals)
  // fit comfortably. If a future protocol uses 18 decimals we'd revisit
  // (the swaps table column is INTEGER, which D1/SQLite stores as i64).
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Walk a Hiro tx response and produce the swap row + audit blob.
 *
 * Returns a discriminated result; callers (verify.ts) translate the failure
 * code into the appropriate HTTP response.
 */
export function parseSwapFromTx(tx: HiroTxForSwap): ParseResult {
  if (tx.tx_type !== "contract_call") {
    return {
      ok: false,
      code: "not_contract_call",
      reason: `tx_type is '${tx.tx_type}', expected 'contract_call'`,
    };
  }
  if (!tx.contract_call) {
    return {
      ok: false,
      code: "missing_contract_call",
      reason: "Hiro response lacked contract_call payload",
    };
  }

  const agent = tx.sender_address;
  const legsOut: TransferLeg[] = [];
  const legsIn: TransferLeg[] = [];

  for (const ev of tx.events ?? []) {
    const a = ev.asset;
    if (!a || a.asset_event_type !== "transfer") continue;

    const amount = parseAmount(a.amount);
    if (amount === null) {
      return {
        ok: false,
        code: "invalid_amount",
        reason: `Non-integer transfer amount '${a.amount}' on event ${ev.event_index ?? "?"}`,
      };
    }

    const assetId =
      STX_EVENT_TYPES.has(ev.event_type ?? "")
        ? STX_ASSET_ID
        : a.asset_id ?? "unknown";

    if (a.sender === agent && a.recipient && a.recipient !== agent) {
      legsOut.push({ asset_id: assetId, amount, counterparty: a.recipient });
    } else if (a.recipient === agent && a.sender && a.sender !== agent) {
      legsIn.push({ asset_id: assetId, amount, counterparty: a.sender });
    }
  }

  if (legsOut.length === 0 || legsIn.length === 0) {
    return {
      ok: false,
      code: legsOut.length === 0 && legsIn.length === 0
        ? "no_transfer_events"
        : "incomplete_events",
      reason: `legsOut=${legsOut.length} legsIn=${legsIn.length}; expected ≥1 of each`,
    };
  }

  // For multi-leg routes (e.g. xyk-swap-helper with intermediate hops), the
  // economically interesting pair is "largest outbound from agent" +
  // "largest inbound to agent". This collapses N-hop routes to a single
  // row — multi-leg parsing is a follow-up migration (swap_legs table).
  const out = legsOut.reduce((a, b) => (b.amount > a.amount ? b : a));
  const inn = legsIn.reduce((a, b) => (b.amount > a.amount ? b : a));

  const audit: Record<string, unknown> = {
    legsOut,
    legsIn,
  };

  // PR-E: when the contract is one of the provider-attribution shapes,
  // try to extract the `provider` clarity arg. Bitflow's xyk-swap-helper
  // contracts take a `provider` arg whose repr starts with `'` (clarity
  // principal literal) — we capture it verbatim for the audit trail.
  const cc = tx.contract_call;
  if (PROVIDER_ATTRIBUTION_CONTRACTS.has(cc.contract_id)) {
    const providerArg = cc.function_args.find((a) => a.name === "provider");
    if (providerArg?.repr) {
      // Clarity principal repr is `'SP…` — strip the leading quote so the
      // audit value is comparable to AIBTC_PROVIDER_ADDRESS directly.
      audit.provider = providerArg.repr.startsWith("'")
        ? providerArg.repr.slice(1)
        : providerArg.repr;
    }
  }

  return {
    ok: true,
    swap: {
      contract_id: cc.contract_id,
      function_name: cc.function_name,
      token_in: out.asset_id,
      amount_in: out.amount,
      token_out: inn.asset_id,
      amount_out: inn.amount,
      raw_event_json: JSON.stringify(audit),
    },
  };
}
