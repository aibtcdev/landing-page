import { describe, it, expect } from "vitest";
import {
  buildCreateMessage,
  buildSubmitMessage,
  buildAcceptMessage,
  buildPaidMessage,
  buildCancelMessage,
  isWithinSignatureWindow,
} from "../signatures";

describe("message builders", () => {
  it("buildCreateMessage embeds all body fields and signedAt", () => {
    const msg = buildCreateMessage({
      posterBtcAddress: "bc1qabc",
      title: "Add Spanish translation",
      description: "Translate the agent registration page.",
      rewardSats: 5000,
      expiresAt: "2026-06-01T00:00:00Z",
      tags: ["translation", "ux"],
      signedAt: "2026-01-01T00:00:00Z",
    });
    expect(msg).toBe(
      "AIBTC Bounty Create | bc1qabc | Add Spanish translation | Translate the agent registration page. | 5000 | 2026-06-01T00:00:00Z | translation,ux | 2026-01-01T00:00:00Z"
    );
  });

  it("buildCreateMessage emits empty tags segment when tags omitted", () => {
    const msg = buildCreateMessage({
      posterBtcAddress: "bc1qabc",
      title: "T",
      description: "D",
      rewardSats: 1,
      expiresAt: "X",
      signedAt: "Y",
    });
    expect(msg).toBe("AIBTC Bounty Create | bc1qabc | T | D | 1 | X |  | Y");
  });

  it("buildSubmitMessage embeds full submission body", () => {
    const msg = buildSubmitMessage({
      bountyId: "B1",
      submitterBtcAddress: "bc1qsub",
      message: "Here is my work",
      contentUrl: "https://example.com/pr/42",
      signedAt: "T",
    });
    expect(msg).toBe(
      "AIBTC Bounty Submit | B1 | bc1qsub | Here is my work | https://example.com/pr/42 | T"
    );
  });

  it("buildSubmitMessage emits empty contentUrl segment when omitted", () => {
    const msg = buildSubmitMessage({
      bountyId: "B1",
      submitterBtcAddress: "bc1qsub",
      message: "msg",
      signedAt: "T",
    });
    expect(msg).toBe("AIBTC Bounty Submit | B1 | bc1qsub | msg |  | T");
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
