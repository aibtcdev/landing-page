import { describe, it, expect, vi } from "vitest";
import {
  bufferCV,
  serializeCV,
  someCV,
  standardPrincipalCV,
  uintCV,
  type ClarityValue,
} from "@stacks/transactions";
import { buildExpectedMemo, verifyPayoutTxid } from "../txid-verify";
import { SBTC_CONTRACT_MAINNET } from "../constants";
import type { BountyRecord, BountySubmission } from "../types";

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
      acceptedSubmission: makeSubmission(),
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
      acceptedSubmission: makeSubmission(),
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
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({ json: () => makeHiroTx({ is_unanchored: true }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_NOT_CONFIRMED");
  });

  it("returns TX_NOT_CONFIRMED when status is pending", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({ json: () => makeHiroTx({ tx_status: "pending" }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_NOT_CONFIRMED");
  });

  it("returns TX_FAILED on aborted transactions", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({ json: () => makeHiroTx({ tx_status: "abort_by_post_condition" }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_FAILED");
  });

  it("returns WRONG_CONTRACT on a non-sBTC contract", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({
        json: () =>
          makeHiroTx({
            contract_call: { contract_id: "SP000.other", function_name: "transfer", function_args: [] },
          }),
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_CONTRACT");
  });

  it("returns WRONG_FUNCTION when function_name is not 'transfer'", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
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
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({ json: () => makeHiroTx({ sender_address: OTHER_STX }) }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("WRONG_SENDER");
  });

  it("returns WRONG_RECIPIENT when recipient principal doesn't match winner", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
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
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({ json: () => makeHiroTx() }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AMOUNT_TOO_LOW");
  });

  it("returns MEMO_MISMATCH when memo doesn't bind to this bountyId", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
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
      acceptedSubmission: makeSubmission(),
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
      acceptedSubmission: makeSubmission(),
      fetchFn: mockFetch({
        json: () => makeHiroTx({ burn_block_time_iso: "2026-05-10T00:00:00Z" }),
      }),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("TX_TOO_OLD");
  });

  it("returns HIRO_UNREACHABLE on fetch throw", async () => {
    const r = await verifyPayoutTxid({
      txid: "0xabc",
      bounty: makeBounty(),
      acceptedSubmission: makeSubmission(),
      fetchFn: (() => {
        throw new Error("network");
      }) as unknown as typeof fetch,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("HIRO_UNREACHABLE");
  });
});
