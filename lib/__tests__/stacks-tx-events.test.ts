import { describe, expect, it } from "vitest";
import {
  TX_EVENT_GAP_MAX_AGE_MS,
  boundTxEventsGap,
  loadTxEventsUntil,
  txEventsGapKey,
  type TxEventsLoad,
} from "../stacks-tx-events";
import { createMockKV } from "../inbox/__tests__/kv-mock";

const TXID = "0xABCD";
const gap = (gapOffset = 100): TxEventsLoad => ({ state: "unreachable", pages: 0, gapOffset });

describe("loadTxEventsUntil gap offsets", () => {
  const tx = () => ({ event_count: 150, events: Array.from({ length: 100 }, (_, i) => i) });
  const load = (res: Response) => loadTxEventsUntil(tx(), "https://x/tx/1", async () => res, () => false);

  it("marks a 404 later page as a gap at its offset", async () => {
    expect(await load(new Response("{}", { status: 404 }))).toMatchObject({ state: "unreachable", gapOffset: 100 });
  });

  it("marks an empty later page as a gap at its offset", async () => {
    const r = await load(new Response(JSON.stringify({ events: [] })));
    expect(r).toMatchObject({ state: "unreachable", gapOffset: 100 });
  });

  it.each([401, 403, 408, 429, 503])("does not mark a later page %i as a gap", async (status) => {
    const r = await load(new Response("{}", { status }));
    expect(r.state).toBe("unreachable");
    expect(r).not.toHaveProperty("gapOffset");
  });

  it("reports the offsets of the pages it loaded", async () => {
    const r = await load(new Response(JSON.stringify({ events: Array.from({ length: 50 }, (_, i) => i) })));
    expect(r).toMatchObject({ state: "complete", pages: 1, loadedOffsets: [100] });
  });
});

describe("boundTxEventsGap", () => {
  it("keeps a gap retryable and writes its first-hit time once", async () => {
    const kv = createMockKV();
    expect(await boundTxEventsGap(gap(), TXID, kv, 1_000)).toMatchObject({ state: "unreachable" });
    expect(await boundTxEventsGap(gap(), TXID, kv, 2_000)).toMatchObject({ state: "unreachable" });
    expect(JSON.parse((await kv.get(txEventsGapKey(TXID, 100)))!)).toEqual({ firstAt: 1_000 });
  });

  it("turns a gap final once it is TX_EVENT_GAP_MAX_AGE_MS old, however often it was retried", async () => {
    const kv = createMockKV();
    for (let t = 0; t < TX_EVENT_GAP_MAX_AGE_MS; t += 30_000) {
      expect((await boundTxEventsGap(gap(), TXID, kv, t)).state).toBe("unreachable");
    }
    expect((await boundTxEventsGap(gap(), TXID, kv, TX_EVENT_GAP_MAX_AGE_MS)).state).toBe("incomplete");
  });

  it("keys the record on the txid however it is written", async () => {
    expect(txEventsGapKey("0xABCD", 100)).toBe(txEventsGapKey("abcd", 100));
  });

  it("clears the record at an offset once a page loads there", async () => {
    const kv = createMockKV();
    await boundTxEventsGap(gap(), TXID, kv, 0);
    await boundTxEventsGap({ state: "complete", pages: 1, loadedOffsets: [100] }, TXID, kv, 1);
    expect(await kv.get(txEventsGapKey(TXID, 100))).toBeNull();
    // A later lag at the same offset starts a fresh window.
    expect((await boundTxEventsGap(gap(), TXID, kv, TX_EVENT_GAP_MAX_AGE_MS)).state).toBe("unreachable");
  });

  it("never turns a non-gap failure final", async () => {
    const kv = createMockKV();
    const load: TxEventsLoad = { state: "unreachable", pages: 0 };
    expect(await boundTxEventsGap(load, TXID, kv, 0)).toBe(load);
    expect(await boundTxEventsGap(load, TXID, kv, 10 * TX_EVENT_GAP_MAX_AGE_MS)).toBe(load);
  });

  it("stays retryable without KV or when KV fails", async () => {
    expect((await boundTxEventsGap(gap(), TXID, undefined)).state).toBe("unreachable");
    const broken = {
      get: async () => { throw new Error("kv down"); },
      put: async () => { throw new Error("kv down"); },
      delete: async () => {},
    };
    expect((await boundTxEventsGap(gap(), TXID, broken, 10 * TX_EVENT_GAP_MAX_AGE_MS)).state).toBe("unreachable");
  });
});
