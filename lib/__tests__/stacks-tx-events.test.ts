import { describe, expect, it, vi } from "vitest";
import {
  TX_EVENT_GAP_MAX_AGE_MS,
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

  it("marks only an empty or a 404 later page as a gap at the missing offset", async () => {
    const empty = await loadTxEventsUntil(tx(), "u", async () => new Response(JSON.stringify({ events: [] })), never);
    expect(empty).toMatchObject({ state: "unreachable", gapOffset: 100 });
    const notFound = await loadTxEventsUntil(tx(), "u", async () => new Response("{}", { status: 404 }), never);
    expect(notFound).toMatchObject({ state: "unreachable", gapOffset: 100 });
  });

  it("treats a later-page 400 as final, the same as page 0", async () => {
    const r = await loadTxEventsUntil(tx(), "u", async () => new Response("{}", { status: 400 }), never);
    expect(r).toEqual({ state: "incomplete", pages: 0 });
  });

  it("does not mark 401/403/408/422, a 429, a 5xx or a network failure as a gap", async () => {
    for (const status of [401, 403, 408, 422, 429, 500, 503]) {
      const r = await loadTxEventsUntil(tx(), "u", async () => new Response("{}", { status }), never);
      expect(r.state).toBe("unreachable");
      expect(r).not.toHaveProperty("gapOffset");
    }
    const thrown = await loadTxEventsUntil(tx(), "u", async () => { throw new Error("net"); }, never);
    expect(thrown).toEqual({ state: "unreachable", pages: 0 });
  });

  it("reports the offsets of the later pages it loaded", async () => {
    const big = { event_count: 320, events: Array.from({ length: 100 }, (_, i) => i) };
    const fetchPage = async (url: string) => {
      const offset = Number(new URL(url, "https://h").searchParams.get("event_offset"));
      const n = Math.min(100, 320 - offset);
      return new Response(JSON.stringify({ events: Array.from({ length: n }, (_, i) => offset + i) }));
    };
    expect(await loadTxEventsUntil(big, "https://h/tx", fetchPage, never)).toEqual({
      state: "complete",
      pages: 3,
      loadedOffsets: [100, 200, 300],
    });
  });
});

describe("boundTxEventsGap", () => {
  const TXID = "0xAB" + "cd".repeat(31);
  const gap: TxEventsLoad = { state: "unreachable", pages: 0, gapOffset: 100 };

  // Review of #1147: retry speed and other submitters must not end the window early.
  it("keeps a gap retryable however often it is hit inside TX_EVENT_GAP_MAX_AGE_MS", async () => {
    const kv = createMockKV();
    const t0 = 1_000_000;
    for (let i = 0; i < 50; i++) {
      expect(await boundTxEventsGap(gap, TXID, kv, t0 + i)).toBe(gap);
    }
    expect(await boundTxEventsGap(gap, TXID, kv, t0 + TX_EVENT_GAP_MAX_AGE_MS - 1)).toBe(gap);
    expect(await boundTxEventsGap(gap, TXID, kv, t0 + TX_EVENT_GAP_MAX_AGE_MS)).toEqual({
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

  it("records the first hit once, per txid and per offset, with or without 0x and in any case", async () => {
    const kv = createMockKV();
    const put = vi.spyOn(kv, "put");
    await boundTxEventsGap(gap, TXID, kv, 1);
    await boundTxEventsGap(gap, TXID, kv, 2);
    expect(put).toHaveBeenCalledTimes(1);
    expect(txEventsGapKey(TXID, 100)).toBe(txEventsGapKey(TXID.slice(2).toLowerCase(), 100));
    expect(JSON.parse((await kv.get(txEventsGapKey(TXID, 100))) as string)).toEqual({ firstAt: 1 });
    expect(await kv.get(txEventsGapKey(TXID, 200))).toBeNull();
  });

  it("clears the record of a gap once a load reads a page at that offset", async () => {
    const kv = createMockKV();
    const t0 = 1_000_000;
    await boundTxEventsGap(gap, TXID, kv, t0);
    const healed: TxEventsLoad = { state: "found", pages: 1, loadedOffsets: [100] };
    expect(await boundTxEventsGap(healed, TXID, kv, t0 + 1000)).toBe(healed);
    expect(await kv.get(txEventsGapKey(TXID, 100))).toBeNull();
    // A new lag at the same offset later on starts a fresh window instead of being final.
    const later = t0 + 2 * TX_EVENT_GAP_MAX_AGE_MS;
    expect(await boundTxEventsGap(gap, TXID, kv, later)).toBe(gap);
    // A gap further on keeps the offsets read before it, and clears them too.
    await boundTxEventsGap({ state: "unreachable", pages: 0, gapOffset: 200 }, TXID, kv, later);
    const moved: TxEventsLoad = { state: "unreachable", pages: 1, loadedOffsets: [100], gapOffset: 200 };
    expect(await boundTxEventsGap(moved, TXID, kv, later + TX_EVENT_GAP_MAX_AGE_MS)).toEqual({
      state: "incomplete",
      pages: 1,
      loadedOffsets: [100],
    });
    expect(await kv.get(txEventsGapKey(TXID, 100))).toBeNull();
  });

  it("leaves every other load alone and writes nothing", async () => {
    const kv = createMockKV();
    const put = vi.spyOn(kv, "put");
    const del = vi.spyOn(kv, "delete");
    const loads: TxEventsLoad[] = [
      { state: "unreachable", pages: 0 },
      { state: "found", pages: 1 },
      { state: "complete", pages: 1 },
      { state: "truncated", pages: 4 },
      { state: "incomplete", pages: 2 },
    ];
    for (const load of loads) expect(await boundTxEventsGap(load, TXID, kv)).toBe(load);
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it("stays retryable without KV or when KV fails", async () => {
    expect(await boundTxEventsGap(gap, TXID, undefined)).toBe(gap);
    expect(await boundTxEventsGap(gap, TXID, createThrowingKV())).toBe(gap);
  });
});
