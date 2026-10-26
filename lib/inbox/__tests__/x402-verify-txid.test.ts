import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTxidPayment } from "../x402-verify";
import { INBOX_PRICE_SATS, SBTC_CONTRACTS } from "../constants";
import { TX_EVENT_MAX, TX_EVENT_PAGE_SIZE } from "@/lib/stacks-tx-events";
import { createMockKV } from "./kv-mock";

const SBTC = `${SBTC_CONTRACTS.mainnet.address}.${SBTC_CONTRACTS.mainnet.name}`;
const PAYER = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const RECIPIENT = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const OTHER = "SP229F3KDGJJ79DMAPHKYQD6KF6DXM2NPAKHZ51HR";
const WRAPPER = `${OTHER}.gasless-transfer`;
const TXID = "ab".repeat(32);

function ftEvent(event_index: number, sender: string, recipient: string, amount: number) {
  return {
    event_index,
    event_type: "fungible_token_asset",
    asset: {
      asset_event_type: "transfer",
      asset_id: `${SBTC}::sbtc-token`,
      sender,
      recipient,
      amount: String(amount),
    },
  };
}

function directTx() {
  return {
    tx_id: `0x${TXID}`,
    tx_status: "success",
    tx_type: "contract_call",
    sender_address: PAYER,
    contract_call: {
      contract_id: SBTC,
      function_name: "transfer",
      function_args: [
        { name: "amount", type: "uint", repr: `u${INBOX_PRICE_SATS}` },
        { name: "sender", type: "principal", repr: `'${PAYER}` },
        { name: "recipient", type: "principal", repr: `'${RECIPIENT}` },
        { name: "memo", type: "(optional (buff 34))", repr: "none" },
      ],
    },
    events: [ftEvent(0, PAYER, RECIPIENT, INBOX_PRICE_SATS)],
  };
}

// A payment routed through a contract that forwards to `sbtc-token.transfer`:
// the fee to the wrapper comes first, the payment to the recipient after it.
function routedTx(events: unknown[]) {
  return {
    ...directTx(),
    contract_call: {
      contract_id: WRAPPER,
      function_name: "transfer-stacks-to-stacks",
      function_args: [
        { name: "amount", type: "uint", repr: `u${INBOX_PRICE_SATS}` },
        { name: "recipient", type: "principal", repr: `'${RECIPIENT}` },
        { name: "memo", type: "(optional (buff 34))", repr: "none" },
        { name: "fee", type: "uint", repr: "u10" },
      ],
    },
    events,
  };
}

function stubHiro(tx: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(tx), { status: 200 }))
  );
}

