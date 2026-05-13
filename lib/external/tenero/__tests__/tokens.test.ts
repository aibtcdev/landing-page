import { describe, it, expect, vi } from "vitest";
import {
  STATIC_TOKEN_IDS,
  MAX_TRACKED_TOKENS,
  getActiveTokenIds,
  isValidTokenId,
} from "../tokens";

/**
 * Minimal D1Database double. The function under test only calls
 * `prepare(sql).bind(...).all<T>()`, so we mock that chain and assert on
 * the rows the test scenario returns.
 */
function createFakeDb(opts: {
  rows?: Array<{ id: string; cnt: number | string }>;
  throws?: boolean;
}): D1Database {
  return {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({
        all: vi.fn(async () => {
          if (opts.throws) throw new Error("D1 unavailable");
          return { results: opts.rows ?? [], success: true, meta: {} };
        }),
      }),
    }),
  } as unknown as D1Database;
}

describe("isValidTokenId", () => {
  it("accepts the literal 'stx'", () => {
    expect(isValidTokenId("stx")).toBe(true);
  });

  it("accepts SP-prefixed contract ids with the ::asset suffix", () => {
    expect(
      isValidTokenId(
        "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx"
      )
    ).toBe(true);
  });

  it("accepts SM-prefixed contract ids", () => {
    expect(
      isValidTokenId(
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token"
      )
    ).toBe(true);
  });

  it("accepts contract ids without the ::asset suffix", () => {
    expect(
      isValidTokenId("SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token")
    ).toBe(true);
  });

  it("rejects the 'unknown' parser sentinel", () => {
    expect(isValidTokenId("unknown")).toBe(false);
  });

  it("rejects empty strings and random junk", () => {
    expect(isValidTokenId("")).toBe(false);
    expect(isValidTokenId("not a token")).toBe(false);
    expect(isValidTokenId("STX")).toBe(false); // case matters for the literal
  });

  it("rejects malformed deployer prefixes", () => {
    expect(isValidTokenId("XX1234.contract")).toBe(false);
    expect(isValidTokenId("SP123.contract")).toBe(false); // too-short deployer hash
  });
});

describe("getActiveTokenIds", () => {
  it("falls back to STATIC_TOKEN_IDS when no DB binding is provided", async () => {
    const result = await getActiveTokenIds(undefined);
    expect(result).toEqual(STATIC_TOKEN_IDS);
  });

  it("falls back to STATIC_TOKEN_IDS when the D1 query throws", async () => {
    const db = createFakeDb({ throws: true });
    const result = await getActiveTokenIds(db);
    expect(result).toEqual(STATIC_TOKEN_IDS);
  });

  it("returns just the static core when the swaps table is empty", async () => {
    const db = createFakeDb({ rows: [] });
    const result = await getActiveTokenIds(db);
    expect(result).toEqual(STATIC_TOKEN_IDS);
  });

  it("unions dynamic rows with the static core, preserving static-first order", async () => {
    const db = createFakeDb({
      rows: [
        { id: "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.usda-token::usda", cnt: 12 },
        { id: "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.aeusdc-token::aeusdc", cnt: 8 },
      ],
    });
    const result = await getActiveTokenIds(db);
    // Static core first, then dynamic entries in the order D1 returned them.
    expect(result.slice(0, STATIC_TOKEN_IDS.length)).toEqual(STATIC_TOKEN_IDS);
    expect(result).toContain(
      "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.usda-token::usda"
    );
    expect(result).toContain(
      "SP2C2YFP12AJZB4MABJBAJ55XECVS7E4PMMZ89YZR.aeusdc-token::aeusdc"
    );
    expect(result.length).toBe(STATIC_TOKEN_IDS.length + 2);
  });

  it("deduplicates when a dynamic row repeats a static core entry", async () => {
    const db = createFakeDb({
      rows: [
        { id: "stx", cnt: 100 },
        { id: "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token", cnt: 50 },
      ],
    });
    const result = await getActiveTokenIds(db);
    // No duplicates — static-core entries are NOT re-added.
    expect(result.length).toBe(STATIC_TOKEN_IDS.length);
    expect(result).toEqual(STATIC_TOKEN_IDS);
  });

  it("filters out malformed token ids from the dynamic set", async () => {
    const db = createFakeDb({
      rows: [
        { id: "unknown", cnt: 99 }, // parser sentinel — must be excluded
        { id: "", cnt: 5 }, // empty
        { id: "STX", cnt: 4 }, // wrong case for the literal
        { id: "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.real-token::real", cnt: 3 },
      ],
    });
    const result = await getActiveTokenIds(db);
    // Only `SPABCDE…real-token::real` should join the static core.
    expect(result).toContain(
      "SPQC38PW542EQJ5M11CR25P7BS1CA6QT4TBXGB3M.real-token::real"
    );
    expect(result).not.toContain("unknown");
    expect(result).not.toContain("");
    expect(result).not.toContain("STX");
    expect(result.length).toBe(STATIC_TOKEN_IDS.length + 1);
  });

  it("uses the MAX_TRACKED_TOKENS bound when calling prepare().bind()", async () => {
    const all = vi.fn(async () => ({ results: [], success: true, meta: {} }));
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const db = { prepare } as unknown as D1Database;

    await getActiveTokenIds(db);

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(bind).toHaveBeenCalledWith(MAX_TRACKED_TOKENS);
  });
});
