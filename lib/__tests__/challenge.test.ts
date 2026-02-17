import { describe, it, expect, vi } from "vitest";
import {
  generateChallenge,
  validateChallenge,
  storeChallenge,
  getChallenge,
  deleteChallenge,
  checkRateLimit,
  recordRequest,
  executeAction,
  getAvailableActions,
  validateTaprootAddress,
  type ChallengeStoreRecord,
} from "../challenge";

// Mock KV namespace
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

describe("generateChallenge", () => {
  it("generates a challenge with message, expiresAt, and action", () => {
    const challenge = generateChallenge("bc1qtest", "update-description");
    expect(challenge).toHaveProperty("message");
    expect(challenge).toHaveProperty("expiresAt");
    expect(challenge).toHaveProperty("action");
  });

  it("includes address in message", () => {
    const address = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    const challenge = generateChallenge(address, "update-description");
    expect(challenge.message).toContain(address);
  });

  it("includes action in message", () => {
    const action = "update-description";
    const challenge = generateChallenge("bc1qtest", action);
    expect(challenge.message).toContain(action);
  });

  it("stores action field", () => {
    const action = "update-owner";
    const challenge = generateChallenge("bc1qtest", action);
    expect(challenge.action).toBe(action);
  });

  it("message includes timestamp", () => {
    const challenge = generateChallenge("bc1qtest", "update-description");
    // Message should contain an ISO timestamp
    expect(challenge.message).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("expires in 30 minutes", () => {
    const before = new Date();
    const challenge = generateChallenge("bc1qtest", "update-description");
    const after = new Date();

    const expiresAt = new Date(challenge.expiresAt);
    const expectedMin = new Date(before.getTime() + 30 * 60 * 1000);
    const expectedMax = new Date(after.getTime() + 30 * 60 * 1000);

    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin.getTime());
    expect(expiresAt.getTime()).toBeLessThanOrEqual(expectedMax.getTime());
  });

  it("generates unique challenges for same address", async () => {
    const challenge1 = generateChallenge("bc1qtest", "update-description");
    // Small delay to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 10));
    const challenge2 = generateChallenge("bc1qtest", "update-description");
    expect(challenge1.message).not.toBe(challenge2.message);
  });

  it("generates different challenges for different addresses", () => {
    const challenge1 = generateChallenge("bc1qtest1", "update-description");
    const challenge2 = generateChallenge("bc1qtest2", "update-description");
    expect(challenge1.message).not.toBe(challenge2.message);
  });

  it("formats message consistently", () => {
    const challenge = generateChallenge("bc1qtest", "update-description");
    expect(challenge.message).toMatch(/^Challenge: .+ for .+ at .+$/);
  });
});

describe("validateChallenge", () => {
  const baseChallenge: ChallengeStoreRecord = {
    message: "Challenge: update-description for bc1qtest at 2026-02-10T12:00:00.000Z",
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    action: "update-description",
    createdAt: new Date().toISOString(),
  };

  it("validates matching challenge message", () => {
    const result = validateChallenge(baseChallenge, baseChallenge.message);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("rejects expired challenge", () => {
    const expiredChallenge: ChallengeStoreRecord = {
      ...baseChallenge,
      expiresAt: new Date(Date.now() - 1000).toISOString(), // 1 second ago
    };
    const result = validateChallenge(expiredChallenge, expiredChallenge.message);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Challenge expired");
  });

  it("rejects mismatched message", () => {
    const result = validateChallenge(baseChallenge, "Wrong message");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Challenge message mismatch");
  });

  it("accepts challenge that expires soon", () => {
    const almostExpiredChallenge: ChallengeStoreRecord = {
      ...baseChallenge,
      expiresAt: new Date(Date.now() + 1000).toISOString(), // 1 second from now
    };
    const result = validateChallenge(almostExpiredChallenge, almostExpiredChallenge.message);
    expect(result.valid).toBe(true);
  });

  it("rejects challenge that just expired", () => {
    const justExpiredChallenge: ChallengeStoreRecord = {
      ...baseChallenge,
      expiresAt: new Date(Date.now() - 1).toISOString(), // 1ms ago
    };
    const result = validateChallenge(justExpiredChallenge, justExpiredChallenge.message);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Challenge expired");
  });

  it("is case-sensitive for message matching", () => {
    const result = validateChallenge(baseChallenge, baseChallenge.message.toUpperCase());
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Challenge message mismatch");
  });

  it("requires exact message match", () => {
    const result = validateChallenge(baseChallenge, baseChallenge.message + " ");
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("Challenge message mismatch");
  });
});

describe("storeChallenge", () => {
  it("stores challenge in KV with correct key", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);

    expect(kv.put).toHaveBeenCalledWith(
      "challenge:bc1qtest",
      expect.any(String),
      expect.objectContaining({ expirationTtl: 1800 })
    );
  });

  it("stores challenge with 30-minute TTL", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);

    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { expirationTtl: 1800 }
    );
  });

  it("adds createdAt timestamp to stored record", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    const beforeMs = Date.now();
    await storeChallenge(kv, "bc1qtest", challenge);
    const afterMs = Date.now();

    const storedValue = (kv.put as any).mock.calls[0][1];
    const stored = JSON.parse(storedValue);
    expect(stored.createdAt).toBeDefined();
    const createdAtMs = new Date(stored.createdAt).getTime();
    expect(createdAtMs).toBeGreaterThanOrEqual(beforeMs);
    expect(createdAtMs).toBeLessThanOrEqual(afterMs);
  });

  it("preserves all challenge fields", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);

    const storedValue = (kv.put as any).mock.calls[0][1];
    const stored = JSON.parse(storedValue);
    expect(stored.message).toBe(challenge.message);
    expect(stored.expiresAt).toBe(challenge.expiresAt);
    expect(stored.action).toBe(challenge.action);
  });
});

