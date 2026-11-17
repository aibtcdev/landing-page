import { describe, expect, it, vi } from "vitest";
import {
  TX_EVENT_GAP_MAX_AGE_MS,
  TX_EVENT_GAP_MAX_HITS,
  boundTxEventsGap,
  loadTxEventsUntil,
  readFtTransfer,
  txEventsGapKey,
  type TxEventsLoad,
} from "../stacks-tx-events";
import { createMockKV, createThrowingKV } from "../inbox/__tests__/kv-mock";

const SBTC = "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token";
const A = "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR";
const B = "SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE";

const flat = (overrides: Record<string, unknown> = {}) => ({
  event_index: 3,
  event_type: "fungible_token_asset",
  asset_event_type: "transfer",
  asset_id: `${SBTC}::sbtc-token`,
  sender: A,
  recipient: B,
  amount: "100",
  ...overrides,
});

describe("readFtTransfer", () => {
  it("reads the flat shape", () => {
    expect(readFtTransfer(flat(), SBTC)).toEqual({ eventIndex: 3, sender: A, recipient: B, amount: 100 });
  });

  it("reads the nested shape", () => {
    const { event_index, event_type, ...asset } = flat();
    expect(readFtTransfer({ event_index, event_type, asset }, SBTC)).toEqual({
      eventIndex: 3,
      sender: A,
      recipient: B,
      amount: 100,
    });
  });

  it("skips a flat mint and a flat burn", () => {
    expect(readFtTransfer(flat({ asset_event_type: "mint", sender: undefined }), SBTC)).toBeNull();
    expect(readFtTransfer(flat({ asset_event_type: "burn", recipient: undefined }), SBTC)).toBeNull();
    // Even with both parties present, a mint is not a transfer.
    expect(readFtTransfer(flat({ asset_event_type: "mint" }), SBTC)).toBeNull();
  });

  it("anchors the asset id on `::`, so a sibling contract never matches", () => {
    expect(readFtTransfer(flat({ asset_id: `${SBTC}-extended::sbtc-token` }), SBTC)).toBeNull();
    expect(readFtTransfer(flat({ asset_id: SBTC }), SBTC)).toBeNull();
  });

  it("never assembles one transfer from nested and flat fields at once", () => {
    // `asset` lacks the recipient; the flat one must not fill it in.
    const mixed = {
      event_index: 1,
      event_type: "fungible_token_asset",
      recipient: B,
      asset: { asset_event_type: "transfer", asset_id: `${SBTC}::sbtc-token`, sender: A, amount: "100" },
    };
    expect(readFtTransfer(mixed, SBTC)).toBeNull();
    // And a flat `mint` type does not hide behind a nested transfer, or vice versa.
    const nestedWins = { ...mixed, asset: { ...mixed.asset, recipient: B }, asset_event_type: "mint" };
    expect(readFtTransfer(nestedWins, SBTC)).toEqual({ eventIndex: 1, sender: A, recipient: B, amount: 100 });
  });

  it("skips a non-FT event", () => {
    expect(readFtTransfer(flat({ event_type: "stx_asset" }), SBTC)).toBeNull();
  });
});

describe("loadTxEventsUntil gapOffset", () => {
  const tx = () => ({ event_count: 150, events: Array.from({ length: 100 }, (_, i) => i) });
  const never = () => false;

  it("marks an empty later page and a 404/403 later page as a gap at the missing offset", async () => {
    const empty = await loadTxEventsUntil(tx(), "u", async () => new Response(JSON.stringify({ events: [] })), never);
    expect(empty).toMatchObject({ state: "unreachable", gapOffset: 100 });
    for (const status of [404, 403, 408]) {
      const r = await loadTxEventsUntil(tx(), "u", async () => new Response("{}", { status }), never);
      expect(r).toMatchObject({ state: "unreachable", gapOffset: 100 });
    }
  });

  it("does not mark a 429, a 5xx or a network failure as a gap", async () => {
    for (const status of [429, 500, 503]) {
      const r = await loadTxEventsUntil(tx(), "u", async () => new Response("{}", { status }), never);
      expect(r.state).toBe("unreachable");
      expect(r).not.toHaveProperty("gapOffset");
    }
    const thrown = await loadTxEventsUntil(tx(), "u", async () => { throw new Error("net"); }, never);
    expect(thrown).toEqual({ state: "unreachable", pages: 0 });
  });
});

describe("boundTxEventsGap", () => {
  const TXID = "0xAB" + "cd".repeat(31);
  const gap: TxEventsLoad = { state: "unreachable", pages: 0, gapOffset: 100 };

  it("keeps a gap retryable until it has been hit TX_EVENT_GAP_MAX_HITS times", async () => {
    const kv = createMockKV();
    const t0 = 1_000_000;
    for (let i = 1; i < TX_EVENT_GAP_MAX_HITS; i++) {
      expect(await boundTxEventsGap(gap, TXID, kv, t0 + i)).toBe(gap);
    }
    expect(await boundTxEventsGap(gap, TXID, kv, t0 + TX_EVENT_GAP_MAX_HITS)).toEqual({
      state: "incomplete",
      pages: 0,
    });
  });

  it("makes a gap final once TX_EVENT_GAP_MAX_AGE_MS has passed since the first hit", async () => {
    const kv = createMockKV();
    const t0 = 1_000_000;
    expect(await boundTxEventsGap(gap, TXID, kv, t0)).toBe(gap);
    expect(await boundTxEventsGap(gap, TXID, kv, t0 + TX_EVENT_GAP_MAX_AGE_MS - 1)).toBe(gap);
    expect((await boundTxEventsGap(gap, TXID, kv, t0 + TX_EVENT_GAP_MAX_AGE_MS)).state).toBe("incomplete");
  });

  it("counts per txid and per offset, with or without 0x and in any case", async () => {
    const kv = createMockKV();
    await boundTxEventsGap(gap, TXID, kv, 1);
    expect(txEventsGapKey(TXID, 100)).toBe(txEventsGapKey(TXID.slice(2).toLowerCase(), 100));
    expect(JSON.parse((await kv.get(txEventsGapKey(TXID, 100))) as string)).toEqual({ firstAt: 1, hits: 1 });
    expect(await kv.get(txEventsGapKey(TXID, 200))).toBeNull();
  });

  it("leaves every other load alone and writes nothing", async () => {
    const kv = createMockKV();
    const put = vi.spyOn(kv, "put");
    const loads: TxEventsLoad[] = [
      { state: "unreachable", pages: 0 },
      { state: "found", pages: 1 },
      { state: "complete", pages: 1 },
      { state: "truncated", pages: 4 },
      { state: "incomplete", pages: 2 },
    ];
    for (const load of loads) expect(await boundTxEventsGap(load, TXID, kv)).toBe(load);
    expect(put).not.toHaveBeenCalled();
  });

  it("stays retryable without KV or when KV fails", async () => {
    expect(await boundTxEventsGap(gap, TXID, undefined)).toBe(gap);
    expect(await boundTxEventsGap(gap, TXID, createThrowingKV())).toBe(gap);
  });
});
