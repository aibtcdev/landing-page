import { describe, it, expect } from "vitest";
import { verifyInboxPayment, isRelayTimeout } from "../x402-verify";
import type { PaymentPayloadV2 } from "x402-stacks";
import { networkToCAIP2, X402_ERROR_CODES } from "x402-stacks";
import { getSBTCAsset } from "../x402-config";

describe("verifyInboxPayment", () => {
  const recipientStxAddress = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
  const network = "mainnet";
  const networkCAIP2 = networkToCAIP2(network);
  const expectedAsset = getSBTCAsset(network);

  describe("INVALID_TRANSACTION_FORMAT", () => {
    it("returns INVALID_TRANSACTION_FORMAT for raw hex string (not serialized tx)", async () => {
      // Raw hex "0x0030..." triggers TransactionVersion parse error
      // because byte 0x30 (ASCII '0') is not a valid TransactionVersion
      const payload = {
        payload: { transaction: "0030aabbccdd" },
        accepted: { asset: expectedAsset },
        resource: { url: `https://aibtc.com/api/inbox/test`, network: networkCAIP2 },
      } as unknown as PaymentPayloadV2;

      const result = await verifyInboxPayment(
        payload,
        recipientStxAddress,
        network,
        "https://fake-relay.test"
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_TRANSACTION_FORMAT");
      expect(result.error).toBe("Invalid payment transaction format");
    });

    it("returns INVALID_TRANSACTION_FORMAT for completely invalid data", async () => {
      const payload = {
        payload: { transaction: "not-a-transaction" },
        accepted: { asset: expectedAsset },
        resource: { url: `https://aibtc.com/api/inbox/test`, network: networkCAIP2 },
      } as unknown as PaymentPayloadV2;

      const result = await verifyInboxPayment(
        payload,
        recipientStxAddress,
        network,
        "https://fake-relay.test"
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_TRANSACTION_FORMAT");
    });

    it("returns INVALID_TRANSACTION_FORMAT for truncated transaction hex", async () => {
      // A single valid-looking byte prefix that's too short to be a real transaction
      const payload = {
        payload: { transaction: "0001" },
        accepted: { asset: expectedAsset },
        resource: { url: `https://aibtc.com/api/inbox/test`, network: networkCAIP2 },
      } as unknown as PaymentPayloadV2;

      const result = await verifyInboxPayment(
        payload,
        recipientStxAddress,
        network,
        "https://fake-relay.test"
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("INVALID_TRANSACTION_FORMAT");
    });
  });

  describe("sBTC-only validation", () => {
    it("rejects non-sBTC payment asset", async () => {
      const payload = {
        payload: { transaction: "some-tx" },
        accepted: { asset: "stx:mainnet/STX" },
        resource: { url: `https://aibtc.com/api/inbox/test`, network: networkCAIP2 },
      } as unknown as PaymentPayloadV2;

      const result = await verifyInboxPayment(
        payload,
        recipientStxAddress,
        network,
        "https://fake-relay.test"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Inbox messages require sBTC payment");
    });

    it("rejects missing transaction in payload", async () => {
      const payload = {
        payload: {},
        accepted: { asset: expectedAsset },
        resource: { url: `https://aibtc.com/api/inbox/test`, network: networkCAIP2 },
      } as unknown as PaymentPayloadV2;

      const result = await verifyInboxPayment(
        payload,
        recipientStxAddress,
        network,
        "https://fake-relay.test"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Inbox messages require sBTC payment");
    });
  });

  describe("accepted: undefined regression (#629)", () => {
    it("returns INVALID_PAYLOAD (not TypeError) when accepted field is absent", async () => {
      // Regression test for issue #629: pollers and some clients omit `accepted` entirely.
      // Before the fix, paymentPayload.accepted.asset threw:
      //   TypeError: Cannot read properties of undefined (reading 'asset')
      // After the fix, optional chaining returns undefined and the check rejects cleanly.
      const payload = {
        payload: { transaction: "0030aabbccdd" },
        // `accepted` deliberately absent
        resource: { url: `https://aibtc.com/api/inbox/test`, network: networkCAIP2 },
      } as unknown as PaymentPayloadV2;

      // Must not throw — must return a structured error result
      const result = await verifyInboxPayment(
        payload,
        recipientStxAddress,
        network,
        "https://fake-relay.test"
      );

      expect(result.success).toBe(false);
      // The sBTC-asset guard fires first (accepted?.asset is undefined !== expectedAsset)
      expect(result.error).toBe("Inbox messages require sBTC payment");
      expect(result.errorCode).toBe(X402_ERROR_CODES.INVALID_PAYLOAD);
    });
  });
});

describe("isRelayTimeout", () => {
  it("returns true for DOMException with TimeoutError name", () => {
    const error = new DOMException("The operation was aborted", "TimeoutError");
    expect(isRelayTimeout(error)).toBe(true);
  });

  it("returns false for TypeError (network failure)", () => {
    expect(isRelayTimeout(new TypeError("fetch failed"))).toBe(false);
  });

  it("returns false for DOMException with non-timeout name", () => {
    const error = new DOMException("Aborted", "AbortError");
    expect(isRelayTimeout(error)).toBe(false);
  });

  it("returns false for generic Error", () => {
    expect(isRelayTimeout(new Error("something broke"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isRelayTimeout("timeout")).toBe(false);
    expect(isRelayTimeout(null)).toBe(false);
    expect(isRelayTimeout(undefined)).toBe(false);
  });
});