describe("getChallenge", () => {
  it("retrieves stored challenge", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);

    const retrieved = await getChallenge(kv, "bc1qtest");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.message).toBe(challenge.message);
    expect(retrieved?.action).toBe(challenge.action);
  });

  it("returns null for non-existent challenge", async () => {
    const kv = createMockKV();
    const retrieved = await getChallenge(kv, "bc1qnonexistent");
    expect(retrieved).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    const kv = createMockKV();
    (kv.get as any).mockResolvedValue("invalid json {");
    const retrieved = await getChallenge(kv, "bc1qtest");
    expect(retrieved).toBeNull();
  });

  it("includes createdAt in retrieved challenge", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);

    const retrieved = await getChallenge(kv, "bc1qtest");
    expect(retrieved?.createdAt).toBeDefined();
  });
});

describe("deleteChallenge", () => {
  it("deletes challenge from KV", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);
    await deleteChallenge(kv, "bc1qtest");

    expect(kv.delete).toHaveBeenCalledWith("challenge:bc1qtest");
  });

  it("uses correct key format", async () => {
    const kv = createMockKV();
    await deleteChallenge(kv, "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");

    expect(kv.delete).toHaveBeenCalledWith(
      "challenge:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4"
    );
  });

  it("after deletion, getChallenge returns null", async () => {
    const kv = createMockKV();
    const challenge = generateChallenge("bc1qtest", "update-description");
    await storeChallenge(kv, "bc1qtest", challenge);
    await deleteChallenge(kv, "bc1qtest");

    const retrieved = await getChallenge(kv, "bc1qtest");
    expect(retrieved).toBeNull();
  });
});

