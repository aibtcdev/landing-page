import { describe, it, expect, beforeEach } from "vitest";
import { getCachedPaymentFailure, cachePaymentFailure } from "../payment-cache";
import type { PaymentFailureCache } from "../types";
import {
  PAYMENT_FAILURE_CACHE_PREFIX,
  PAYMENT_FAILURE_CACHE_TTL_SECONDS,
} from "../constants";
import {
  createMockKV,
  createMockKVWithOptions,
  createThrowingKV,
} from "./kv-mock";

describe("getCachedPaymentFailure", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("returns null on cache miss (empty KV)", async () => {
    const result = await getCachedPaymentFailure(kv, "SP1SENDER");
    expect(result).toBeNull();
  });

  it("returns cached record on cache hit", async () => {
    const senderStxAddress = "SP1SENDER123";
    const errorCode = "INSUFFICIENT_FUNDS";
    const cachedAt = new Date().toISOString();
    const record: PaymentFailureCache = { senderStxAddress, errorCode, cachedAt };

    const key = `${PAYMENT_FAILURE_CACHE_PREFIX}${senderStxAddress}`;
    await (kv as unknown as { put: (k: string, v: string) => Promise<void> }).put(key, JSON.stringify(record));

    const result = await getCachedPaymentFailure(kv, senderStxAddress);

    expect(result).not.toBeNull();
    expect(result?.senderStxAddress).toBe(senderStxAddress);
    expect(result?.errorCode).toBe(errorCode);
    expect(result?.cachedAt).toBe(cachedAt);
  });

  it("returns null on KV read error (fail-open)", async () => {
    const throwingKV = createThrowingKV();
    // Should not throw — fail open
    const result = await getCachedPaymentFailure(throwingKV, "SP1SENDER");
    expect(result).toBeNull();
  });

  it("returns null for malformed JSON (fail-open)", async () => {
    const senderStxAddress = "SP1MALFORMED";
    const key = `${PAYMENT_FAILURE_CACHE_PREFIX}${senderStxAddress}`;
    await (kv as unknown as { put: (k: string, v: string) => Promise<void> }).put(key, "not-valid-json{{{");

    const result = await getCachedPaymentFailure(kv, senderStxAddress);
    expect(result).toBeNull();
  });

  it("uses the correct KV key prefix", async () => {
    const senderStxAddress = "SP2KEYCHECK";
    const errorCode = "INSUFFICIENT_FUNDS";
    const record: PaymentFailureCache = {
      senderStxAddress,
      errorCode,
      cachedAt: new Date().toISOString(),
    };

    // Write with explicit key to confirm prefix
    const expectedKey = `${PAYMENT_FAILURE_CACHE_PREFIX}${senderStxAddress}`;
    await (kv as unknown as { put: (k: string, v: string) => Promise<void> }).put(
      expectedKey,
      JSON.stringify(record)
    );

    // getCachedPaymentFailure must construct the same key
    const result = await getCachedPaymentFailure(kv, senderStxAddress);
    expect(result).not.toBeNull();
    expect(result?.senderStxAddress).toBe(senderStxAddress);
  });
});

describe("cachePaymentFailure", () => {
  it("writes PaymentFailureCache with correct fields", async () => {
    const kv = createMockKV();
    const senderStxAddress = "SP1WRITER";
    const errorCode = "INSUFFICIENT_FUNDS";

    await cachePaymentFailure(kv, senderStxAddress, errorCode);

    const result = await getCachedPaymentFailure(kv, senderStxAddress);
    expect(result).not.toBeNull();
    expect(result?.senderStxAddress).toBe(senderStxAddress);
    expect(result?.errorCode).toBe(errorCode);
    expect(result?.cachedAt).toBeDefined();
    // cachedAt should be a valid ISO timestamp
    expect(() => new Date(result!.cachedAt)).not.toThrow();
  });

  it("writes with correct TTL (expirationTtl)", async () => {
    const { kv, putCalls } = createMockKVWithOptions();
    const senderStxAddress = "SP1TTLCHECK";

    await cachePaymentFailure(kv, senderStxAddress, "INSUFFICIENT_FUNDS");

    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].options?.expirationTtl).toBe(PAYMENT_FAILURE_CACHE_TTL_SECONDS);
  });

  it("writes to the correct KV key", async () => {
    const { kv, putCalls } = createMockKVWithOptions();
    const senderStxAddress = "SP1KEYTEST";

    await cachePaymentFailure(kv, senderStxAddress, "INSUFFICIENT_FUNDS");

    const expectedKey = `${PAYMENT_FAILURE_CACHE_PREFIX}${senderStxAddress}`;
    expect(putCalls[0].key).toBe(expectedKey);
  });

  it("silently swallows KV write errors (fail-open)", async () => {
    const throwingKV = createThrowingKV();
    // Should not throw
    await expect(
      cachePaymentFailure(throwingKV, "SP1THROW", "INSUFFICIENT_FUNDS")
    ).resolves.toBeUndefined();
  });

  it("overwrites an existing entry on second write", async () => {
    const { kv, putCalls } = createMockKVWithOptions();
    const senderStxAddress = "SP1OVERWRITE";

    await cachePaymentFailure(kv, senderStxAddress, "INSUFFICIENT_FUNDS");
    await cachePaymentFailure(kv, senderStxAddress, "INSUFFICIENT_FUNDS");

    // Both writes should complete without error
    expect(putCalls).toHaveLength(2);
    // Latest entry is readable
    const result = await getCachedPaymentFailure(kv, senderStxAddress);
    expect(result).not.toBeNull();
  });
});

describe("payment failure cache integration", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("miss then write then hit flow", async () => {
    const senderStxAddress = "SP1INTEGRATION";
    const errorCode = "INSUFFICIENT_FUNDS";

    // Cold cache — miss
    const miss = await getCachedPaymentFailure(kv, senderStxAddress);
    expect(miss).toBeNull();

    // Write cache entry
    await cachePaymentFailure(kv, senderStxAddress, errorCode);

    // Warm cache — hit
    const hit = await getCachedPaymentFailure(kv, senderStxAddress);
    expect(hit).not.toBeNull();
    expect(hit?.errorCode).toBe(errorCode);
  });

  it("cached errorCode matches what was written", async () => {
    const senderStxAddress = "SP1ERRCODE";
    const errorCode = "INSUFFICIENT_FUNDS";

    await cachePaymentFailure(kv, senderStxAddress, errorCode);
    const result = await getCachedPaymentFailure(kv, senderStxAddress);

    expect(result?.errorCode).toBe(errorCode);
  });

  it("different senders have independent cache entries", async () => {
    const sender1 = "SP1SENDERONE";
    const sender2 = "SP2SENDERTWO";

    await cachePaymentFailure(kv, sender1, "INSUFFICIENT_FUNDS");

    // sender1 has a cache hit
    const hit1 = await getCachedPaymentFailure(kv, sender1);
    expect(hit1).not.toBeNull();

    // sender2 has no entry
    const miss2 = await getCachedPaymentFailure(kv, sender2);
    expect(miss2).toBeNull();
  });
});
