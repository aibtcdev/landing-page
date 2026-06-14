/**
 * On-chain verification for the `/api/bounties/[id]/paid` endpoint.
 *
 * The poster submits a CONFIRMED sBTC transfer txid. We verify on Hiro that:
 *   1. The tx exists and is anchored (else: TX_NOT_CONFIRMED — agent waits, retries)
 *   2. It's a successful sBTC `transfer` contract call
 *   3. Sender = poster's STX address
 *   4. Recipient = winning submitter's STX address
 *   5. Amount >= bounty.rewardSats
 *   6. Memo equals `BNTY:{bountyId}` (the anti-fraud binding — same memo cannot
 *      be reused, and an unrelated transfer to the same winner cannot be passed
 *      off as a bounty payment)
 *   7. Tx happened after the bounty was accepted (defense in depth — memo
 *      binding already locks the tx to this bountyId, but the timestamp check
 *      catches a poster who somehow racially pre-staged a payment)
 *
 * Mirrors the failure-code style of `lib/inbox/x402-verify.ts`. The route
 * handler maps each code to an HTTP response.
 */

import type { BountyRecord, BountySubmission } from "./types";
import { MEMO_PREFIX, SBTC_CONTRACTS, SBTC_CONTRACT_MAINNET } from "./constants";
import { STACKS_API_BASE, STACKS_API_TESTNET_BASE } from "@/lib/identity/constants";
import { stacksApiFetch } from "@/lib/stacks-api-fetch";
import type { Logger } from "@/lib/logging";
import {
  ClarityType,
  deserializeCV,
  type ClarityValue,
} from "@stacks/transactions";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type TxidVerifyFailureCode =
  | "TX_NOT_FOUND"
  | "TX_NOT_CONFIRMED"
  | "TX_FAILED"
  | "WRONG_CONTRACT"
  | "WRONG_FUNCTION"
  | "WRONG_SENDER"
  | "WRONG_RECIPIENT"
  | "AMOUNT_TOO_LOW"
  | "MEMO_MISMATCH"
  | "TX_TOO_OLD"
  | "HIRO_UNREACHABLE";

export type TxidVerifyResult =
  | {
      ok: true;
      /** The canonical `tx_id` Hiro returned — store this, not the input. */
      canonicalTxid: string;
      blockTimeIso: string;
    }
  | { ok: false; code: TxidVerifyFailureCode; message: string };

/**
 * Build the expected SIP-010 memo for a given bountyId.
 *
 * Format: ASCII bytes of `"BNTY:" + bountyId`.
 *
 * The 26-character ulid + 5-character prefix = 31 bytes, fits in `(buff 34)`.
 * Returned in three convenient forms so the API can surface whichever the
 * agent's wallet tooling needs:
 *
 *   - `ascii`: the raw string (`"BNTY:01HNX7..."`) — what the poster types
 *   - `bytes`: the Uint8Array — for low-level Clarity tooling
 *   - `hex`:   `0x...` — for direct contract-call construction
 */
