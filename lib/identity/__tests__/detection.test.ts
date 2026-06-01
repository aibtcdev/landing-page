import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { detectAgentIdentityWithOutcome } from "../detection";

// detection.ts calls Hiro via stacksApiFetch → global fetch. The BNS/identity
// KV-cache helpers degrade to a miss/no-op when there is no Workers runtime
// (getCloudflareContext throws → getDb() returns null), so no mocking needed
// for them — same pattern as lib/__tests__/bns.test.ts.
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

/** Minimal headers mock satisfying extractRateLimitInfo / detect429. */
function mockHeaders(): Headers {
  return { get: () => null } as unknown as Headers;
}

function mockResponse(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: mockHeaders(),
    json: async () => body,
  };
}

const STX = "SP1KVZTZCTCN9TNA1H5MHQ3H0225JGN1RJHY4HA9W";

const urlsHit = (): string[] => mockFetch.mock.calls.map((c) => String(c[0]));
const isHoldings = (u: string) => u.includes("/extended/v1/tokens/nft/holdings");
const isCallRead = (u: string) => u.includes("/v2/contracts/call-read/");

describe("detectAgentIdentityWithOutcome — #939 throttle hardening", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });
  afterEach(() => {
    vi.clearAllTimers();
  });

  it("429 on holdings → fails fast as lookup-failed WITHOUT firing the legacy scan", async () => {
    // A 429 means Hiro is throttling our CF egress. The old code treated this as
    // "holdings unavailable" and fired the O(N) legacy scan (5+ more call-read
    // requests at the same throttled upstream) — the #939 25s amplification.
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        isHoldings(url) ? mockResponse(429) : mockResponse(200, { okay: false })
      )
    );

    const outcome = await detectAgentIdentityWithOutcome(STX);

    expect(outcome).toEqual({ state: "lookup-failed", identity: null });
    // The core fix: a 429 must NOT trigger the legacy call-read scan.
    expect(urlsHit().some(isCallRead)).toBe(false);
    // retries429 = 1 → exactly one holdings attempt, no in-band retry storm.
    expect(urlsHit().filter(isHoldings)).toHaveLength(1);
  });

  it("5xx on holdings → also fails fast without the legacy scan", async () => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        isHoldings(url) ? mockResponse(503) : mockResponse(200, { okay: false })
      )
    );

    const outcome = await detectAgentIdentityWithOutcome(STX);

    expect(outcome.state).toBe("lookup-failed");
    expect(urlsHit().some(isCallRead)).toBe(false);
  });

  it("404 on holdings → still falls back to the legacy scan (genuine unavailability)", async () => {
    // 404 = the holdings endpoint genuinely can't serve this lookup; the legacy
    // scan is the right fallback there. call-read returns 400 so the scan fails
    // fast without a real chain walk — we only assert the scan was entered.
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(isHoldings(url) ? mockResponse(404) : mockResponse(400))
    );

    await detectAgentIdentityWithOutcome(STX);

    // The 404 branch is the only non-2xx path that should reach call-read.
    expect(urlsHit().some(isCallRead)).toBe(true);
  });

  it("200 holdings hit → positive, no legacy scan", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (isHoldings(url)) {
        return Promise.resolve(
          mockResponse(200, {
            total: 1,
            results: [
              {
                asset_identifier: "x::agent-identity",
                value: { repr: "u122", hex: "0x" },
                tx_id: "0x",
              },
            ],
          })
        );
      }
      // get-token-uri: benign non-clarity body → uri resolves to "" (best-effort)
      return Promise.resolve(mockResponse(200, { okay: false }));
    });

    const outcome = await detectAgentIdentityWithOutcome(STX);

    expect(outcome.state).toBe("positive");
    expect(outcome.identity?.agentId).toBe(122);
  });
});
