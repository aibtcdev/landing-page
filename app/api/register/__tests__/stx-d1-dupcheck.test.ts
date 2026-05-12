/**
 * Phase 4.0b — STX duplicate check via D1 (replaces kv.get('stx:...')).
 *
 * Covers four cases:
 *  (a) D1 returns a row → address exists → 409 STX_ADDRESS_TAKEN
 *  (b) D1 returns null  → address free  → registration proceeds past the check
 *  (c) D1 throws        → fail-closed   → 409 STX_ADDRESS_TAKEN
 *  (d) DB binding undefined → fail-closed → 409 STX_ADDRESS_TAKEN
 *
 * The test hooks in at the POST handler level, mocking every layer that runs
 * before the D1 check so the four interesting D1 outcomes can be isolated.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ---- module mocks (declared before route import) ----------------------------

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(),
}));

vi.mock("@/lib/bitcoin-verify", () => ({
  verifyBitcoinSignature: vi.fn(),
  bip322VerifyP2TR: vi.fn(),
}));

// @stacks/transactions: publicKeyFromSignatureRsv + getAddressFromPublicKey
vi.mock("@stacks/transactions", () => ({
  publicKeyFromSignatureRsv: vi.fn().mockReturnValue("02mock_stx_pubkey"),
  getAddressFromPublicKey: vi.fn().mockReturnValue("SP1TESTADDRESS1234"),
}));

// @stacks/encryption: verifyMessageSignatureRsv + hashMessage
vi.mock("@stacks/encryption", () => ({
  verifyMessageSignatureRsv: vi.fn().mockReturnValue(true),
  hashMessage: vi.fn().mockReturnValue(new Uint8Array(32)),
}));

// @stacks/common: bytesToHex
vi.mock("@stacks/common", () => ({
  bytesToHex: vi.fn().mockReturnValue("aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"),
}));

vi.mock("@/lib/cache/agent-profile", () => ({
  lookupProfileByStxAddress: vi.fn(),
}));

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: vi.fn(),
}));

vi.mock("@/lib/agents-index", () => ({
  invalidateAgentsIndex: vi.fn(),
}));

vi.mock("@/lib/bns-reverse-index", () => ({
  syncBnsLookup: vi.fn(),
}));

vi.mock("@/lib/bns", () => ({
  lookupBnsName: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/sponsor", () => ({
  provisionSponsorKey: vi.fn().mockResolvedValue({ success: true, apiKey: "test-api-key" }),
  DEFAULT_RELAY_URL: "https://x402-relay.aibtc.com",
}));

vi.mock("@/lib/vouch", () => ({
  MIN_REFERRER_LEVEL: 2,
  MAX_REFERRALS: 10,
  storeVouch: vi.fn(),
  getVouchIndex: vi.fn().mockResolvedValue([]),
  generateAndStoreReferralCode: vi.fn().mockResolvedValue("NEWCOD"),
  lookupReferralCode: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  createConsoleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  isLogsRPC: () => false,
}));

vi.mock("@/lib/name-generator", () => ({
  generateName: vi.fn().mockReturnValue("MockAgent"),
}));

vi.mock("@/lib/levels", () => ({
  computeLevel: vi.fn().mockReturnValue(1),
  getNextLevel: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/claim-code", () => ({
  generateClaimCode: vi.fn().mockReturnValue("CLAIMCODE1"),
}));

vi.mock("@/lib/challenge", () => ({
  validateTaprootAddress: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/nostr", () => ({
  validateNostrPubkey: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/constants", () => ({
  X_HANDLE: "@aibtcdev",
}));

// ---- imports after mocks ----------------------------------------------------

import { POST } from "../route";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupProfileByStxAddress } from "@/lib/cache/agent-profile";
import type { AgentProfileRow } from "@/lib/cache/agent-profile";

// ---- fixtures ---------------------------------------------------------------

const TEST_STX_ADDRESS = "SP1TESTADDRESS1234";
const TEST_BTC_ADDRESS = "bc1qtest1address1mock1";

/** Minimal AgentProfileRow that satisfies the type for a "row exists" scenario. */
function makeProfileRow(overrides: Partial<AgentProfileRow> = {}): AgentProfileRow {
  return {
    btc_address: TEST_BTC_ADDRESS,
    stx_address: TEST_STX_ADDRESS,
    stx_public_key: "02mock_stx_pubkey",
    btc_public_key: "03mock_btc_pubkey",
    taproot_address: null,
    display_name: null,
    description: null,
    bns_name: null,
    owner: null,
    verified_at: "2026-01-01T00:00:00.000Z",
    last_active_at: null,
    erc8004_agent_id: null,
    nostr_public_key: null,
    capabilities_json: null,
    last_identity_check: null,
    referred_by_btc: null,
    referral_code: "ABCDEF",
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

function buildRequest() {
  return new NextRequest("https://aibtc.com/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      bitcoinSignature: "mock_btc_sig",
      stacksSignature: "mock_stx_sig",
      btcAddress: TEST_BTC_ADDRESS,
      stxAddress: TEST_STX_ADDRESS,
    }),
  });
}