export function buildExpectedMemo(bountyId: string): {
  ascii: string;
  bytes: Uint8Array;
  hex: string;
} {
  const ascii = `${MEMO_PREFIX}${bountyId}`;
  const bytes = new TextEncoder().encode(ascii);
  const hex = `0x${Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
  return { ascii, bytes, hex };
}

/**
 * Verify a payout txid against a specific bounty + accepted submission.
 *
 * Pure logic over an injected `fetch` function so the unit tests can stub
 * Hiro without network calls. The route handler wires up the real `fetch`.
 *
 * Returns `{ ok: true, blockTimeIso }` on success, or a failure code on any
 * verification check. Does NOT mutate D1 or KV — the caller does that after
 * a successful verify.
 */
export async function verifyPayoutTxid(params: {
  txid: string;
  bounty: BountyRecord;
  acceptedSubmission: BountySubmission;
  /**
   * Per-slot expected amount in sats. Defaults to `bounty.rewardSats` for
   * single-winner bounties. For multi-winner, pass `bounty.rewardSats / bounty.maxWinners`.
   */
  expectedAmountSats?: number;
  /**
   * The specific winner's acceptedAt (from bounty_winners row). Overrides
   * `bounty.acceptedAt` for the TX_TOO_OLD check when paying a specific winner.
   */
  winnerAcceptedAt?: string;
  /**
   * Override the HTTP fetcher. Defaults to `stacksApiFetch()` from
   * `lib/stacks-api-fetch.ts` (the canonical helper with retry + 429
   * handling). Tests pass a stub.
   */
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  /** Override for tests. Defaults to mainnet. */
  network?: "mainnet" | "testnet";
  /** Override for tests. Defaults to `new Date()`. */
  now?: Date;
  /** Pass-through Logger for Hiro rate-limit + retry telemetry. */
  logger?: Logger;
}): Promise<TxidVerifyResult> {
  const network = params.network ?? "mainnet";
  const now = params.now ?? new Date();
  const logger = params.logger;
  const sbtcContractId =
    network === "mainnet"
      ? SBTC_CONTRACT_MAINNET
      : `${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.name}`;
  const apiBase = network === "mainnet" ? STACKS_API_BASE : STACKS_API_TESTNET_BASE;
  const fetchFn =
    params.fetchFn ?? ((url, init) => stacksApiFetch(url, init, { logger }));

  // Pass the txid to Hiro as-is — Hiro accepts both 0x-prefixed and bare hex.
  let res: Response;
  try {
    res = await fetchFn(`${apiBase}/extended/v1/tx/${encodeURIComponent(params.txid)}`, {
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, code: "HIRO_UNREACHABLE", message: "Could not reach Hiro." };
  }

  if (res.status === 404) {
    return {
      ok: false,
      code: "TX_NOT_FOUND",
      message: `Transaction ${params.txid} not found on Stacks.`,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      code: "HIRO_UNREACHABLE",
      message: `Hiro returned ${res.status}.`,
    };
  }

  let tx: HiroTxResponse;
  try {
    tx = (await res.json()) as HiroTxResponse;
  } catch {
    return { ok: false, code: "HIRO_UNREACHABLE", message: "Could not parse Hiro response." };
  }

  // (2) Anchored confirmation. The poster's contract is to submit a confirmed
  // txid — if it isn't yet, we reject and they retry on their side.
  if (tx.is_unanchored) {
    return {
      ok: false,
      code: "TX_NOT_CONFIRMED",
      message: "Transaction is not yet anchored. Wait for confirmation, then resubmit.",
    };
  }
  if (tx.tx_status !== "success") {
    if (tx.tx_status === "pending") {
      return {
        ok: false,
        code: "TX_NOT_CONFIRMED",
        message: "Transaction is still pending. Wait for confirmation, then resubmit.",
      };
    }
    return {
      ok: false,
      code: "TX_FAILED",
      message: `Transaction has status "${tx.tx_status}".`,
    };
  }

  // (3) Right contract + function.
  if (tx.tx_type !== "contract_call" || !tx.contract_call) {
    return {
      ok: false,
      code: "WRONG_CONTRACT",
      message: "Transaction is not a contract call.",
    };
  }
  if (tx.contract_call.contract_id !== sbtcContractId) {
    return {
      ok: false,
      code: "WRONG_CONTRACT",
      message: `Expected sBTC contract ${sbtcContractId}, got ${tx.contract_call.contract_id}.`,
    };
  }
  if (tx.contract_call.function_name !== "transfer") {
    return {
      ok: false,
      code: "WRONG_FUNCTION",
      message: `Expected function "transfer", got "${tx.contract_call.function_name}".`,
    };
  }

  // (4) Sender. Trust both top-level `sender_address` AND the second
  // function_arg (`sender` principal in SIP-010 transfer): they must agree.
  const senderArg = readPrincipalArg(tx.contract_call.function_args, "sender");
  if (tx.sender_address !== params.bounty.posterStxAddress) {
    return {
      ok: false,
      code: "WRONG_SENDER",
      message: `Tx sender ${tx.sender_address} does not match bounty poster ${params.bounty.posterStxAddress}.`,
    };
  }
  if (senderArg && senderArg !== params.bounty.posterStxAddress) {
    return {
      ok: false,
      code: "WRONG_SENDER",
      message: `Tx function-arg sender ${senderArg} does not match bounty poster.`,
    };
  }

  // (5) Recipient must match the accepted submitter's STX address.
  const recipientArg = readPrincipalArg(tx.contract_call.function_args, "recipient");
  if (!recipientArg) {
    return {
      ok: false,
      code: "WRONG_RECIPIENT",
      message: "Transaction function args missing a recipient.",
    };
  }
  if (recipientArg !== params.acceptedSubmission.submitterStxAddress) {
    return {
      ok: false,
      code: "WRONG_RECIPIENT",
      message: `Recipient ${recipientArg} does not match winner's STX address ${params.acceptedSubmission.submitterStxAddress}.`,
    };
  }

  // Cross-check with the FT transfer event for the same parties + amount —
  // this catches wrapper contracts that pass crafted args but route the
  // actual transfer differently.
  const ftEvent = findSbtcTransferEvent(tx.events, sbtcContractId);
  if (!ftEvent) {
    return {
      ok: false,
      code: "WRONG_CONTRACT",
      message: "No matching sBTC FT transfer event in the transaction.",
    };
  }
  if (
    ftEvent.sender !== params.bounty.posterStxAddress ||
    ftEvent.recipient !== params.acceptedSubmission.submitterStxAddress
  ) {
    return {
      ok: false,
      code: "WRONG_RECIPIENT",
      message: "FT event sender/recipient do not match expected.",
    };
  }

  // (6) Amount.
  const amountFromArg = readUintArg(tx.contract_call.function_args, "amount");
  const amountFromEvent = parseAmount(ftEvent.amount);
  const amount = amountFromEvent ?? amountFromArg;
  if (amount == null) {
    return {
      ok: false,
      code: "AMOUNT_TOO_LOW",
      message: "Could not determine transfer amount.",
    };
  }
  const expectedAmount = params.expectedAmountSats ?? params.bounty.rewardSats;
  if (amount < expectedAmount) {
    return {
      ok: false,
      code: "AMOUNT_TOO_LOW",
      message: `Transferred ${amount} sats < expected ${expectedAmount} sats (${params.bounty.rewardSats} total / ${params.bounty.maxWinners ?? 1} winner${(params.bounty.maxWinners ?? 1) > 1 ? "s" : ""}).`,
    };
  }

  // (7) Memo: must equal `BNTY:{bountyId}`. This is the binding that prevents
  // a poster from passing off an unrelated transfer as a bounty payment.
  const expected = buildExpectedMemo(params.bounty.id);
  const memoHex = readMemoArg(tx.contract_call.function_args);
  if (!memoHex || !memosMatch(memoHex, expected.hex)) {
    return {
      ok: false,
      code: "MEMO_MISMATCH",
      message: `Memo did not match. Expected ${expected.hex} ("${expected.ascii}"). Include this memo in the sBTC transfer.`,
    };
  }

  // (8) Tx time > acceptedAt - 60s skew. Prefer `block_time_iso` (Stacks
  // block time — when the tx actually landed in a Stacks block) over
  // `burn_block_time_iso` (Bitcoin anchor block time — can lag by 30+ min).
  // Using the burn block time falsely rejects payouts whose sBTC transfer
  // landed after `acceptedAt` but were anchored to an older Bitcoin block.
  const blockTimeIso = tx.block_time_iso ?? tx.burn_block_time_iso ?? now.toISOString();
  const blockTimeMs = Date.parse(blockTimeIso);
  // Prefer the specific winner's acceptedAt over the legacy bounty-level field.
  const acceptedMs = params.winnerAcceptedAt
    ? Date.parse(params.winnerAcceptedAt)
    : params.bounty.acceptedAt
      ? Date.parse(params.bounty.acceptedAt)
      : 0;
  if (!Number.isNaN(blockTimeMs) && blockTimeMs + 60_000 < acceptedMs) {
    return {
      ok: false,
      code: "TX_TOO_OLD",
      message: "Transaction predates acceptance — cannot be the payout for this bounty.",
    };
  }

  return { ok: true, canonicalTxid: tx.tx_id, blockTimeIso };
}

