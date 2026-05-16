import { describe, it, expect } from "vitest";
import {
  canonicalJSON,
  bodyHash,
  buildCreateMessage,
  buildSubmitMessage,
  buildAcceptMessage,
  buildPaidMessage,
  buildCancelMessage,
  isWithinSignatureWindow,
} from "../signatures";

describe("canonicalJSON", () => {
  it("sorts keys alphabetically", () => {
    expect(canonicalJSON({ b: 2, a: 1, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it("drops undefined values", () => {
    expect(canonicalJSON({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("keeps null values", () => {
    expect(canonicalJSON({ a: null, b: 1 })).toBe('{"a":null,"b":1}');
  });

  it("is deterministic regardless of insertion order", () => {
    expect(canonicalJSON({ z: 1, a: 2 })).toBe(canonicalJSON({ a: 2, z: 1 }));
  });
});

describe("bodyHash", () => {
  it("returns a 64-char lowercase hex string", () => {
    const h = bodyHash({ title: "x", body: "y" });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls", () => {
    expect(bodyHash({ a: 1, b: 2 })).toBe(bodyHash({ b: 2, a: 1 }));
  });

  it("changes when the payload changes", () => {
    expect(bodyHash({ a: 1 })).not.toBe(bodyHash({ a: 2 }));
  });
});

describe("message builders", () => {
  it("buildCreateMessage embeds all three fields", () => {
    const msg = buildCreateMessage({
      posterBtcAddress: "bc1qabc",
      bodyHash: "0123",
      signedAt: "2026-01-01T00:00:00Z",
    });
    expect(msg).toBe("AIBTC Bounty Create | bc1qabc | 0123 | 2026-01-01T00:00:00Z");
  });

  it("buildSubmitMessage embeds bountyId, submitter, bodyHash, signedAt", () => {
    const msg = buildSubmitMessage({
      bountyId: "B1",
      submitterBtcAddress: "bc1qsub",
      bodyHash: "abcd",
      signedAt: "T",
    });
    expect(msg).toBe("AIBTC Bounty Submit | B1 | bc1qsub | abcd | T");
  });

  it("buildAcceptMessage embeds bountyId, submissionId, signedAt", () => {
    expect(buildAcceptMessage({ bountyId: "B", submissionId: "S", signedAt: "T" })).toBe(
      "AIBTC Bounty Accept | B | S | T"
    );
  });

  it("buildPaidMessage embeds bountyId, txid, signedAt", () => {
    expect(buildPaidMessage({ bountyId: "B", txid: "0xABC", signedAt: "T" })).toBe(
      "AIBTC Bounty Paid | B | 0xABC | T"
    );
  });

  it("buildCancelMessage embeds bountyId and signedAt", () => {
    expect(buildCancelMessage({ bountyId: "B", signedAt: "T" })).toBe(
      "AIBTC Bounty Cancel | B | T"
    );
  });
});

describe("isWithinSignatureWindow", () => {
  const fixed = new Date("2026-05-14T12:00:00Z");

  it("accepts timestamps within window", () => {
    expect(isWithinSignatureWindow("2026-05-14T11:58:00Z", 300, fixed)).toBe(true);
    expect(isWithinSignatureWindow("2026-05-14T12:02:00Z", 300, fixed)).toBe(true);
  });

  it("rejects timestamps outside window", () => {
    expect(isWithinSignatureWindow("2026-05-14T11:50:00Z", 300, fixed)).toBe(false);
    expect(isWithinSignatureWindow("2026-05-14T12:10:00Z", 300, fixed)).toBe(false);
  });

  it("rejects malformed timestamps", () => {
    expect(isWithinSignatureWindow("not-a-date", 300, fixed)).toBe(false);
    expect(isWithinSignatureWindow("", 300, fixed)).toBe(false);
  });
});
