import { describe, it, expect, vi } from "vitest";
import {
  bufferCV,
  serializeCV,
  someCV,
  standardPrincipalCV,
  uintCV,
  type ClarityValue,
} from "@stacks/transactions";
import { buildExpectedMemo, verifyPayoutTxid, type PayoutRecipient } from "../txid-verify";
import { SBTC_CONTRACT_MAINNET } from "../constants";
import { TX_EVENT_MAX, TX_EVENT_PAGE_SIZE } from "@/lib/stacks-tx-events";
import type { BountyRecord, BountySubmission } from "../types";
import { createMockKV } from "@/lib/inbox/__tests__/kv-mock";

const BOUNTY_ID = "01HNX7TEST";
const POSTER_STX = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const SUBMITTER_STX = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";
const OTHER_STX = "SP229F3KDGJJ79DMAPHKYQD6KF6DXM2NPAKHZ51HR";

const argHex = (cv: ClarityValue) => `0x${serializeCV(cv)}`;

function makeBounty(overrides: Partial<BountyRecord> = {}): BountyRecord {
  return {
    id: BOUNTY_ID,
    posterBtcAddress: "bc1qposter",
    posterStxAddress: POSTER_STX,
    title: "t",
    description: "d",
    rewardSats: 5000,
    submissionCount: 1,
    createdAt: "2026-05-10T00:00:00Z",
    expiresAt: "2026-05-20T00:00:00Z",
    acceptedSubmissionId: "s1",
    acceptedAt: "2026-05-15T00:00:00Z",
    updatedAt: "2026-05-15T00:00:00Z",
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<BountySubmission> = {}): BountySubmission {
  return {
    id: "s1",
    bountyId: BOUNTY_ID,
    submitterBtcAddress: "bc1qsubmitter",
    submitterStxAddress: SUBMITTER_STX,
    message: "here is my work",
    createdAt: "2026-05-12T00:00:00Z",
    ...overrides,
  };
}

/** The winner as a payout recipient; a solo winner is owed the whole reward. */
function winnerRecipient(amountSats = 5000): PayoutRecipient {
  const s = makeSubmission();
  return { btcAddress: s.submitterBtcAddress, stxAddress: s.submitterStxAddress, amountSats };
}

function memoArg(bountyId: string = BOUNTY_ID) {
  const expected = buildExpectedMemo(bountyId);
  return {
    name: "memo",
    type: "(optional (buff 34))",
    hex: argHex(someCV(bufferCV(expected.bytes))),
    repr: `(some ${expected.hex})`,
  };
}

function makeHiroTx(overrides: Record<string, unknown> = {}) {
  return {
    tx_id: "0xabc123",
    tx_status: "success",
    tx_type: "contract_call",
    sender_address: POSTER_STX,
    is_unanchored: false,
    burn_block_time_iso: "2026-05-16T00:00:00Z",
    contract_call: {
      contract_id: SBTC_CONTRACT_MAINNET,
      function_name: "transfer",
      function_args: [
        {
          name: "amount",
          type: "uint",
          hex: argHex(uintCV(5000)),
          repr: "u5000",
        },
        {
          name: "sender",
          type: "principal",
          hex: argHex(standardPrincipalCV(POSTER_STX)),
          repr: `'${POSTER_STX}`,
        },
        {
          name: "recipient",
          type: "principal",
          hex: argHex(standardPrincipalCV(SUBMITTER_STX)),
          repr: `'${SUBMITTER_STX}`,
        },
        memoArg(),
      ],
    },
    events: [
      {
        event_type: "fungible_token_asset",
        asset: {
          asset_event_type: "transfer",
          asset_id: `${SBTC_CONTRACT_MAINNET}::sbtc-token`,
          sender: POSTER_STX,
          recipient: SUBMITTER_STX,
          amount: "5000",
        },
      },
    ],
    ...overrides,
  };
}

function mockFetch(response: { status?: number; json: () => unknown }): typeof fetch {
  return vi.fn(async () => ({
    status: response.status ?? 200,
    ok: (response.status ?? 200) < 400,
    json: async () => response.json(),
  })) as unknown as typeof fetch;
}

// A payout routed through a contract that forwards to `sbtc-token.transfer`.
// Event order modeled on a mainnet gasless transfer: fee to the wrapper, the
// wrapper's own print, the transfer to the winner, then the memo printed by
// `sbtc-token` right after it.
const WRAPPER = "SP229F3KDGJJ79DMAPHKYQD6KF6DXM2NPAKHZ51HR.gasless-transfer";

function ftEvent(event_index: number, sender: string, recipient: string, amount: number) {
  return {
    event_index,
    event_type: "fungible_token_asset",
    asset: {
      asset_event_type: "transfer",
      asset_id: `${SBTC_CONTRACT_MAINNET}::sbtc-token`,
      sender,
      recipient,
      amount: String(amount),
    },
  };
}

function memoPrint(event_index: number, contract_id: string, bountyId: string = BOUNTY_ID) {
  const expected = buildExpectedMemo(bountyId);
  return {
    event_index,
    event_type: "smart_contract_log",
    contract_log: {
      contract_id,
      topic: "print",
      value: { hex: argHex(bufferCV(expected.bytes)), repr: expected.hex },
    },
  };
}

function makeRoutedTx(events?: unknown[]) {
  return makeHiroTx({
    contract_call: {
      contract_id: WRAPPER,
      function_name: "transfer-stacks-to-stacks",
      function_args: [
        { name: "amount", type: "uint", hex: argHex(uintCV(5000)), repr: "u5000" },
        {
          name: "recipient",
          type: "principal",
          hex: argHex(standardPrincipalCV(SUBMITTER_STX)),
          repr: `'${SUBMITTER_STX}`,
        },
        memoArg(),
        { name: "fee", type: "uint", hex: argHex(uintCV(10)), repr: "u10" },
      ],
    },
    events: events ?? [
      ftEvent(0, POSTER_STX, WRAPPER, 10),
      memoPrint(1, WRAPPER, "fee-receipt"),
      ftEvent(2, POSTER_STX, SUBMITTER_STX, 5000),
      memoPrint(3, SBTC_CONTRACT_MAINNET),
      memoPrint(4, WRAPPER),
    ],
  });
}

async function verifyRouted(events?: unknown[], bounty: BountyRecord = makeBounty()) {
  return verifyPayoutTxid({
    txid: "0xabc",
    bounty,
    recipients: [winnerRecipient(bounty.rewardSats)],
    fetchFn: mockFetch({ json: () => makeRoutedTx(events) }),
  });
}

// Hiro pages the events: the first response carries `firstPage` of them and
// `event_count` the total, and `event_offset` asks for the rest. Like Hiro, it
// refuses an `event_limit` above 100. `pageSize` shrinks the later pages;
// `cancel` records a non-ok page body being cancelled.
function pagedFetch(
  tx: { events: unknown[] },
  firstPage: number,
  laterPage?: "fail" | "empty" | "rate-limited",
  opts: { pageSize?: number; cancel?: ReturnType<typeof vi.fn> } = {}
) {
  return vi.fn(async (url: string) => {
    const params = new URL(url).searchParams;
    const offset = Number(params.get("event_offset") ?? 0);
    if (!(Number(params.get("event_limit")) <= 100)) {
      return { status: 400, ok: false, json: async () => ({}) };
    }
    if (offset > 0 && (laterPage === "fail" || laterPage === "rate-limited")) {
      const limited = laterPage === "rate-limited";
      return {
        status: limited ? 429 : 503,
        ok: false,
        headers: new Headers(limited ? { "Retry-After": "7" } : {}),
        body: { cancel: opts.cancel ?? (async () => {}) },
        json: async () => ({}),
      };
    }
    const events =
      offset > 0 && laterPage === "empty"
        ? []
        : tx.events.slice(offset, offset + (offset === 0 ? firstPage : (opts.pageSize ?? TX_EVENT_PAGE_SIZE)));
    return {
      status: 200,
      ok: true,
      json: async () => ({ ...tx, event_count: tx.events.length, events }),
    };
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

async function verifyPaged(firstPage: number, laterPage?: "fail" | "empty" | "rate-limited") {
  const fetchFn = pagedFetch(makeRoutedTx() as { events: unknown[] }, firstPage, laterPage);
  const r = await verifyPayoutTxid({
    txid: "0xabc",
    bounty: makeBounty(),
    recipients: [winnerRecipient()],
    fetchFn,
  });
  return { r, fetchFn };
}

// Events that matter to no check, so a long transaction can bury the payout.
function noise(index: number) {
  return {
    event_index: index,
    event_type: "smart_contract_log",
    contract_log: { contract_id: "SP000.noise", topic: "print", value: { hex: "0x00" } },
  };
}

// A `count`-event transaction of noise with `placed` events at their indexes.
function longTx(
  count: number,
  placed: Record<number, unknown>,
  make: (events: unknown[]) => { events: unknown[] } = (events) => makeHiroTx({ events })
) {
  const events = Array.from({ length: count }, (_, i) => placed[i] ?? noise(i));
  return make(events);
}

const longRouted = (count: number, placed: Record<number, unknown>) =>
  longTx(count, placed, (events) => makeRoutedTx(events) as { events: unknown[] });

async function verifyLong(
  tx: { events: unknown[] },
  overrides: Partial<Parameters<typeof verifyPayoutTxid>[0]> = {},
  laterPage?: "fail" | "empty" | "rate-limited"
) {
  const fetchFn = pagedFetch(tx, TX_EVENT_PAGE_SIZE, laterPage);
  const r = await verifyPayoutTxid({
    txid: "0xabc",
    bounty: makeBounty(),
    recipients: [winnerRecipient()],
    fetchFn,
    ...overrides,
  });
  return { r, fetchFn };
}

describe("buildExpectedMemo", () => {
  it("encodes BNTY: + bountyId as ASCII bytes with 0x hex form", () => {
    const memo = buildExpectedMemo("01HNX7");
    expect(memo.ascii).toBe("BNTY:01HNX7");
    expect(memo.hex).toMatch(/^0x[0-9a-f]+$/);
    expect(memo.bytes).toBeInstanceOf(Uint8Array);
    expect(memo.bytes.length).toBe(11);
  });

  it("fits in 34 bytes for a 26-char ulid", () => {
    const memo = buildExpectedMemo("01HNX7ABCDEFGHJKMNPQRSTVWX");
    expect(memo.bytes.length).toBeLessThanOrEqual(34);
  });
});

describe("verifyPayoutTxid", () => {
  it("returns ok with canonicalTxid for a valid sBTC transfer", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc123",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({ json: () => makeHiroTx() }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.canonicalTxid).toBe("0xabc123");
      expect(r.blockTimeIso).toBe("2026-05-16T00:00:00Z");
    }
  });

  it("returns TX_NOT_FOUND on Hiro 404", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xdead",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({ status: 404, json: () => ({}) }),
    });
    expect(r).toEqual({
      ok: false,
      code: "TX_NOT_FOUND",
      message: expect.stringContaining("not found"),
    });
  });

  it("returns TX_NOT_CONFIRMED when is_unanchored is true", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({ json: () => makeHiroTx({ is_unanchored: true }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_NOT_CONFIRMED");
  });

  it("returns TX_NOT_CONFIRMED when status is pending", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({ json: () => makeHiroTx({ tx_status: "pending" }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_NOT_CONFIRMED");
  });

  it("returns TX_FAILED on aborted transactions", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({ json: () => makeHiroTx({ tx_status: "abort_by_post_condition" }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_FAILED");
  });

  it("returns WRONG_CONTRACT on a non-sBTC contract that moves no sBTC", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () =>
          makeHiroTx({
            contract_call: { contract_id: "SP000.other", function_name: "transfer", function_args: [] },
            events: [],
          }),
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_CONTRACT");
  });

  it("returns MEMO_MISMATCH on a non-sBTC contract whose sBTC transfer carries no memo", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () =>
          makeHiroTx({
            contract_call: { contract_id: "SP000.other", function_name: "transfer", function_args: [] },
          }),
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MEMO_MISMATCH");
  });

  it("returns ok for a payout routed through a contract that forwards to sbtc-token.transfer", async () => {
    const r = await verifyRouted();
    expect(r).toMatchObject({ ok: true, canonicalTxid: "0xabc123" });
  });

  it("routed: returns MEMO_MISMATCH when only the wrapper prints the bounty memo", async () => {
    const r = await verifyRouted([
      ftEvent(0, POSTER_STX, SUBMITTER_STX, 5000),
      memoPrint(1, SBTC_CONTRACT_MAINNET, "something-else"),
      memoPrint(2, WRAPPER),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MEMO_MISMATCH");
  });

  it("routed: returns MEMO_MISMATCH when the sbtc-token memo belongs to another transfer", async () => {
    const r = await verifyRouted([
      ftEvent(0, POSTER_STX, SUBMITTER_STX, 5000),
      ftEvent(1, POSTER_STX, OTHER_STX, 1),
      memoPrint(2, SBTC_CONTRACT_MAINNET),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MEMO_MISMATCH");
  });

  it("routed: returns WRONG_RECIPIENT when the wrapper pays from its own balance", async () => {
    const r = await verifyRouted([
      ftEvent(0, WRAPPER, SUBMITTER_STX, 5000),
      memoPrint(1, SBTC_CONTRACT_MAINNET),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_RECIPIENT");
  });

  it("routed: returns AMOUNT_TOO_LOW when the transfer to the winner is below the reward", async () => {
    const r = await verifyRouted(undefined, makeBounty({ rewardSats: 10000 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AMOUNT_TOO_LOW");
  });

  it("routed: reads the events past the first page to find the payout", async () => {
    const { r } = await verifyPaged(2);
    expect(r).toMatchObject({ ok: true, canonicalTxid: "0xabc123" });
  });

  it("routed: reads the memo print when it starts the next page", async () => {
    const { r } = await verifyPaged(3);
    expect(r).toMatchObject({ ok: true, canonicalTxid: "0xabc123" });
  });

  it("returns HIRO_UNREACHABLE when a later page of events fails", async () => {
    const { r } = await verifyPaged(2, "fail");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("HIRO_UNREACHABLE");
  });

  it("accepts a payout at the start of a 600-event tx without reading another page", async () => {
    const { r, fetchFn } = await verifyLong(
      longTx(600, { 3: ftEvent(3, POSTER_STX, SUBMITTER_STX, 5000) })
    );
    expect(r).toMatchObject({ ok: true, canonicalTxid: "0xabc123" });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("accepts a routed payout at the start of a 600-event tx without reading another page", async () => {
    const { r, fetchFn } = await verifyLong(
      longRouted(600, {
        3: ftEvent(3, POSTER_STX, SUBMITTER_STX, 5000),
        4: memoPrint(4, SBTC_CONTRACT_MAINNET),
      })
    );
    expect(r).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("accepts a payout on the first page when a later page would fail or be rate-limited", async () => {
    const tx = longTx(150, { 3: ftEvent(3, POSTER_STX, SUBMITTER_STX, 5000) });
    for (const mode of ["fail", "rate-limited"] as const) {
      const { r, fetchFn } = await verifyLong(tx, {}, mode);
      expect(r).toMatchObject({ ok: true });
      expect(fetchFn).toHaveBeenCalledTimes(1);
    }
  });

  it("does not refuse a small transfer to the winner on page 1 while the payout is on page 2", async () => {
    const { r, fetchFn } = await verifyLong(
      longTx(150, {
        0: ftEvent(0, POSTER_STX, SUBMITTER_STX, 1),
        120: ftEvent(120, POSTER_STX, SUBMITTER_STX, 5000),
      })
    );
    expect(r).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("routed: loads the next page when the payout ends page 1 and its memo starts page 2", async () => {
    const { r, fetchFn } = await verifyLong(
      longRouted(150, {
        99: ftEvent(99, POSTER_STX, SUBMITTER_STX, 5000),
        100: memoPrint(100, SBTC_CONTRACT_MAINNET),
      })
    );
    expect(r).toMatchObject({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("returns EVENTS_TRUNCATED after the first 500 events hold no payout", async () => {
    const { r, fetchFn } = await verifyLong(
      longTx(600, { 550: ftEvent(550, POSTER_STX, SUBMITTER_STX, 5000) })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EVENTS_TRUNCATED");
    expect(fetchFn).toHaveBeenCalledTimes(1 + 4);
  });

  it("EVENTS_TRUNCATED tells the poster not to pay again", async () => {
    const { r } = await verifyLong(longTx(600, {}));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain("Do not pay the winner again");
      expect(r.message).not.toMatch(/of its own/);
    }
  });

  it("maps a Hiro 400 on the txid to a final TX_NOT_FOUND, and a 5xx to HIRO_UNREACHABLE", async () => {
    for (const [status, code] of [
      [400, "TX_NOT_FOUND"],
      [503, "HIRO_UNREACHABLE"],
    ] as const) {
      const fetchFn = vi.fn(async () => ({ status, ok: false, json: async () => ({}) }));
      const r = await verifyPayoutTxid({
        txid: "not-hex",
        bounty: makeBounty(),
        recipients: [winnerRecipient()],
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(code);
    }
  });

  it("accepts an FT event in the alternative shape that carries no asset_event_type", async () => {
    const legacy = {
      event_index: 0,
      event_type: "fungible_token_asset",
      asset_id: `${SBTC_CONTRACT_MAINNET}::sbtc-token`,
      sender: POSTER_STX,
      recipient: SUBMITTER_STX,
      amount: "5000",
    };
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: (async () => ({
        status: 200,
        ok: true,
        json: async () => makeHiroTx({ events: [legacy] }),
      })) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: true });
  });

  it("returns RATE_LIMITED with Retry-After when a later page is rate-limited before any payout", async () => {
    const cancel = vi.fn(async () => {});
    const fetchFn = pagedFetch(longTx(150, {}), TX_EVENT_PAGE_SIZE, "rate-limited", { cancel });
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn,
    });
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterSeconds: 7 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("returns RATE_LIMITED with a 30 second default when the first fetch is rate-limited", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: vi.fn(async () => new Response("{}", { status: 429 })) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterSeconds: 30 });
  });

  it("stops at the page request cap when Hiro serves one event per page", async () => {
    const fetchFn = pagedFetch(longTx(600, {}), 1, undefined, { pageSize: 1 });
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("EVENTS_TRUNCATED");
    expect(fetchFn).toHaveBeenCalledTimes(1 + Math.ceil(TX_EVENT_MAX / TX_EVENT_PAGE_SIZE));
  });

  it("returns WRONG_SENDER from a 450-event tx without reading another page", async () => {
    const { r, fetchFn } = await verifyLong(
      makeHiroTx({ sender_address: OTHER_STX, events: longTx(450, {}).events }) as { events: unknown[] }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_SENDER");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns WRONG_RECIPIENT from the transfer args of a 450-event tx without reading another page", async () => {
    const tx = makeHiroTx({ events: longTx(450, {}).events });
    tx.contract_call.function_args[2] = {
      name: "recipient",
      type: "principal",
      hex: argHex(standardPrincipalCV(OTHER_STX)),
      repr: `'${OTHER_STX}`,
    };
    const { r, fetchFn } = await verifyLong(tx as { events: unknown[] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_RECIPIENT");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns TX_TOO_OLD from a 450-event tx without reading another page", async () => {
    const { r, fetchFn } = await verifyLong(
      makeHiroTx({
        burn_block_time_iso: "2026-05-10T00:00:00Z",
        events: longTx(450, {}).events,
      }) as { events: unknown[] },
      { bounty: makeBounty({ acceptedAt: "2026-05-20T00:00:00Z" }) }
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_TOO_OLD");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("returns MEMO_MISMATCH from the transfer args of a 450-event direct tx without reading another page", async () => {
    const tx = makeHiroTx({ events: longTx(450, {}).events });
    tx.contract_call.function_args[3] = memoArg("DIFFERENT_BOUNTY");
    const { r, fetchFn } = await verifyLong(tx as { events: unknown[] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MEMO_MISMATCH");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  // Hiro gives a mint no sender, so this event shape does not occur; the test
  // pins the explicit `asset_event_type` check.
  it("routed: ignores an sBTC FT event that is not a transfer", async () => {
    const mint = ftEvent(0, POSTER_STX, SUBMITTER_STX, 5000);
    mint.asset.asset_event_type = "mint";
    const r = await verifyRouted([mint, memoPrint(1, SBTC_CONTRACT_MAINNET)]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_CONTRACT");
  });

  it("returns WRONG_FUNCTION when function_name is not 'transfer'", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () => {
          const tx = makeHiroTx();
          tx.contract_call.function_name = "mint";
          return tx;
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_FUNCTION");
  });

  it("returns WRONG_SENDER when sender_address doesn't match poster", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({ json: () => makeHiroTx({ sender_address: OTHER_STX }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_SENDER");
  });

  it("returns WRONG_RECIPIENT when recipient principal doesn't match winner", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () => {
          const tx = makeHiroTx();
          // Mutate recipient
          tx.contract_call.function_args[2] = {
            name: "recipient",
            type: "principal",
            hex: argHex(standardPrincipalCV(OTHER_STX)),
            repr: `'${OTHER_STX}`,
          };
          return tx;
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_RECIPIENT");
  });

  it("returns AMOUNT_TOO_LOW when amount < rewardSats", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty({ rewardSats: 10000 }),
      recipients: [winnerRecipient(10000)],
      fetchFn: mockFetch({ json: () => makeHiroTx() }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AMOUNT_TOO_LOW");
  });

  it("returns MEMO_MISMATCH when memo doesn't bind to this bountyId", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () => {
          const tx = makeHiroTx();
          tx.contract_call.function_args[3] = memoArg("DIFFERENT_BOUNTY");
          return tx;
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MEMO_MISMATCH");
  });

  it("returns MEMO_MISMATCH when wallet zero-pads the memo to the (buff 34) max", async () => {
    // Some wallets fill (buff 34) up to its max length with trailing zeros
    // instead of sending the exact 31 bytes. The verifier must reject this
    // so the byte-exact memo contract stays crisp.
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () => {
          const tx = makeHiroTx();
          const expected = buildExpectedMemo(BOUNTY_ID);
          const padded = new Uint8Array(34);
          padded.set(expected.bytes, 0);
          tx.contract_call.function_args[3] = {
            name: "memo",
            type: "(optional (buff 34))",
            hex: argHex(someCV(bufferCV(padded))),
            repr: "(some padded)",
          };
          return tx;
        },
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MEMO_MISMATCH");
  });

  it("returns TX_TOO_OLD when tx happened before acceptance", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty({ acceptedAt: "2026-05-20T00:00:00Z" }),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () => makeHiroTx({ burn_block_time_iso: "2026-05-10T00:00:00Z" }),
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_TOO_OLD");
  });

  it("prefers Stacks block_time_iso over older burn_block_time_iso", async () => {
    // Real-world scenario: a Stacks tx broadcast after the bounty was
    // accepted lands in a Stacks block whose burn anchor (Bitcoin block)
    // started ~10 min earlier. Using burn_block_time falsely rejects
    // legitimate payouts. The verifier must prefer block_time_iso (the
    // Stacks block time — when the tx actually landed).
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty({ acceptedAt: "2026-05-16T13:01:58Z" }),
      recipients: [winnerRecipient()],
      fetchFn: mockFetch({
        json: () =>
          makeHiroTx({
            burn_block_time_iso: "2026-05-16T12:56:29Z", // 5 min before accept
            block_time_iso: "2026-05-16T13:05:16Z", // 3 min after accept
          }),
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.blockTimeIso).toBe("2026-05-16T13:05:16Z");
  });

  it("returns HIRO_UNREACHABLE on fetch throw", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: (() => {
        throw new Error("network");
      }) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("HIRO_UNREACHABLE");
  });
});

describe("verifyPayoutTxid: which Hiro answers are final (#1146)", () => {
  const laterPageStatus = (status: number) =>
    vi.fn(async (url: string) => {
      const offset = Number(new URL(url).searchParams.get("event_offset") ?? 0);
      if (offset > 0) {
        return { status, ok: false, headers: new Headers(), body: { cancel: async () => {} }, json: async () => ({}) };
      }
      const tx = longTx(150, {});
      return { status: 200, ok: true, json: async () => ({ ...tx, event_count: 150, events: tx.events.slice(0, 100) }) };
    }) as unknown as typeof fetch;

  it("keeps a later page that is empty retryable (HIRO_UNREACHABLE)", async () => {
    const { r } = await verifyPaged(2, "empty");
    expect(r).toMatchObject({ ok: false, code: "HIRO_UNREACHABLE" });
  });

  it.each([401, 403, 404, 408])("keeps a later page %i retryable (HIRO_UNREACHABLE)", async (status) => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: laterPageStatus(status),
    });
    expect(r).toMatchObject({ ok: false, code: "HIRO_UNREACHABLE" });
  });

  it.each([400, 422])("treats a later page %i as final (EVENTS_TRUNCATED)", async (status) => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: laterPageStatus(status),
    });
    expect(r).toMatchObject({ ok: false, code: "EVENTS_TRUNCATED" });
  });

  it.each([401, 403, 408])("maps a %i on the txid to HIRO_UNREACHABLE, not TX_NOT_FOUND", async (status) => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: vi.fn(async () => ({ status, ok: false, json: async () => ({}) })) as unknown as typeof fetch,
    });
    expect(r).toMatchObject({ ok: false, code: "HIRO_UNREACHABLE" });
  });

  it("sends the Hiro API key on every request", async () => {
    const fetchFn = pagedFetch(makeRoutedTx() as { events: unknown[] }, 2);
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn,
      hiroApiKey: "test-key",
    });
    expect(r).toMatchObject({ ok: true });
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
    for (const [, init] of fetchFn.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get("x-api-key")).toBe("test-key");
    }
  });
});

describe("verifyPayoutTxid: a gap that never heals still ends (#1146 follow-up)", () => {
  const verifyAt = (laterPage: "empty" | "fail", kv: KVNamespace, at: string) =>
    verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [winnerRecipient()],
      fetchFn: pagedFetch(longTx(150, {}), TX_EVENT_PAGE_SIZE, laterPage),
      kv,
      now: new Date(at),
    });

  it("keeps an empty later page retryable for 15 minutes, then returns EVENTS_TRUNCATED", async () => {
    const kv = createMockKV();
    expect(await verifyAt("empty", kv, "2026-05-16T00:00:00Z")).toMatchObject({ code: "HIRO_UNREACHABLE" });
    expect(await verifyAt("empty", kv, "2026-05-16T00:14:30Z")).toMatchObject({ code: "HIRO_UNREACHABLE" });
    const r = await verifyAt("empty", kv, "2026-05-16T00:15:00Z");
    expect(r).toMatchObject({ code: "EVENTS_TRUNCATED" });
    if (!r.ok) expect(r.message).toMatch(/Do not pay the winner again/);
  });

  it("never turns a later-page 5xx final", async () => {
    const kv = createMockKV();
    expect(await verifyAt("fail", kv, "2026-05-16T00:00:00Z")).toMatchObject({ code: "HIRO_UNREACHABLE" });
    expect(await verifyAt("fail", kv, "2026-05-17T00:00:00Z")).toMatchObject({ code: "HIRO_UNREACHABLE" });
  });
});

// ---------------------------------------------------------------------------
// Team payouts: every member is paid directly and checked on its own.
// ---------------------------------------------------------------------------

describe("verifyPayoutTxid team payouts", () => {
  // 5000 sats split across lead (SUBMITTER_STX) + partner (OTHER_STX).
  const lead: PayoutRecipient = { btcAddress: "bc1qlead", stxAddress: SUBMITTER_STX, amountSats: 2500 };
  const partner: PayoutRecipient = { btcAddress: "bc1qpartner", stxAddress: OTHER_STX, amountSats: 2500 };

  function verifyTeam(events: unknown[], recipients: PayoutRecipient[] = [lead, partner]) {
    return verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients,
      fetchFn: mockFetch({ json: () => makeRoutedTx(events) }),
    });
  }

  it("one batch tx pays both members, each with its own bound memo", async () => {
    const r = await verifyTeam([
      ftEvent(0, POSTER_STX, SUBMITTER_STX, 2500),
      memoPrint(1, SBTC_CONTRACT_MAINNET),
      ftEvent(2, POSTER_STX, OTHER_STX, 2500),
      memoPrint(3, SBTC_CONTRACT_MAINNET),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matched.map((m) => [m.btcAddress, m.eventIndex])).toEqual([
        ["bc1qlead", 0],
        ["bc1qpartner", 2],
      ]);
      expect(r.underpaid).toEqual([]);
    }
  });

  it("paying the lead the whole reward pays only the lead, never the partner", async () => {
    const r = await verifyTeam([
      ftEvent(0, POSTER_STX, SUBMITTER_STX, 5000),
      memoPrint(1, SBTC_CONTRACT_MAINNET),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matched.map((m) => m.btcAddress)).toEqual(["bc1qlead"]);
  });

  it("records the member paid in full and reports the one underpaid", async () => {
    const r = await verifyTeam([
      ftEvent(0, POSTER_STX, SUBMITTER_STX, 2500),
      memoPrint(1, SBTC_CONTRACT_MAINNET),
      ftEvent(2, POSTER_STX, OTHER_STX, 1000),
      memoPrint(3, SBTC_CONTRACT_MAINNET),
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matched.map((m) => m.btcAddress)).toEqual(["bc1qlead"]);
      expect(r.underpaid).toEqual([{ btcAddress: "bc1qpartner", amount: 1000, required: 2500 }]);
    }
  });

  it("does not count a member transfer whose memo is not bound to it", async () => {
    const r = await verifyTeam(
      [ftEvent(0, POSTER_STX, OTHER_STX, 2500), memoPrint(1, WRAPPER)],
      [partner]
    );
    expect(r).toMatchObject({ ok: false, code: "MEMO_MISMATCH" });
  });

  it("refuses AMOUNT_TOO_LOW when the only member transfer is short of their share", async () => {
    const r = await verifyTeam(
      [ftEvent(0, POSTER_STX, OTHER_STX, 1000), memoPrint(1, SBTC_CONTRACT_MAINNET)],
      [partner]
    );
    expect(r).toMatchObject({ ok: false, code: "AMOUNT_TOO_LOW" });
  });

  it("refuses a transfer to an address that is not an unpaid member", async () => {
    // Lead already paid, so only the partner is still owed.
    const r = await verifyTeam(
      [ftEvent(0, POSTER_STX, SUBMITTER_STX, 2500), memoPrint(1, SBTC_CONTRACT_MAINNET)],
      [partner]
    );
    expect(r).toMatchObject({ ok: false, code: "WRONG_RECIPIENT" });
  });

  it("refuses a team payment sent by someone other than the poster", async () => {
    const r = await verifyTeam([
      ftEvent(0, OTHER_STX, SUBMITTER_STX, 2500),
      memoPrint(1, SBTC_CONTRACT_MAINNET),
    ]);
    expect(r).toMatchObject({ ok: false, code: "WRONG_RECIPIENT" });
  });

  it("a direct transfer pays exactly the member it names, checked against that member's share", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [lead, partner],
      fetchFn: mockFetch({
        json: () =>
          makeHiroTx({
            events: [{ ...ftEvent(0, POSTER_STX, SUBMITTER_STX, 2500) }],
          }),
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matched.map((m) => m.btcAddress)).toEqual(["bc1qlead"]);
  });
});

describe("verifyPayoutTxid underpaid only counts this bounty's transfers", () => {
  it("a smaller transfer to a member for ANOTHER bounty is not reported as underpaid here", async () => {
    const partner: PayoutRecipient = { btcAddress: "bc1qpartner", stxAddress: OTHER_STX, amountSats: 2500 };
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [partner],
      fetchFn: mockFetch({
        json: () =>
          makeRoutedTx([
            ftEvent(0, POSTER_STX, OTHER_STX, 1000),
            memoPrint(1, SBTC_CONTRACT_MAINNET, "01HNX7OTHER"),
          ]),
      }),
    });
    // Not AMOUNT_TOO_LOW: the only transfer to the partner is bound to another bounty.
    expect(r).toMatchObject({ ok: false, code: "MEMO_MISMATCH" });
  });
});

describe("verifyPayoutTxid records proven team payouts when a later page fails", () => {
  const lead: PayoutRecipient = { btcAddress: "bc1qlead", stxAddress: SUBMITTER_STX, amountSats: 2500 };
  const partner: PayoutRecipient = { btcAddress: "bc1qpartner", stxAddress: OTHER_STX, amountSats: 2500 };
  // The lead's payout is on page 0; the tx says it has 150 events, so the
  // verifier keeps paging for the partner, and page 1 keeps failing.
  const filler = Array.from({ length: 146 }, (_, i) => ({
    event_index: i + 4,
    event_type: "smart_contract_log",
    contract_log: { contract_id: WRAPPER, topic: "print", value: { hex: "0x00" } },
  }));
  const tx = makeRoutedTx([
    ftEvent(0, POSTER_STX, SUBMITTER_STX, 2500),
    memoPrint(1, SBTC_CONTRACT_MAINNET),
    ftEvent(2, POSTER_STX, WRAPPER, 10),
    memoPrint(3, WRAPPER, "fee"),
    ...filler,
  ]) as { events: unknown[] };

  it("returns the payout proven on the loaded page instead of HIRO_UNREACHABLE", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [lead, partner],
      fetchFn: pagedFetch(tx, 100, "fail"),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.matched.map((m) => m.btcAddress)).toEqual(["bc1qlead"]);
  });

  it("stays retryable when nothing is proven yet", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [partner],
      fetchFn: pagedFetch(tx, 100, "fail"),
    });
    expect(r).toMatchObject({ ok: false, code: "HIRO_UNREACHABLE" });
  });

  it("flags the proven result as incomplete, so the partner is not reported as unpaid (#1157)", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [lead, partner],
      fetchFn: pagedFetch(tx, 100, "fail"),
    });
    expect(r).toMatchObject({ ok: true, eventsIncomplete: true });
  });

  it("does not flag a result whose events were read in full", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [lead, partner],
      fetchFn: pagedFetch(tx, 100),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.eventsIncomplete).toBeUndefined();
  });

  it("AMOUNT_TOO_LOW tells the poster not to send a top-up", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      recipients: [partner],
      fetchFn: mockFetch({ json: () => makeRoutedTx([ftEvent(0, POSTER_STX, OTHER_STX, 900), memoPrint(1, SBTC_CONTRACT_MAINNET)]) }),
    });
    expect(r).toMatchObject({ ok: false, code: "AMOUNT_TOO_LOW" });
    if (!r.ok) expect(r.message).toMatch(/do not send a top-up/);
  });
});
