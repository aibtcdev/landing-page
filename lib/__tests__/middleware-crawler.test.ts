/**
 * Tests for Phase 2.3: D1-backed middleware crawler-bot OG handler.
 * Tests for P3.2: caches.default edge-cache wrap in handleCrawlerAgentPage.
 *
 * handleCrawlerAgentPage now does a single D1 SELECT + LEFT JOIN claims
 * for btc:/stx: address shapes, with a KV fallback for validation-excluded
 * agents (the ~708 records not yet in D1, tracked at #691).
 *
 * P3.2 adds a caches.default check+put (5min TTL) keyed on
 * `https://internal.cache/middleware:og:{address}` so repeated crawler hits
 * for the same agent don't pay the full D1 read + HTML build cost.
 *
 * Covers:
 *  1. Crawler UA + D1 hit (btc address) → returns 200 OG HTML
 *  2. Crawler UA + D1 hit (stx address) → returns 200 OG HTML
 *  3. Crawler UA + D1 miss + KV fallback hit → returns 200 OG HTML via fallback
 *  4. Crawler UA + D1 miss + KV miss → falls through to NextResponse.next()
 *  5. Non-crawler UA → falls through (no D1/KV calls)
 *  6. D1 query throws → falls through (existing try/catch behavior)
 *  7. Crawler UA + agent in D1 with claim → Genesis level in OG title
 *  8. Crawler UA + address is taproot/numeric → falls through (out of scope)
 *  9. Edge-cache hit → returns cached response without touching D1/KV
 * 10. Edge-cache miss → falls through to D1, puts result in cache
 * 11. cache.match throws → falls through to live render (no crash)
 * 12. cache.put throws → still returns the live response (no crash)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// Mock the D1 lookup helpers so we can control what the DB returns without
// actually preparing SQL. The real helpers are tested in
// app/api/agents/[address]/__tests__/profile-d1.test.ts.
vi.mock("@/lib/cache/agent-profile", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/cache/agent-profile")>();
  return {
    ...real,
    lookupProfileByBtcAddress: vi.fn(),
    lookupProfileByStxAddress: vi.fn(),
  };
});

// ── Imports after mocks ───────────────────────────────────────────────────────

import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  lookupProfileByBtcAddress,
  lookupProfileByStxAddress,
} from "@/lib/cache/agent-profile";
import type { AgentProfileRow } from "@/lib/cache/agent-profile";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { middleware } from "@/middleware";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CRAWLER_UA = "Twitterbot/1.0";
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const SAMPLE_BTC_ADDRESS = "bc1qagent1testmiddleware";
const SAMPLE_STX_ADDRESS = "SP1AGENTMIDDLEWARETEST";

function makeProfileRow(overrides: Partial<AgentProfileRow> = {}): AgentProfileRow {
  return {
    btc_address: SAMPLE_BTC_ADDRESS,
    stx_address: SAMPLE_STX_ADDRESS,
    stx_public_key: "02abc",
    btc_public_key: "03def",
    taproot_address: null,
    display_name: "Middleware Test Agent",
    description: "A test agent for middleware",
    bns_name: null,
    owner: null,
    verified_at: "2026-01-01T00:00:00.000Z",
    last_active_at: null,
    erc8004_agent_id: null,
    nostr_public_key: null,
    capabilities_json: null,
    last_identity_check: null,
    referred_by_btc: null,
    referral_code: "ABC123",
    github_username: null,
    claim_status: null,
    tweet_url: null,
    tweet_author: null,
    claimed_at: null,
    reward_satoshis: null,
    reward_txid: null,
    ...overrides,
  };
}

/** Build an AgentRecord from the profile row (mirrors mapRowToAgentRecord). */
function makeAgentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    btcAddress: SAMPLE_BTC_ADDRESS,
    stxAddress: SAMPLE_STX_ADDRESS,
    stxPublicKey: "02abc",
    btcPublicKey: "03def",
    displayName: "Middleware Test Agent",
    description: "A test agent for middleware",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    taprootAddress: null,
    bnsName: null,
    owner: null,
    ...overrides,
  };
}

/** Build a mock KVNamespace from a plain key→value map. */
function buildKvMock(data: Record<string, string | null>): KVNamespace {
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

/** Build a mock D1Database (the real lookup helpers are mocked via vi.mock above). */
function buildD1Mock(): D1Database {
  return {} as D1Database;
}

/** Build a NextRequest for /agents/:address with the given user-agent. */
function makeRequest(address: string, userAgent: string): NextRequest {
  return new NextRequest(`https://aibtc.com/agents/${address}`, {
    headers: { "user-agent": userAgent },
  });
}

// ── Cache mock helpers ────────────────────────────────────────────────────────

/** Build a mock caches.default store. `storedResponse` is returned by match() if set. */
function buildCacheMock(storedResponse: Response | null = null): {
  match: Mock;
  put: Mock;
  delete: Mock;
} {
  return {
    match: vi.fn(async () => storedResponse),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => false),
  };
}