// ---------------------------------------------------------------------------
// Hiro response shape (narrow — only fields we read)
// ---------------------------------------------------------------------------

interface HiroFunctionArg {
  hex?: string;
  repr?: string;
  name?: string;
  type?: string;
}

interface HiroFtTransferEvent {
  event_type: "fungible_token_asset";
  asset?: {
    asset_event_type?: string;
    asset_id?: string;
    sender?: string;
    recipient?: string;
    amount?: string;
  };
  // Legacy / alternative shapes some endpoints surface:
  sender?: string;
  recipient?: string;
  amount?: string;
  asset_event_type?: string;
  asset_id?: string;
}

interface HiroTxResponse {
  tx_id: string;
  tx_status: "success" | "pending" | "abort_by_response" | "abort_by_post_condition" | string;
  tx_type: "contract_call" | string;
  sender_address: string;
  is_unanchored: boolean;
  block_time_iso?: string;
  burn_block_time_iso?: string;
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: HiroFunctionArg[];
  };
  events?: HiroFtTransferEvent[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// Args are parsed by deserializing the canonical Clarity hex (`arg.hex`) via
// @stacks/transactions. Type-tagged ClarityValues remove the regex-on-`repr`
// guesswork that the earlier implementation used — no presentation-string
// fallbacks, no substring matching on memos.

function decodeArg(arg: HiroFunctionArg | undefined): ClarityValue | null {
  if (!arg?.hex) return null;
  try {
    return deserializeCV(arg.hex);
  } catch {
    return null;
  }
}

function readPrincipalArg(args: HiroFunctionArg[] | undefined, name: string): string | null {
  if (!args) return null;
  const cv = decodeArg(args.find((a) => a.name === name));
  if (!cv) return null;
  if (cv.type === ClarityType.PrincipalStandard || cv.type === ClarityType.PrincipalContract) {
    return cv.value;
  }
  return null;
}

function readUintArg(args: HiroFunctionArg[] | undefined, name: string): number | null {
  if (!args) return null;
  const cv = decodeArg(args.find((a) => a.name === name));
  if (!cv || cv.type !== ClarityType.UInt) return null;
  const n = Number(cv.value);
  return Number.isFinite(n) ? n : null;
}

function readMemoArg(args: HiroFunctionArg[] | undefined): string | null {
  if (!args) return null;
  const cv = decodeArg(args.find((a) => a.name === "memo"));
  if (!cv) return null;
  if (cv.type !== ClarityType.OptionalSome) return null;
  const inner = cv.value;
  if (inner.type !== ClarityType.Buffer) return null;
  return inner.value.toLowerCase().replace(/^0x/, "");
}

function memosMatch(actualHex: string, expectedHex: string): boolean {
  const a = actualHex.replace(/^0x/, "").toLowerCase();
  const b = expectedHex.replace(/^0x/, "").toLowerCase();
  return a === b;
}

function findSbtcTransferEvent(
  events: HiroFtTransferEvent[] | undefined,
  expectedAssetId: string
): { sender: string; recipient: string; amount: string } | null {
  if (!events) return null;
  for (const ev of events) {
    if (ev.event_type !== "fungible_token_asset") continue;
    const sender = ev.asset?.sender ?? ev.sender;
    const recipient = ev.asset?.recipient ?? ev.recipient;
    const amount = ev.asset?.amount ?? ev.amount;
    const assetId = ev.asset?.asset_id ?? ev.asset_id;
    // sBTC asset_id looks like `${sbtcContractId}::sbtc-token` — anchor on `::`
    // so we don't accidentally match a sibling like `sbtc-token-extended`.
    if (assetId && assetId.startsWith(`${expectedAssetId}::`) && sender && recipient && amount) {
      return { sender, recipient, amount };
    }
  }
  return null;
}

function parseAmount(amount: string | undefined): number | null {
  if (amount == null) return null;
  const n = Number(amount);
  return Number.isFinite(n) ? n : null;
}