// Hiro pages the events: the first response carries `firstPage` of them and
// `event_count` the total, and `event_offset` asks for the rest. Like Hiro, it
// refuses an `event_limit` above 100. `laterPage` replaces every later page.
function stubPagedHiro(
  tx: { events: unknown[] },
  firstPage: number,
  opts: { eventCount?: number; laterPage?: () => Response } = {}
) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const params = new URL(String(url)).searchParams;
    const offset = Number(params.get("event_offset") ?? 0);
    if (!(Number(params.get("event_limit")) <= 100)) return new Response("{}", { status: 400 });
    if (offset > 0 && opts.laterPage) return opts.laterPage();
    const events = tx.events.slice(offset, offset + (offset === 0 ? firstPage : TX_EVENT_PAGE_SIZE));
    const body = { ...tx, event_count: opts.eventCount ?? tx.events.length, events };
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("verifyTxidPayment", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a direct sbtc-token.transfer", async () => {
    stubHiro(directTx());
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: true, payerStxAddress: PAYER, paymentTxid: TXID });
  });

  it("accepts a payment routed through a contract that forwards to sbtc-token.transfer", async () => {
    stubHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 10), ftEvent(2, PAYER, RECIPIENT, INBOX_PRICE_SATS)])
    );
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: true, payerStxAddress: PAYER, paymentTxid: TXID });
  });

  it("routed: reads the events past the first page to find the payment", async () => {
    stubPagedHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 10), ftEvent(1, PAYER, RECIPIENT, INBOX_PRICE_SATS)]),
      1
    );
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: true, payerStxAddress: PAYER, paymentTxid: TXID });
  });

  it("rewrites a cached first-page-only transaction with every event", async () => {
    const tx = routedTx([ftEvent(0, PAYER, WRAPPER, 10), ftEvent(1, PAYER, RECIPIENT, INBOX_PRICE_SATS)]);
    const kv = createMockKV();
    await kv.put(`cache:tx:${TXID}`, JSON.stringify({ ...tx, event_count: 2, events: tx.events.slice(0, 1) }));
    stubPagedHiro(tx, 1);
    const r = await verifyTxidPayment(TXID, RECIPIENT, "mainnet", undefined, kv);
    expect(r).toMatchObject({ success: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cached = JSON.parse((await kv.get(`cache:tx:${TXID}`)) as string);
    expect(cached.events).toHaveLength(2);
  });

  it("returns EVENTS_TRUNCATED without paging when the tx has too many events", async () => {
    const fetchMock = stubPagedHiro(routedTx([ftEvent(0, PAYER, RECIPIENT, INBOX_PRICE_SATS)]), 1, {
      eventCount: TX_EVENT_MAX + 1,
    });
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "EVENTS_TRUNCATED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable API_ERROR when a later page of events fails", async () => {
    stubPagedHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 10), ftEvent(1, PAYER, RECIPIENT, INBOX_PRICE_SATS)]),
      1,
      { laterPage: () => new Response("{}", { status: 404 }) }
    );
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "API_ERROR", retryAfterSeconds: 30 });
  });

  it("returns RATE_LIMITED with Hiro's Retry-After when a later page is rate-limited", async () => {
    stubPagedHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 10), ftEvent(1, PAYER, RECIPIENT, INBOX_PRICE_SATS)]),
      1,
      { laterPage: () => new Response("{}", { status: 429, headers: { "Retry-After": "7" } }) }
    );
    // stacksApiFetch retries a 429 after Retry-After; skip the waits.
    vi.useFakeTimers();
    try {
      const pending = verifyTxidPayment(TXID, RECIPIENT);
      await vi.runAllTimersAsync();
      const r = await pending;
      expect(r).toMatchObject({ success: false, errorCode: "RATE_LIMITED", retryAfterSeconds: 7 });
    } finally {
      vi.useRealTimers();
    }
  });

  // Hiro gives a mint no sender, so this event shape does not occur; the test
  // pins the explicit `asset_event_type` check.
  it("routed: ignores an sBTC FT event that is not a transfer", async () => {
    const mint = ftEvent(0, PAYER, RECIPIENT, INBOX_PRICE_SATS);
    mint.asset.asset_event_type = "mint";
    stubHiro(routedTx([mint]));
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "NOT_SBTC_TRANSFER" });
  });

  it("routed: returns NOT_SBTC_TRANSFER when the sender moved no sBTC", async () => {
    stubHiro(routedTx([ftEvent(0, WRAPPER, RECIPIENT, INBOX_PRICE_SATS)]));
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "NOT_SBTC_TRANSFER" });
  });

  it("routed: returns RECIPIENT_MISMATCH when the sBTC went to someone else", async () => {
    stubHiro(routedTx([ftEvent(0, PAYER, OTHER, INBOX_PRICE_SATS)]));
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "RECIPIENT_MISMATCH" });
  });

  it("routed: returns INSUFFICIENT_AMOUNT when the transfer to the recipient is below the price", async () => {
    stubHiro(
      routedTx([ftEvent(0, PAYER, WRAPPER, 1000), ftEvent(2, PAYER, RECIPIENT, INBOX_PRICE_SATS - 1)])
    );
    const r = await verifyTxidPayment(TXID, RECIPIENT);
    expect(r).toMatchObject({ success: false, errorCode: "INSUFFICIENT_AMOUNT" });
  });
});