describe("checkRateLimit", () => {
  it("allows request when no previous requests", async () => {
    const kv = createMockKV();
    const result = await checkRateLimit(kv, "192.168.1.1");
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });

  it("allows requests below limit", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    // Record 5 requests (limit is 6)
    for (let i = 0; i < 5; i++) {
      await recordRequest(kv, ip);
    }

    const result = await checkRateLimit(kv, ip);
    expect(result.allowed).toBe(true);
  });

  it("blocks requests at limit", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    // Record 6 requests (at limit)
    for (let i = 0; i < 6; i++) {
      await recordRequest(kv, ip);
    }

    const result = await checkRateLimit(kv, ip);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeDefined();
  });

  it("provides retryAfter when rate limited", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    for (let i = 0; i < 6; i++) {
      await recordRequest(kv, ip);
    }

    const result = await checkRateLimit(kv, ip);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(600); // 10 minutes max
  });

  it("filters out old timestamps", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    // Manually set old timestamps (11 minutes ago)
    const oldTimestamps = [Date.now() - 11 * 60 * 1000];
    await kv.put(`rate:challenge:${ip}`, JSON.stringify(oldTimestamps));

    const result = await checkRateLimit(kv, ip);
    expect(result.allowed).toBe(true);
  });

  it("uses correct key format", async () => {
    const kv = createMockKV();
    await checkRateLimit(kv, "192.168.1.1");
    expect(kv.get).toHaveBeenCalledWith("rate:challenge:192.168.1.1");
  });

  it("handles corrupted rate limit data", async () => {
    const kv = createMockKV();
    (kv.get as any).mockResolvedValue("invalid json");

    const result = await checkRateLimit(kv, "192.168.1.1");
    expect(result.allowed).toBe(true);
  });
});

describe("recordRequest", () => {
  it("records first request", async () => {
    const kv = createMockKV();
    await recordRequest(kv, "192.168.1.1");

    expect(kv.put).toHaveBeenCalledWith(
      "rate:challenge:192.168.1.1",
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it("appends to existing requests", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    await recordRequest(kv, ip);
    await recordRequest(kv, ip);

    const storedValue = (kv.put as any).mock.calls[1][1];
    const timestamps = JSON.parse(storedValue);
    expect(timestamps).toHaveLength(2);
  });

  it("filters out old timestamps when recording", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    // Manually set old timestamps
    const oldTimestamps = [Date.now() - 11 * 60 * 1000];
    await kv.put(`rate:challenge:${ip}`, JSON.stringify(oldTimestamps));

    await recordRequest(kv, ip);

    const storedValue = (kv.put as any).mock.calls[1][1];
    const timestamps = JSON.parse(storedValue);
    expect(timestamps).toHaveLength(1); // Only new one
  });

  it("stores TTL slightly longer than window", async () => {
    const kv = createMockKV();
    await recordRequest(kv, "192.168.1.1");

    expect(kv.put).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { expirationTtl: 660 } // 10 minutes + 60 seconds
    );
  });

  it("handles corrupted existing data", async () => {
    const kv = createMockKV();
    (kv.get as any).mockResolvedValue("invalid json");

    await recordRequest(kv, "192.168.1.1");

    const storedValue = (kv.put as any).mock.calls[0][1];
    const timestamps = JSON.parse(storedValue);
    expect(timestamps).toHaveLength(1);
  });
});

describe("rate limiting integration", () => {
  it("allows 6 requests then blocks the 7th", async () => {
    const kv = createMockKV();
    const ip = "192.168.1.1";

    // Make 6 requests
    for (let i = 0; i < 6; i++) {
      const result = await checkRateLimit(kv, ip);
      expect(result.allowed).toBe(true);
      await recordRequest(kv, ip);
    }

    // 7th request should be blocked
    const result = await checkRateLimit(kv, ip);
    expect(result.allowed).toBe(false);
  });

  it("different IPs have independent rate limits", async () => {
    const kv = createMockKV();

    // Max out IP 1
    for (let i = 0; i < 6; i++) {
      await recordRequest(kv, "192.168.1.1");
    }

    // IP 2 should still be allowed
    const result = await checkRateLimit(kv, "192.168.1.2");
    expect(result.allowed).toBe(true);
  });
});

