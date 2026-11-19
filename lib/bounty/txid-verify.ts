/**
 * On-chain verification for the `/api/bounties/[id]/paid` endpoint.
 *
 * The poster submits a CONFIRMED sBTC transfer txid. We verify on Hiro that:
 *   1. The tx exists and is anchored (else: TX_NOT_CONFIRMED — agent waits, retries)
 *   2. It's a successful sBTC `transfer` contract call, or a call to another
 *      contract that forwards to it (then verified from the events, not the args)
 *   3. Sender = poster's STX address
 *   4. Recipient = a still-unpaid member of the winning submission (each
 *      member of a team is paid directly, never through the lead)
 *   5. Amount >= that member's share (the whole reward for a solo entry)
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

import type { BountyRecord } from "./types";
import { MEMO_PREFIX, SBTC_CONTRACTS, SBTC_CONTRACT_MAINNET } from "./constants";
import { STACKS_API_BASE, STACKS_API_TESTNET_BASE } from "@/lib/identity/constants";
import { buildHiroHeaders, retryAfterSeconds, stacksApiFetch } from "@/lib/stacks-api-fetch";
import {
  TX_EVENT_MAX,
  TX_EVENT_PAGE_FETCH_CONFIG,
  boundTxEventsGap,
  isFinalHiroRejection,
  loadTxEventsUntil,
  readFtTransfer,
  txEventsQuery,
  type HiroFtEvent,
} from "@/lib/stacks-tx-events";
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
  | "EVENTS_TRUNCATED"
  | "RATE_LIMITED"
  | "HIRO_UNREACHABLE";

/** A member of the winning submission who is still owed their share. */
export interface PayoutRecipient {
  btcAddress: string;
  stxAddress: string;
  amountSats: number;
}

export type TxidVerifyResult =
  | {
      ok: true;
      /** The canonical `tx_id` Hiro returned — store this, not the input. */
      canonicalTxid: string;
      blockTimeIso: string;
      /**
       * The recipients this tx paid, one transfer event each. A direct
       * transfer pays one; a contract call can pay several in one tx.
       */
      matched: { btcAddress: string; stxAddress: string; eventIndex: number | null; amount: number }[];
      /** Recipients this tx sent sBTC to, but less than their share (not recorded). */
      underpaid: { btcAddress: string; amount: number; required: number }[];
    }
  | {
      ok: false;
      code: TxidVerifyFailureCode;
      message: string;
      /** Set on `RATE_LIMITED`: seconds to wait before resubmitting. */
      retryAfterSeconds?: number;
    };