function buildMockD1(): D1Database {
  return { prepare: vi.fn() } as unknown as D1Database;
}

function buildMockKv(btcValue: string | null = null): KVNamespace {
  return {
    get: vi.fn().mockResolvedValue(btcValue),
    put: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ keys: [] }),
    getWithMetadata: vi.fn().mockResolvedValue({ value: null, metadata: null }),
  } as unknown as KVNamespace;
}

beforeEach(() => {
  vi.clearAllMocks();

  // Default: verifyBitcoinSignature succeeds, returns TEST_BTC_ADDRESS
  (verifyBitcoinSignature as Mock).mockReturnValue({
    valid: true,
    address: TEST_BTC_ADDRESS,
    publicKey: "03mock_btc_pubkey",
  });
});

// ---- test cases -------------------------------------------------------------

describe("STX duplicate-check: D1 hit → 409 STX_ADDRESS_TAKEN", () => {
  it("returns 409 when D1 finds an existing row for the STX address", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv(null); // BTC not taken

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        DB: mockDb,
        VERIFIED_AGENTS: mockKv,
        X402_RELAY_URL: "https://x402-relay.aibtc.com",
      },
      ctx: { waitUntil: vi.fn() },
    });

    (lookupProfileByStxAddress as Mock).mockResolvedValue(makeProfileRow());

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("STX_ADDRESS_TAKEN");
    expect(lookupProfileByStxAddress as Mock).toHaveBeenCalledWith(mockDb, TEST_STX_ADDRESS);
  });
});

describe("STX duplicate-check: D1 miss → registration proceeds past check", () => {
  it("does NOT return 409 STX_ADDRESS_TAKEN when D1 returns null", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv(null); // BTC not taken either

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        DB: mockDb,
        VERIFIED_AGENTS: mockKv,
        X402_RELAY_URL: "https://x402-relay.aibtc.com",
      },
      ctx: { waitUntil: vi.fn() },
    });

    // D1 returns null → address is free
    (lookupProfileByStxAddress as Mock).mockResolvedValue(null);

    const res = await POST(buildRequest());

    // Should NOT be 409 STX_ADDRESS_TAKEN — registration proceeds further.
    // (It may still fail for other reasons, e.g. sponsor provisioning errors
    // in the mock environment — but the STX duplicate check must pass.)
    expect(res.status).not.toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).not.toBe("STX_ADDRESS_TAKEN");
  });
});

describe("STX duplicate-check: D1 throws → fail-closed → 409 STX_ADDRESS_TAKEN", () => {
  it("returns 409 STX_ADDRESS_TAKEN when D1 throws a transient error", async () => {
    const mockDb = buildMockD1();
    const mockKv = buildMockKv(null);

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        DB: mockDb,
        VERIFIED_AGENTS: mockKv,
        X402_RELAY_URL: "https://x402-relay.aibtc.com",
      },
      ctx: { waitUntil: vi.fn() },
    });

    // Simulate D1 transient failure
    (lookupProfileByStxAddress as Mock).mockRejectedValue(
      new Error("D1_ERROR: connection reset")
    );

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("STX_ADDRESS_TAKEN");
  });

  it("returns 409 STX_ADDRESS_TAKEN when DB binding is undefined (fail-closed)", async () => {
    const mockKv = buildMockKv(null);

    (getCloudflareContext as Mock).mockResolvedValue({
      env: {
        DB: undefined, // binding not present
        VERIFIED_AGENTS: mockKv,
        X402_RELAY_URL: "https://x402-relay.aibtc.com",
      },
      ctx: { waitUntil: vi.fn() },
    });

    const res = await POST(buildRequest());

    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe("STX_ADDRESS_TAKEN");
  });
});