/** Install a mock `caches.default` on globalThis and return a cleanup fn. */
function installCacheMock(cacheMock: ReturnType<typeof buildCacheMock>): () => void {
  const prev = (globalThis as unknown as Record<string, unknown>).caches;
  (globalThis as unknown as Record<string, unknown>).caches = { default: cacheMock };
  return () => {
    if (prev === undefined) {
      delete (globalThis as unknown as Record<string, unknown>).caches;
    } else {
      (globalThis as unknown as Record<string, unknown>).caches = prev;
    }
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

let restoreCaches: (() => void) | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  // By default remove caches.default so existing tests run without a cache mock
  // (mirrors Node / next dev runtime where caches is absent).
  restoreCaches = installCacheMock(buildCacheMock(null));
  // Immediately undo the install so the default state is "no cache".
  restoreCaches();
  restoreCaches = null;
});

afterEach(() => {
  if (restoreCaches) {
    restoreCaches();
    restoreCaches = null;
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("middleware handleCrawlerAgentPage — Phase 2.3 D1 flip", () => {

  describe("non-crawler UA — falls through without touching D1/KV", () => {
    it("browser UA → NextResponse.next() immediately", async () => {
      const req = makeRequest(SAMPLE_BTC_ADDRESS, BROWSER_UA);
      const res = await middleware(req);

      // Should pass through — no getCloudflareContext called for the crawler path
      expect(getCloudflareContext).not.toHaveBeenCalled();
      // next() returns a response with no OG HTML body (content-type is null or not text/html)
      const contentType = res.headers.get("content-type");
      expect(contentType === null || !contentType.includes("text/html")).toBe(true);
    });
  });

  describe("crawler UA + D1 hit (btc address)", () => {
    it("returns 200 OG HTML using D1 row (no KV reads)", async () => {
      const row = makeProfileRow();
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
      expect(res.headers.get("vary")).toBe("User-Agent");

      const body = await res.text();
      expect(body).toContain('<meta property="og:title"');
      expect(body).toContain(SAMPLE_BTC_ADDRESS); // canonical URL + OG image
      expect(body).toContain("Verified Agent"); // level 1 (no claim)

      // D1 lookup called; KV NOT called (no fallback needed)
      expect(lookupProfileByBtcAddress).toHaveBeenCalledWith(db, SAMPLE_BTC_ADDRESS);
      expect(kv.get).not.toHaveBeenCalled();
    });

    it("agent with verified claim → shows Genesis level in OG title", async () => {
      const row = makeProfileRow({
        claim_status: "verified",
        claimed_at: "2026-02-01T00:00:00.000Z",
        reward_satoshis: 9250,
      });
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Genesis"); // level 2
    });
  });

  describe("crawler UA + D1 hit (stx address)", () => {
    it("returns 200 OG HTML using D1 row for STX address", async () => {
      const row = makeProfileRow({ btc_address: SAMPLE_BTC_ADDRESS, stx_address: SAMPLE_STX_ADDRESS });
      (lookupProfileByStxAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_STX_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      expect(res.status).toBe(200);
      expect(lookupProfileByStxAddress).toHaveBeenCalledWith(db, SAMPLE_STX_ADDRESS);
      expect(kv.get).not.toHaveBeenCalled();
    });
  });

  describe("crawler UA + D1 miss + KV fallback hit (validation-excluded agents)", () => {
    it("falls back to KV btc: key and returns OG HTML when D1 misses", async () => {
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);

      const agentRecord = makeAgentRecord();
      const kv = buildKvMock({
        [`btc:${SAMPLE_BTC_ADDRESS}`]: JSON.stringify(agentRecord),
      });
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('<meta property="og:title"');
      expect(body).toContain("Verified Agent"); // level 1 (no claim in KV)

      // KV btc: read happened as fallback
      expect(kv.get).toHaveBeenCalledWith(`btc:${SAMPLE_BTC_ADDRESS}`);
    });

    it("reads claim from KV on fallback path and uses it for level", async () => {
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);

      const agentRecord = makeAgentRecord();
      const claimStatus: ClaimStatus = {
        status: "verified",
        claimedAt: "2026-02-01T00:00:00.000Z",
        rewardSatoshis: 9250,
      };
      const kv = buildKvMock({
        [`btc:${SAMPLE_BTC_ADDRESS}`]: JSON.stringify(agentRecord),
        [`claim:${SAMPLE_BTC_ADDRESS}`]: JSON.stringify(claimStatus),
      });
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain("Genesis"); // level 2 via KV claim
    });

    it("falls back to KV stx: key for STX address when D1 misses", async () => {
      (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

      const agentRecord = makeAgentRecord();
      const kv = buildKvMock({
        [`stx:${SAMPLE_STX_ADDRESS}`]: JSON.stringify(agentRecord),
      });
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_STX_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      expect(res.status).toBe(200);
      expect(kv.get).toHaveBeenCalledWith(`stx:${SAMPLE_STX_ADDRESS}`);
    });
  });

  describe("crawler UA + D1 miss + KV miss → falls through", () => {
    it("returns NextResponse.next() when neither D1 nor KV has the agent", async () => {
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);

      // NextResponse.next() has no OG HTML — verify by absence of OG content-type
      const contentType = res.headers.get("content-type");
      expect(contentType === null || !contentType.includes("text/html")).toBe(true);
    });
  });

  describe("D1 query throws → falls through", () => {
    it("swallows the error and returns NextResponse.next()", async () => {
      (lookupProfileByBtcAddress as Mock).mockRejectedValue(new Error("D1 connection failed"));

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      // Should not throw — the outer try/catch catches it
      const res = await middleware(req);

      // Falls through to next() — no OG HTML content-type
      const contentType = res.headers.get("content-type");
      expect(contentType === null || !contentType.includes("text/html")).toBe(true);
    });
  });

  describe("crawler UA + taproot address — KV reverse-lookup → D1", () => {
    it("taproot (bc1p) resolves via KV taproot:{addr} → D1 → renders OG HTML", async () => {
      const taproot = "bc1pme88yyvca6gjlu9zqpwhlg93j6gfzreu3l6j0zrsgz8el55zgfkq202ed2";
      const canonicalBtc = SAMPLE_BTC_ADDRESS;
      const req = makeRequest(taproot, CRAWLER_UA);

      // KV `taproot:{addr}` → canonical btc string (bare, not JSON)
      const kv = buildKvMock({ [`taproot:${taproot}`]: canonicalBtc });
      const db = buildD1Mock();
      (lookupProfileByBtcAddress as Mock).mockResolvedValueOnce(makeProfileRow());
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await middleware(req);

      // Reverse-lookup hit + D1 helper called with canonical btc
      expect(kv.get).toHaveBeenCalledWith(`taproot:${taproot}`);
      expect(lookupProfileByBtcAddress).toHaveBeenCalledWith(db, canonicalBtc);
      // OG HTML returned
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("taproot with no taproot:{addr} entry → falls through (no agent)", async () => {
      const taproot = "bc1pme88yyvca6gjlu9zqpwhlg93j6gfzreu3l6j0zrsgz8el55zgfkq202ed2";
      const req = makeRequest(taproot, CRAWLER_UA);

      const kv = buildKvMock({}); // no taproot: entry
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await middleware(req);

      expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
      const contentType = res.headers.get("content-type");
      expect(contentType === null || !contentType.includes("text/html")).toBe(true);
    });
  });

  describe("crawler UA + out-of-scope address shapes → falls through", () => {
    it("numeric agent-id → falls through without D1/KV lookup helpers", async () => {
      const req = makeRequest("42", CRAWLER_UA);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await middleware(req);

      expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
      expect(lookupProfileByStxAddress).not.toHaveBeenCalled();
      const contentType = res.headers.get("content-type");
      expect(contentType === null || !contentType.includes("text/html")).toBe(true);
    });
  });

  describe("OG HTML response shape — frozen spec", () => {
    it("contains all required OG meta tags with correct values", async () => {
      const row = makeProfileRow({
        display_name: "Fancy Bot",
        description: "A fancy test bot",
      });
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
      const res = await middleware(req);
      const body = await res.text();

      expect(body).toContain('property="og:title"');
      expect(body).toContain('property="og:description"');
      expect(body).toContain('property="og:type" content="profile"');
      expect(body).toContain('property="og:url"');
      expect(body).toContain('property="og:image"');
      expect(body).toContain('content="1200"');  // og:image:width
      expect(body).toContain('content="630"');   // og:image:height
      expect(body).toContain('name="twitter:card" content="summary_large_image"');
      expect(body).toContain('rel="canonical"');
      expect(body).toContain("Fancy Bot");
      expect(body).toContain("A fancy test bot");
      expect(body).toContain(`https://aibtc.com/api/og/${SAMPLE_BTC_ADDRESS}`);
    });
  });

  // ── P3.2: caches.default edge-cache wrap ─────────────────────────────────

  describe("P3.2 — caches.default edge-cache wrap", () => {

    describe("cache hit → returns cached response without touching D1/KV", () => {
      it("returns the cached response body directly on cache hit", async () => {
        const cachedHtml = `<!DOCTYPE html><html><head><title>Cached OG</title></head><body></body></html>`;
        const cachedResponse = new Response(cachedHtml, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=300",
          },
        });

        const cacheMock = buildCacheMock(cachedResponse);
        restoreCaches = installCacheMock(cacheMock);

        const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
        const res = await middleware(req);

        // Should return the cached response
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toBe(cachedHtml);

        // Cache was checked with the correct key
        expect(cacheMock.match).toHaveBeenCalledOnce();
        const matchArg = (cacheMock.match as Mock).mock.calls[0][0] as Request;
        expect(matchArg.url).toBe(
          `https://internal.cache/middleware:og:${encodeURIComponent(SAMPLE_BTC_ADDRESS.toLowerCase())}`
        );

        // D1 and KV should NOT have been called (cache hit skips live render)
        expect(getCloudflareContext).not.toHaveBeenCalled();
        expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
      });
    });

    describe("cache miss → falls through to D1, puts rendered HTML in cache", () => {
      it("calls D1 on cache miss and stores the result in caches.default", async () => {
        const row = makeProfileRow();
        (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

        const kv = buildKvMock({});
        const db = buildD1Mock();
        (getCloudflareContext as Mock).mockResolvedValue({
          env: { VERIFIED_AGENTS: kv, DB: db },
        });

        // Cache returns null (miss)
        const cacheMock = buildCacheMock(null);
        restoreCaches = installCacheMock(cacheMock);

        const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
        const res = await middleware(req);

        // Live render path executed
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(lookupProfileByBtcAddress).toHaveBeenCalledWith(db, SAMPLE_BTC_ADDRESS);

        // Result stored in cache
        expect(cacheMock.put).toHaveBeenCalledOnce();
        const [putKey, putResponse] = (cacheMock.put as Mock).mock.calls[0] as [Request, Response];
        expect(putKey.url).toBe(
          `https://internal.cache/middleware:og:${encodeURIComponent(SAMPLE_BTC_ADDRESS.toLowerCase())}`
        );
        // Cached clone should have 5min TTL and no Vary header
        expect(putResponse.headers.get("Cache-Control")).toBe("public, max-age=300");
        expect(putResponse.headers.get("Vary")).toBeNull();
      });
    });

    describe("cache.match throws → falls through to live render (no crash)", () => {
      it("swallows cache.match error and returns live response", async () => {
        const row = makeProfileRow();
        (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

        const kv = buildKvMock({});
        const db = buildD1Mock();
        (getCloudflareContext as Mock).mockResolvedValue({
          env: { VERIFIED_AGENTS: kv, DB: db },
        });

        const cacheMock = buildCacheMock(null);
        cacheMock.match = vi.fn(async () => { throw new Error("Cache read failed"); });
        restoreCaches = installCacheMock(cacheMock);

        const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
        // Should not throw
        const res = await middleware(req);

        // Falls through to live render
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        expect(lookupProfileByBtcAddress).toHaveBeenCalled();
      });
    });

    describe("cache.put throws → still returns the live response (no crash)", () => {
      it("swallows cache.put error and returns live response", async () => {
        const row = makeProfileRow();
        (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

        const kv = buildKvMock({});
        const db = buildD1Mock();
        (getCloudflareContext as Mock).mockResolvedValue({
          env: { VERIFIED_AGENTS: kv, DB: db },
        });

        const cacheMock = buildCacheMock(null);
        cacheMock.put = vi.fn(async () => { throw new Error("Cache write failed"); });
        restoreCaches = installCacheMock(cacheMock);

        const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
        // Should not throw
        const res = await middleware(req);

        // Live response returned despite put failure
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/html");
        const body = await res.text();
        expect(body).toContain('<meta property="og:title"');
      });
    });

    describe("no caches.default (Node / next dev) → falls through to live render", () => {
      it("renders live without any cache interaction when globalThis.caches is absent", async () => {
        // Ensure caches is absent (already the default in beforeEach, but be explicit)
        const g = globalThis as unknown as Record<string, unknown>;
        delete g.caches;

        const row = makeProfileRow();
        (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

        const kv = buildKvMock({});
        const db = buildD1Mock();
        (getCloudflareContext as Mock).mockResolvedValue({
          env: { VERIFIED_AGENTS: kv, DB: db },
        });

        const req = makeRequest(SAMPLE_BTC_ADDRESS, CRAWLER_UA);
        const res = await middleware(req);

        // Live render path
        expect(res.status).toBe(200);
        expect(lookupProfileByBtcAddress).toHaveBeenCalled();
      });
    });

  });
});