/** Hiro answered 429 after `stacksApiFetch` used up its retries: retryable, not a verdict. */
function rateLimitedResult(response: Response): TxidVerifyResult {
  return {
    ok: false,
    code: "RATE_LIMITED",
    message: "Hiro rate limit reached. Retry after a short delay.",
    retryAfterSeconds: retryAfterSeconds(response),
  };
}

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
 * Verify a payout txid against a bounty and the members still owed a share.
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
  /** Unpaid members of the accepted submission. Must be non-empty. */
  recipients: PayoutRecipient[];
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
  /** Hiro API key, sent on every request so they do not go out anonymous. */
  hiroApiKey?: string;
  /** Holds event-gap records (see `boundTxEventsGap`); without it a gap stays retryable. */
  kv?: Pick<KVNamespace, "get" | "put" | "delete">;
}): Promise<TxidVerifyResult> {
  const network = params.network ?? "mainnet";
  const now = params.now ?? new Date();
  const logger = params.logger;
  const sbtcContractId =
    network === "mainnet"
      ? SBTC_CONTRACT_MAINNET
      : `${SBTC_CONTRACTS.testnet.address}.${SBTC_CONTRACTS.testnet.name}`;
  const apiBase = network === "mainnet" ? STACKS_API_BASE : STACKS_API_TESTNET_BASE;
  const byStx = new Map(params.recipients.map((r) => [r.stxAddress, r]));
  const owedList = params.recipients
    .map((r) => `${r.amountSats} sats to ${r.stxAddress}`)
    .join(", ");
  const fetchFn =
    params.fetchFn ?? ((url, init) => stacksApiFetch(url, init, { logger }));
  // Later event pages fail fast (see TX_EVENT_PAGE_FETCH_CONFIG).
  const pageFetchFn =
    params.fetchFn ??
    ((url, init) => stacksApiFetch(url, init, { ...TX_EVENT_PAGE_FETCH_CONFIG, logger }));

  // Pass the txid to Hiro as-is — Hiro accepts both 0x-prefixed and bare hex.
  const txUrl = `${apiBase}/extended/v1/tx/${encodeURIComponent(params.txid)}`;
  const jsonInit: RequestInit = {
    headers: { accept: "application/json", ...buildHiroHeaders(params.hiroApiKey) },
  };
  const fetchJson = (url: string) => fetchFn(url, jsonInit);
  let res: Response;
  try {
    res = await fetchJson(`${txUrl}${txEventsQuery(0)}`);
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
  if (res.status === 429) return rateLimitedResult(res);
  if (isFinalHiroRejection(res.status)) {
    // Hiro refusing this txid (e.g. 400 for one that is not hex). Final:
    // retrying the same txid gets the same answer.
    return {
      ok: false,
      code: "TX_NOT_FOUND",
      message: `Hiro rejected txid ${params.txid} (HTTP ${res.status}). Check it is the 64-hex-character txid of the payout.`,
    };
  }
  if (!res.ok) {
    // 401, 403, 408, 5xx...: about the path to Hiro, not the txid. Retryable.
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

  // (3) Right contract + function. A call to another contract is accepted as
  // a routed payout (a contract that forwards to `sbtc-token.transfer`, e.g. a
  // gasless transfer) and is verified from the events alone, below.
  if (tx.tx_type !== "contract_call" || !tx.contract_call) {
    return {
      ok: false,
      code: "WRONG_CONTRACT",
      message: "Transaction is not a contract call.",
    };
  }
  const isDirect = tx.contract_call.contract_id === sbtcContractId;
  if (isDirect && tx.contract_call.function_name !== "transfer") {
    return {
      ok: false,
      code: "WRONG_FUNCTION",
      message: `Expected function "transfer", got "${tx.contract_call.function_name}".`,
    };
  }

  // Checks that need no events come first: a wrong-sender or stale tx must not
  // cost a page fetch.
  // (4) Sender. Trust both top-level `sender_address` AND the second
  // function_arg (`sender` principal in SIP-010 transfer): they must agree.
  if (tx.sender_address !== params.bounty.posterStxAddress) {
    return {
      ok: false,
      code: "WRONG_SENDER",
      message: `Tx sender ${tx.sender_address} does not match bounty poster ${params.bounty.posterStxAddress}.`,
    };
  }
  if (isDirect) {
    const senderArg = readPrincipalArg(tx.contract_call.function_args, "sender");
    if (senderArg && senderArg !== params.bounty.posterStxAddress) {
      return {
        ok: false,
        code: "WRONG_SENDER",
        message: `Tx function-arg sender ${senderArg} does not match bounty poster.`,
      };
    }

    // (5) Recipient must be one of the members still owed a share. A direct
    // transfer has one recipient, so it pays exactly one member.
    const recipientArg = readPrincipalArg(tx.contract_call.function_args, "recipient");
    if (!recipientArg) {
      return {
        ok: false,
        code: "WRONG_RECIPIENT",
        message: "Transaction function args missing a recipient.",
      };
    }
    if (!byStx.has(recipientArg)) {
      return {
        ok: false,
        code: "WRONG_RECIPIENT",
        message: `Recipient ${recipientArg} is not an unpaid member of the winning submission. Still owed: ${owedList}.`,
      };
    }
  }

  // (8) Tx time > acceptedAt - 60s skew. Prefer `block_time_iso` (Stacks
  // block time — when the tx actually landed in a Stacks block) over
  // `burn_block_time_iso` (Bitcoin anchor block time — can lag by 30+ min).
  // Using the burn block time falsely rejects payouts whose sBTC transfer
  // landed after `acceptedAt` but were anchored to an older Bitcoin block.
  const blockTimeIso = tx.block_time_iso ?? tx.burn_block_time_iso ?? now.toISOString();
  const blockTimeMs = Date.parse(blockTimeIso);
  const acceptedMs = params.bounty.acceptedAt ? Date.parse(params.bounty.acceptedAt) : 0;
  if (!Number.isNaN(blockTimeMs) && blockTimeMs + 60_000 < acceptedMs) {
    return {
      ok: false,
      code: "TX_TOO_OLD",
      message: "Transaction predates acceptance — cannot be the payout for this bounty.",
    };
  }

  // The checks below read the events. Paging stops once every recipient has
  // a verified payout in the loaded events; a refusal is only issued once
  // every page is read (a missing page might hold the payout).
  const expected = buildExpectedMemo(params.bounty.id);
  const directMemoMatches = isDirect && memosMatch(readMemoArg(tx.contract_call.function_args), expected.hex);
  // A direct transfer's memo is an arg: a wrong one is known without the events.
  if (isDirect && !directMemoMatches) {
    return {
      ok: false,
      code: "MEMO_MISMATCH",
      message: `Memo did not match. Expected ${expected.hex} ("${expected.ascii}"). Include this memo in the sBTC transfer.`,
    };
  }

  // One verified transfer per recipient: from the poster, to that member, at
  // least their share, with the bounty memo bound to that very transfer.
  // Routed payout: the top-level args belong to the wrapper, so the memo is
  // read from the print `sbtc-token.transfer` emits right after its FT
  // transfer. Only that contract can emit a print under its own id, and
  // requiring the next event index binds the memo to this very transfer.
  const matchPayouts = (evs: HiroTxEvent[]) => {
    const matched: { btcAddress: string; stxAddress: string; eventIndex: number | null; amount: number }[] = [];
    for (const ev of findSbtcTransferEvents(evs, sbtcContractId)) {
      const r = byStx.get(ev.recipient);
      if (!r || ev.sender !== params.bounty.posterStxAddress || ev.amount < r.amountSats) continue;
      if (matched.some((m) => m.stxAddress === r.stxAddress)) continue;
      if (!isDirect && !memosMatch(readSbtcMemoPrint(evs, sbtcContractId, ev.eventIndex), expected.hex)) {
        continue;
      }
      matched.push({ btcAddress: r.btcAddress, stxAddress: r.stxAddress, eventIndex: ev.eventIndex, amount: ev.amount });
    }
    return matched;
  };
  const wanted = isDirect ? 1 : params.recipients.length;
  const events = await boundTxEventsGap(
    await loadTxEventsUntil(
      tx,
      txUrl,
      (url) => pageFetchFn(url, jsonInit),
      (evs) => matchPayouts(evs).length >= wanted
    ),
    tx.tx_id ?? params.txid,
    params.kv,
    now.getTime()
  );
  if (events.state === "unreachable") {
    if (events.response?.status === 429) return rateLimitedResult(events.response);
    return { ok: false, code: "HIRO_UNREACHABLE", message: "Could not read the transaction events." };
  }

  const matched = matchPayouts(tx.events ?? []);
  const sbtcTransfers = findSbtcTransferEvents(tx.events, sbtcContractId);
  const underpaid = params.recipients
    .filter((r) => !matched.some((m) => m.stxAddress === r.stxAddress))
    .flatMap((r) => {
      const sent = sbtcTransfers.filter(
        (ev) => ev.sender === params.bounty.posterStxAddress && ev.recipient === r.stxAddress
      );
      if (sent.length === 0) return [];
      const amount = Math.max(...sent.map((ev) => ev.amount));
      return amount < r.amountSats ? [{ btcAddress: r.btcAddress, amount, required: r.amountSats }] : [];
    });

  // A payout found in the events that did load is on-chain proof, even when
  // later pages could not be read: record what is proven.
  if (matched.length > 0) {
    return { ok: true, canonicalTxid: tx.tx_id, blockTimeIso, matched, underpaid };
  }

  if (events.state === "truncated" || events.state === "incomplete") {
    return {
      ok: false,
      code: "EVENTS_TRUNCATED",
      message: unverifiableMessage(tx.event_count, events.state),
    };
  }

  // Nothing matched: say which check failed. Cross-checking against the FT
  // events catches wrapper contracts that pass crafted args but route the
  // actual transfer differently; the calling contract cannot forge an sBTC
  // FT event.
  if (sbtcTransfers.length === 0) {
    return {
      ok: false,
      code: "WRONG_CONTRACT",
      message: isDirect
        ? "No matching sBTC FT transfer event in the transaction."
        : `Expected sBTC contract ${sbtcContractId}, got ${tx.contract_call.contract_id}, and the transaction moved no sBTC.`,
    };
  }
  const toMembers = sbtcTransfers.filter(
    (ev) => ev.sender === params.bounty.posterStxAddress && byStx.has(ev.recipient)
  );
  if (toMembers.length === 0) {
    return {
      ok: false,
      code: "WRONG_RECIPIENT",
      message: `No sBTC transfer from the poster to an unpaid member. Still owed: ${owedList}.`,
    };
  }
  if (underpaid.length > 0) {
    return {
      ok: false,
      code: "AMOUNT_TOO_LOW",
      message: underpaid
        .map((u) => `Transferred ${u.amount} sats < owed ${u.required} sats to ${u.btcAddress}.`)
        .join(" "),
    };
  }
  return {
    ok: false,
    code: "MEMO_MISMATCH",
    message: `Memo did not match. Expected ${expected.hex} ("${expected.ascii}"). Include this memo in the sBTC transfer.`,
  };
}

/**
 * `EVENTS_TRUNCATED` message. The payout may well be on-chain, so the poster is
 * told NOT to pay again: a second transfer would pay the winner twice.
 */
function unverifiableMessage(eventCount: number | undefined, state: "truncated" | "incomplete"): string {
  const why =
    state === "truncated"
      ? `The transaction has ${eventCount} events and the payout is not in the first ${TX_EVENT_MAX}`
      : "Hiro did not return all of the transaction's events";
  return (
    `${why}, so it cannot be verified automatically. Do not pay the winner again: ` +
    "report the txid at https://github.com/aibtcdev/landing-page/issues so it can be checked by hand. " +
    "Send future payouts as a direct sbtc-token transfer."
  );
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

/** FT fields in either shape (see `readFtTransfer`), plus the print log. */
interface HiroTxEvent extends HiroFtEvent {
  event_index?: number;
  contract_log?: {
    contract_id?: string;
    topic?: string;
    value?: { hex?: string };
  };
}

interface HiroTxResponse {
  tx_id: string;
  tx_status: "success" | "pending" | "abort_by_response" | "abort_by_post_condition" | string;
  tx_type: "contract_call" | string;
  sender_address: string;
  is_unanchored: boolean;
  event_count?: number;
  block_time_iso?: string;
  burn_block_time_iso?: string;
  contract_call?: {
    contract_id: string;
    function_name: string;
    function_args: HiroFunctionArg[];
  };
  events?: HiroTxEvent[];
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

function readMemoArg(args: HiroFunctionArg[] | undefined): string | null {
  if (!args) return null;
  const cv = decodeArg(args.find((a) => a.name === "memo"));
  if (!cv) return null;
  if (cv.type !== ClarityType.OptionalSome) return null;
  const inner = cv.value;
  if (inner.type !== ClarityType.Buffer) return null;
  return inner.value.toLowerCase().replace(/^0x/, "");
}

/**
 * Memo printed by `sbtc-token.transfer` for the FT transfer at `ftEventIndex`.
 * The contract prints the unwrapped memo buffer as the event right after its
 * `ft-transfer?`, so anything else at that index is not this transfer's memo.
 */
function readSbtcMemoPrint(
  events: HiroTxEvent[] | undefined,
  sbtcContractId: string,
  ftEventIndex: number | null
): string | null {
  if (!events || ftEventIndex == null) return null;
  const ev = events.find((e) => e.event_index === ftEventIndex + 1);
  if (ev?.event_type !== "smart_contract_log") return null;
  if (ev.contract_log?.contract_id !== sbtcContractId || ev.contract_log.topic !== "print") {
    return null;
  }
  const cv = decodeArg(ev.contract_log.value);
  if (!cv || cv.type !== ClarityType.Buffer) return null;
  return cv.value.toLowerCase().replace(/^0x/, "");
}

function memosMatch(actualHex: string | null, expectedHex: string): boolean {
  if (!actualHex) return false;
  const a = actualHex.replace(/^0x/, "").toLowerCase();
  const b = expectedHex.replace(/^0x/, "").toLowerCase();
  return a === b;
}

function findSbtcTransferEvents(
  events: HiroTxEvent[] | undefined,
  expectedAssetId: string
): { eventIndex: number | null; sender: string; recipient: string; amount: number }[] {
  const found = [];
  for (const ev of events ?? []) {
    const transfer = readFtTransfer(ev);
    // sBTC asset_id looks like `${sbtcContractId}::sbtc-token` — anchor on `::`
    // so we don't accidentally match a sibling like `sbtc-token-extended`.
    if (transfer && transfer.assetId.startsWith(`${expectedAssetId}::`)) {
      const { sender, recipient, amount } = transfer;
      found.push({ eventIndex: ev.event_index ?? null, sender, recipient, amount });
    }
  }
  return found;
}