describe("validateTaprootAddress", () => {
  it("accepts valid taproot address (bc1p)", () => {
    expect(validateTaprootAddress("bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr")).toBe(true);
  });

  it("accepts another valid taproot address", () => {
    expect(validateTaprootAddress("bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0")).toBe(true);
  });

  it("rejects SegWit v0 address (bc1q)", () => {
    expect(validateTaprootAddress("bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh")).toBe(false);
  });

  it("rejects legacy P2PKH address (1...)", () => {
    expect(validateTaprootAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf Na")).toBe(false);
  });

  it("rejects Stacks address", () => {
    expect(validateTaprootAddress("SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateTaprootAddress("")).toBe(false);
  });

  it("rejects uppercase bc1p (taproot is lowercase)", () => {
    expect(validateTaprootAddress("BC1P5CYXNUXMEUWUVKWFEM96LQZSZD02N6XDCJRS20CAC6YQJJWUDPXQKEDRCR")).toBe(false);
  });

  it("rejects too-short address", () => {
    expect(validateTaprootAddress("bc1p12345")).toBe(false);
  });
});

describe("executeAction: update-taproot", () => {
  // Minimal AgentRecord for testing
  const baseAgent = {
    stxAddress: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
    btcAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
    stxPublicKey: "03abc",
    btcPublicKey: "02abc",
    verifiedAt: "2026-01-01T00:00:00.000Z",
  };

  const validTaprootAddress = "bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr";

  it("updates taproot address and stores KV index", async () => {
    const kv = createMockKV();
    const result = await executeAction(
      "update-taproot",
      { taprootAddress: validTaprootAddress },
      baseAgent,
      kv
    );

    expect(result.success).toBe(true);
    expect(result.updated.taprootAddress).toBe(validTaprootAddress);
    expect(kv.put).toHaveBeenCalledWith(`taproot:${validTaprootAddress}`, baseAgent.btcAddress);
  });

  it("rejects missing taprootAddress param", async () => {
    const kv = createMockKV();
    const result = await executeAction("update-taproot", {}, baseAgent, kv);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Missing required parameter");
  });

  it("rejects invalid (non-bc1p) address", async () => {
    const kv = createMockKV();
    const result = await executeAction(
      "update-taproot",
      { taprootAddress: "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh" },
      baseAgent,
      kv
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid taproot address");
  });

  it("clears taproot address when empty string given", async () => {
    const kv = createMockKV();
    const agentWithTaproot = { ...baseAgent, taprootAddress: validTaprootAddress };
    const result = await executeAction(
      "update-taproot",
      { taprootAddress: "" },
      agentWithTaproot,
      kv
    );

    expect(result.success).toBe(true);
    expect(result.updated.taprootAddress).toBeNull();
    expect(kv.delete).toHaveBeenCalledWith(`taproot:${validTaprootAddress}`);
  });

  it("removes old KV index when taproot address changes", async () => {
    const kv = createMockKV();
    const oldTaproot = "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0";
    const agentWithTaproot = { ...baseAgent, taprootAddress: oldTaproot };

    const result = await executeAction(
      "update-taproot",
      { taprootAddress: validTaprootAddress },
      agentWithTaproot,
      kv
    );

    expect(result.success).toBe(true);
    expect(kv.delete).toHaveBeenCalledWith(`taproot:${oldTaproot}`);
    expect(kv.put).toHaveBeenCalledWith(`taproot:${validTaprootAddress}`, baseAgent.btcAddress);
  });

  it("rejects if taproot address already claimed by different agent", async () => {
    const kv = createMockKV();
    // Pre-populate KV with another agent claiming this taproot
    await kv.put(`taproot:${validTaprootAddress}`, "bc1qother");

    const result = await executeAction(
      "update-taproot",
      { taprootAddress: validTaprootAddress },
      baseAgent,
      kv
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("already claimed by another agent");
  });
});

describe("getAvailableActions", () => {
  it("includes update-taproot action", () => {
    const actions = getAvailableActions();
    const taprootAction = actions.find(a => a.name === "update-taproot");
    expect(taprootAction).toBeDefined();
  });

  it("update-taproot action has taprootAddress param", () => {
    const actions = getAvailableActions();
    const taprootAction = actions.find(a => a.name === "update-taproot");
    expect(taprootAction?.params).toHaveProperty("taprootAddress");
    expect(taprootAction?.params.taprootAddress.required).toBe(true);
  });

  it("includes all expected actions", () => {
    const actions = getAvailableActions();
    const names = actions.map(a => a.name);
    expect(names).toContain("update-description");
    expect(names).toContain("update-owner");
    expect(names).toContain("update-taproot");
  });
});
