/**
 * Tests for lib/competition/chainhook.ts
 *
 * Phase 3.1 PR-C — payload parsing + HMAC signature verification.
 */

import { describe, it, expect } from "vitest";
import {
  parseChainhookPayload,
  computeChainhookSignature,
  extractChainhookSignature,
  verifyChainhookSignature,
} from "../chainhook";

const TXID = "0x46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4";
const TXID_BARE = "46bc5587ae56e5bd4453daa2bf63c2a9e0414953fd21a82eb44f2f926f0ee0e4";

describe("parseChainhookPayload", () => {
  it("rejects null / non-object payload", () => {
    expect(parseChainhookPayload(null).ok).toBe(false);
    expect(parseChainhookPayload(42).ok).toBe(false);
    expect(parseChainhookPayload("foo").ok).toBe(false);
  });

  it("rejects payload missing `apply`", () => {
    const r = parseChainhookPayload({ rollback: [] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/apply/);
  });

  it("rejects `apply` that is not an array", () => {
    const r = parseChainhookPayload({ apply: "not-array" });
    expect(r.ok).toBe(false);
  });

  it("extracts txids from entry-level `txid`", () => {
    const r = parseChainhookPayload({ apply: [{ txid: TXID }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txids).toEqual([TXID]);
  });

  it("extracts txids from nested transaction_identifier.hash (Hiro shape)", () => {
    const r = parseChainhookPayload({
      apply: [
        { transaction: { transaction_identifier: { hash: TXID } } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txids).toEqual([TXID]);
  });

  it("normalizes bare-hex txids to 0x-prefixed", () => {
    const r = parseChainhookPayload({ apply: [{ txid: TXID_BARE }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txids).toEqual([TXID]);
  });

  it("dedupes repeated txids in a batch", () => {
    const r = parseChainhookPayload({
      apply: [
        { txid: TXID },
        { txid: TXID },
        { transaction: { transaction_identifier: { hash: TXID } } },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txids).toEqual([TXID]);
  });

  it("ignores malformed entries (no hash anywhere) without rejecting the whole batch", () => {
    const r = parseChainhookPayload({
      apply: [
        { txid: TXID },
        { foo: "bar" },
        { transaction: {} },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txids).toEqual([TXID]);
  });

  it("returns empty txid list for empty apply array (200, no inserts downstream)", () => {
    const r = parseChainhookPayload({ apply: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.txids).toEqual([]);
  });
});

describe("extractChainhookSignature", () => {
  it("prefers X-Chainhook-Signature when both headers are present", () => {
    const h = new Headers({
      "x-chainhook-signature": "ABC123",
      authorization: "Bearer DEF456",
    });
    expect(extractChainhookSignature(h)).toBe("abc123");
  });

  it("falls back to Authorization: Bearer …", () => {
    const h = new Headers({ authorization: "Bearer FACE" });
    expect(extractChainhookSignature(h)).toBe("face");
  });

  it("returns null when no signature header is present", () => {
    const h = new Headers({ "content-type": "application/json" });
    expect(extractChainhookSignature(h)).toBeNull();
  });

  it("returns null on non-Bearer Authorization scheme", () => {
    const h = new Headers({ authorization: "Basic abc123" });
    expect(extractChainhookSignature(h)).toBeNull();
  });
});

describe("verifyChainhookSignature", () => {
  it("returns true when the signature matches the body+secret HMAC", async () => {
    const body = JSON.stringify({ apply: [] });
    const secret = "test-secret-key";
    const sig = await computeChainhookSignature(body, secret);
    expect(await verifyChainhookSignature(body, sig, secret)).toBe(true);
  });

  it("returns false when the signature is wrong", async () => {
    const body = JSON.stringify({ apply: [] });
    const secret = "test-secret-key";
    const sig = await computeChainhookSignature("DIFFERENT BODY", secret);
    expect(await verifyChainhookSignature(body, sig, secret)).toBe(false);
  });

  it("returns false when the secret is wrong (attacker has body but not secret)", async () => {
    const body = JSON.stringify({ apply: [] });
    const sig = await computeChainhookSignature(body, "right-secret");
    expect(await verifyChainhookSignature(body, sig, "wrong-secret")).toBe(false);
  });

  it("is case-insensitive on the signature hex (lowercases on input via extract)", async () => {
    // verifyChainhookSignature itself does case-sensitive compare on the hex;
    // upstream extraction lowercases. We assert the contract by lowercasing here.
    const body = JSON.stringify({ apply: [] });
    const secret = "test-secret-key";
    const sig = (await computeChainhookSignature(body, secret)).toUpperCase();
    expect(await verifyChainhookSignature(body, sig, secret)).toBe(false);
    expect(await verifyChainhookSignature(body, sig.toLowerCase(), secret)).toBe(true);
  });
});
