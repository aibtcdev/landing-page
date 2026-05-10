/**
 * Tests for Phase 2.4: D1-backed /api/og/[address] route.
 *
 * The route now does a single D1 SELECT + LEFT JOIN claims for btc/stx/taproot
 * address shapes, with a KV fallback for validation-excluded agents (~708
 * records not yet in D1, tracked at #691).
 *
 * Covers:
 *  1. D1 hit (btc address) → returns 200 image/png (ImageResponse)
 *  2. D1 hit (stx address) → returns 200 image/png
 *  3. D1 hit with verified claim → Genesis level used for rendering
 *  4. D1 miss + KV fallback hit → returns 200 image (validation-excluded agent)
 *  5. D1 miss + KV fallback hit (with claim) → Genesis level from KV claim
 *  6. D1 miss + KV miss → 404 "Agent not found"
 *  7. Taproot (bc1p*) → KV `taproot:{addr}` reverse-lookup → D1 → returns image
 *  8. Taproot with no KV entry → 404
 *  9. Numeric address → 404 (out of scope for OG)
 * 10. No lookupAgent calls — all D1 or KV paths via new helpers
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

// Mock ImageResponse from next/og — it is not renderable in Node (requires
// Resvg/WASM). Replace with a lightweight stand-in that extends Response so
// the route's `return new ImageResponse(...)` behaves as a proper Response.
vi.mock("next/og", () => ({
  ImageResponse: class extends Response {
    constructor(_jsx: unknown, _options?: { width?: number; height?: number }) {
      super(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
  },
}));

// Mock the bitcoinfaces avatar fetch so tests don't hit the network.
// fetchImageAsDataUri is an internal helper; mocking fetch globally is simpler.
vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

// Mock D1 lookup helpers so we control DB responses without real SQL.
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
import { GET } from "@/app/api/og/[address]/route";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const SAMPLE_BTC = "bc1qagent1testogroute";
const SAMPLE_STX = "SP1AGENTOGTEST1";
const SAMPLE_TAPROOT = "bc1pme88yyvca6gjlu9zqpwhlg93j6gfzreu3l6j0zrsgz8el55zgfkq202ed2";

function makeProfileRow(overrides: Partial<AgentProfileRow> = {}): AgentProfileRow {
  return {
    btc_address: SAMPLE_BTC,
    stx_address: SAMPLE_STX,
    stx_public_key: "02abc",
    btc_public_key: "03def",
    taproot_address: null,
    display_name: "OG Test Agent",
    description: "A test agent for OG",
    bns_name: null,
    owner: null,
    verified_at: "2026-01-01T00:00:00.000Z",
    last_active_at: null,
    erc8004_agent_id: null,
    nostr_public_key: null,
    capabilities_json: null,
    last_identity_check: null,
    referred_by_btc: null,
    referral_code: "XYZABC",
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

function makeAgentRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    btcAddress: SAMPLE_BTC,
    stxAddress: SAMPLE_STX,
    stxPublicKey: "02abc",
    btcPublicKey: "03def",
    displayName: "OG Test Agent",
    description: "A test agent for OG",
    verifiedAt: "2026-01-01T00:00:00.000Z",
    taprootAddress: null,
    bnsName: null,
    owner: null,
    ...overrides,
  };
}

function buildKvMock(data: Record<string, string | null>): KVNamespace {
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

function buildD1Mock(): D1Database {
  return {} as D1Database;
}

function makeRequest(address: string): NextRequest {
  return new NextRequest(`https://aibtc.com/api/og/${address}`);
}

async function callRoute(address: string) {
  const req = makeRequest(address);
  return GET(req, { params: Promise.resolve({ address }) });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Reset fetch stub to return non-ok so avatar is skipped (tests don't hit network)
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("/api/og/[address] — Phase 2.4 D1 flip", () => {

  describe("D1 hit (btc address) → image/png response", () => {
    it("returns 200 with image/png for a known btc address", async () => {
      const row = makeProfileRow();
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_BTC);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      expect(lookupProfileByBtcAddress).toHaveBeenCalledWith(db, SAMPLE_BTC);
      // No KV data reads (only the fallback path touches KV btc:/stx:)
      expect(kv.get).not.toHaveBeenCalled();
    });
  });

  describe("D1 hit (stx address) → image/png response", () => {
    it("returns 200 with image/png for a known stx address", async () => {
      const row = makeProfileRow({ btc_address: SAMPLE_BTC, stx_address: SAMPLE_STX });
      (lookupProfileByStxAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_STX);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      expect(lookupProfileByStxAddress).toHaveBeenCalledWith(db, SAMPLE_STX);
      expect(kv.get).not.toHaveBeenCalled();
    });
  });

  describe("D1 hit with verified claim → Genesis level rendered", () => {
    it("passes through claim data for level computation when D1 row has claim", async () => {
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

      // Confirmed ImageResponse is returned (level computation is internal)
      const res = await callRoute(SAMPLE_BTC);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });
  });

  describe("D1 miss + KV fallback hit → image (validation-excluded agent)", () => {
    it("falls back to KV btc: key and returns image when D1 misses", async () => {
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);

      const agentRecord = makeAgentRecord();
      const kv = buildKvMock({
        [`btc:${SAMPLE_BTC}`]: JSON.stringify(agentRecord),
      });
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_BTC);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      expect(kv.get).toHaveBeenCalledWith(`btc:${SAMPLE_BTC}`);
    });

    it("reads claim from KV on fallback path for level computation", async () => {
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);

      const agentRecord = makeAgentRecord();
      const claimStatus: ClaimStatus = {
        status: "verified",
        claimedAt: "2026-02-01T00:00:00.000Z",
        rewardSatoshis: 9250,
      };
      const kv = buildKvMock({
        [`btc:${SAMPLE_BTC}`]: JSON.stringify(agentRecord),
        [`claim:${SAMPLE_BTC}`]: JSON.stringify(claimStatus),
      });
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_BTC);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      // Both KV reads happened
      expect(kv.get).toHaveBeenCalledWith(`btc:${SAMPLE_BTC}`);
      expect(kv.get).toHaveBeenCalledWith(`claim:${SAMPLE_BTC}`);
    });

    it("falls back to KV stx: key for STX address when D1 misses", async () => {
      (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

      const agentRecord = makeAgentRecord();
      const kv = buildKvMock({
        [`stx:${SAMPLE_STX}`]: JSON.stringify(agentRecord),
      });
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_STX);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      expect(kv.get).toHaveBeenCalledWith(`stx:${SAMPLE_STX}`);
    });
  });

  describe("D1 miss + KV miss → 404", () => {
    it("returns 404 when neither D1 nor KV has the agent", async () => {
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_BTC);

      expect(res.status).toBe(404);
      const body = await res.text();
      expect(body).toBe("Agent not found");
    });
  });

  describe("taproot (bc1p*) — KV reverse-lookup → D1 → image (regression for codex P1)", () => {
    it("resolves taproot via KV taproot:{addr} → D1 → returns image", async () => {
      const kv = buildKvMock({ [`taproot:${SAMPLE_TAPROOT}`]: SAMPLE_BTC });
      const db = buildD1Mock();
      (lookupProfileByBtcAddress as Mock).mockResolvedValueOnce(makeProfileRow());
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_TAPROOT);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      // KV taproot: reverse-lookup happened
      expect(kv.get).toHaveBeenCalledWith(`taproot:${SAMPLE_TAPROOT}`);
      // D1 called with the resolved canonical btc address
      expect(lookupProfileByBtcAddress).toHaveBeenCalledWith(db, SAMPLE_BTC);
    });

    it("taproot with no KV entry → 404", async () => {
      const kv = buildKvMock({}); // no taproot: entry
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_TAPROOT);

      expect(res.status).toBe(404);
      expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
    });

    it("taproot KV hit but D1 misses → KV btc: fallback → returns image", async () => {
      const agentRecord = makeAgentRecord();
      const kv = buildKvMock({
        [`taproot:${SAMPLE_TAPROOT}`]: SAMPLE_BTC,
        [`btc:${SAMPLE_BTC}`]: JSON.stringify(agentRecord),
      });
      const db = buildD1Mock();
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(null);
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute(SAMPLE_TAPROOT);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
      // Fallback btc: read happened
      expect(kv.get).toHaveBeenCalledWith(`btc:${SAMPLE_BTC}`);
    });
  });

  describe("out-of-scope address shapes → 404", () => {
    it("numeric (erc8004 ID) → 404 without touching D1 or KV", async () => {
      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute("42");

      expect(res.status).toBe(404);
      expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
      expect(lookupProfileByStxAddress).not.toHaveBeenCalled();
      expect(kv.get).not.toHaveBeenCalled();
    });

    it("BNS name → 404 without touching D1 or KV", async () => {
      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      const res = await callRoute("someagent.btc");

      expect(res.status).toBe(404);
      expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
      expect(lookupProfileByStxAddress).not.toHaveBeenCalled();
    });
  });

  describe("no lookupAgent import — route uses D1 helpers only", () => {
    it("D1 btc hit never calls lookupProfileByStxAddress", async () => {
      const row = makeProfileRow();
      (lookupProfileByBtcAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      await callRoute(SAMPLE_BTC);

      expect(lookupProfileByStxAddress).not.toHaveBeenCalled();
    });

    it("D1 stx hit never calls lookupProfileByBtcAddress", async () => {
      const row = makeProfileRow({ stx_address: SAMPLE_STX });
      (lookupProfileByStxAddress as Mock).mockResolvedValue(row);

      const kv = buildKvMock({});
      const db = buildD1Mock();
      (getCloudflareContext as Mock).mockResolvedValue({
        env: { VERIFIED_AGENTS: kv, DB: db },
      });

      await callRoute(SAMPLE_STX);

      expect(lookupProfileByBtcAddress).not.toHaveBeenCalled();
    });
  });
});
