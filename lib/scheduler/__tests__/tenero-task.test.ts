import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from "vitest";
import {
  runTeneroTask,
  TENERO_MONTH_QUOTA_BACKOFF_MS,
} from "../tenero-task";

/** Minimal logger double — captures events without console noise. */
function createCapturingLogger() {
  const events: Array<{ level: string; msg: string; ctx?: unknown }> = [];
  const make = (level: string) =>
    (msg: string, ctx?: Record<string, unknown>) => {
      events.push({ level, msg, ctx });
    };
  const logger = {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    child: () => logger,
  };
  return { logger, events };
}

/** KV double — Map-backed; records every put for assertions. */
function createFakeKv() {
  const store = new Map<string, string>();
  const puts: Array<{ key: string; value: string }> = [];
  return {
    kv: {
      get: vi.fn(async (key: string, type?: "json") => {
        const raw = store.get(key);
        if (raw === undefined) return null;
        return type === "json" ? JSON.parse(raw) : raw;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        puts.push({ key, value });
      }),
    } as unknown as KVNamespace,
    puts,
    store,
  };
}

/**
 * Stub a Tenero response. Returns the global-fetch implementation the
 * test should install for one specific request.
 */
function teneroResponse(
  status: number,
  opts: {
    priceUsd?: number | string | null;
    minuteRemaining?: number;
    monthRemaining?: number;
  } = {}
): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (opts.minuteRemaining !== undefined) {
    headers.set("x-ratelimit-minute-remaining", String(opts.minuteRemaining));
  }
  if (opts.monthRemaining !== undefined) {
    headers.set("x-ratelimit-month-remaining", String(opts.monthRemaining));
  }
  const body =
    opts.priceUsd === undefined
      ? "{}"
      : JSON.stringify({ data: { price_usd: opts.priceUsd } });
  return new Response(body, { status, headers });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("runTeneroTask", () => {
  it("happy path: writes a cache entry and bumps `succeeded`", async () => {
    const { logger, events } = createCapturingLogger();
    const { kv, puts } = createFakeKv();

    globalThis.fetch = vi.fn(async () =>
      teneroResponse(200, {
        priceUsd: 1.85,
        minuteRemaining: 99,
        monthRemaining: 49_000,
      })
    ) as unknown as typeof fetch;

    const fixedNow = 1_715_000_000_000;
    const { result, rateLimited } = await runTeneroTask({
      logger,
      kv,
      tokenIds: ["stx"],
      now: () => fixedNow,
    });

    expect(rateLimited).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.tokensAttempted).toBe(1);
    expect(result.minuteRemaining).toBe(99);
    expect(result.monthRemaining).toBe(49_000);

    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe("tenero:price:stx");
    const written = JSON.parse(puts[0].value);
    expect(written.priceUsd).toBe(1.85);
    expect(written.fetchedAt).toBe(fixedNow);
    expect(written.minuteRemaining).toBe(99);

    // Sanity: structured log events landed on the logger.
    expect(events.some((e) => e.msg === "tenero.refresh_started")).toBe(true);
    expect(events.some((e) => e.msg === "tenero.refresh_completed")).toBe(true);
  });

  it("prices known USD-pegged stablecoins without calling Tenero", async () => {
    const { logger, events } = createCapturingLogger();
    const { kv, puts } = createFakeKv();

    globalThis.fetch = vi.fn(async () =>
      teneroResponse(200, {
        priceUsd: 0,
        minuteRemaining: 99,
        monthRemaining: 49_000,
      })
    ) as unknown as typeof fetch;

    const fixedNow = 1_715_000_000_000;
    const { result, rateLimited } = await runTeneroTask({
      logger,
      kv,
      tokenIds: [
        "SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC",
      ],
      now: () => fixedNow,
    });

    expect(rateLimited).toBe(false);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.tokensAttempted).toBe(1);
    expect(result.minuteRemaining).toBeNull();
    expect(result.monthRemaining).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();

    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe(
      "tenero:price:SP3Y2ZSH8P7D50B0VBTSX11S7XSG24M1VB9YFQA4K.token-aeusdc::aeUSDC"
    );
    const written = JSON.parse(puts[0].value);
    expect(written.priceUsd).toBe(1);
    expect(written.fetchedAt).toBe(fixedNow);
    expect(
      events.some((e) => e.msg === "tenero.price_stablecoin_fallback_used")
    ).toBe(true);
  });

  it("5xx response: bumps `failed`, no KV write", async () => {
    const { logger } = createCapturingLogger();
    const { kv, puts } = createFakeKv();

    // teneroFetch retries 5xx once before giving up, so respond consistently.
    globalThis.fetch = vi.fn(async () =>
      teneroResponse(503)
    ) as unknown as typeof fetch;

    const { result, rateLimited } = await runTeneroTask({
      logger,
      kv,
      tokenIds: ["stx"],
    });

    expect(rateLimited).toBe(false);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(puts).toHaveLength(0);
  });

  it("429: flags rateLimited and bumps `failed`", async () => {
    const { logger } = createCapturingLogger();
    const { kv, puts } = createFakeKv();

    globalThis.fetch = vi.fn(async () =>
      teneroResponse(429)
    ) as unknown as typeof fetch;

    const { result, rateLimited } = await runTeneroTask({
      logger,
      kv,
      tokenIds: ["stx"],
    });

    expect(rateLimited).toBe(true);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(puts).toHaveLength(0);
  });

  it("minuteRemaining <= 0 on a 200 response: flags rateLimited and breaks early", async () => {
    const { logger, events } = createCapturingLogger();
    const { kv, puts } = createFakeKv();

    // First call returns 200 but with the minute quota exhausted; the
    // task should break out of the loop before hitting subsequent tokens.
    globalThis.fetch = vi.fn(async () =>
      teneroResponse(200, {
        priceUsd: 1.0,
        minuteRemaining: 0,
        monthRemaining: 30_000,
      })
    ) as unknown as typeof fetch;

    const { result, rateLimited, rateLimitBackoffMs } = await runTeneroTask({
      logger,
      kv,
      tokenIds: [
        "stx",
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
        "SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token::ststx",
      ],
    });

    expect(rateLimited).toBe(true);
    expect(rateLimitBackoffMs).toBe(5 * 60 * 1000);
    // First token wrote successfully before the break.
    expect(result.succeeded).toBe(1);
    expect(puts).toHaveLength(1);
    // Loop broke before processing tokens 2 + 3.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    expect(
      events.some((e) => e.msg === "tenero.minute_quota_exhausted_mid_run")
    ).toBe(true);
  });

  it("monthRemaining <= 0: flags rateLimited and backs off for a day", async () => {
    const { logger, events } = createCapturingLogger();
    const { kv, puts } = createFakeKv();

    globalThis.fetch = vi.fn(async () =>
      teneroResponse(429, {
        minuteRemaining: 80,
        monthRemaining: 0,
      })
    ) as unknown as typeof fetch;

    const { result, rateLimited, rateLimitBackoffMs } = await runTeneroTask({
      logger,
      kv,
      tokenIds: [
        "stx",
        "SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token",
      ],
    });

    expect(rateLimited).toBe(true);
    expect(rateLimitBackoffMs).toBe(TENERO_MONTH_QUOTA_BACKOFF_MS);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.monthRemaining).toBe(0);
    expect(puts).toHaveLength(0);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    expect(
      events.some((e) => e.msg === "tenero.month_quota_exhausted_mid_run")
    ).toBe(true);
  });
});
