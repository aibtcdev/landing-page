import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentPayloadV2 } from "x402-stacks";
import { verifyInboxPayment } from "../x402-verify";
import type { RelayRPC } from "../relay-rpc";
import { getSBTCAsset } from "../x402-config";
import { networkToCAIP2 } from "x402-stacks";
import { createMockKVWithOptions } from "./kv-mock";

vi.mock("@stacks/transactions", () => ({
  AuthType: { Sponsored: 1 },
  StacksWireType: { Address: "address" },
  deserializeTransaction: vi.fn(() => ({
    auth: {
      authType: 1,
      spendingCondition: {
        hashMode: 0,
        signer: "00".repeat(20),
        nonce: BigInt(42),
      },
    },
  })),
  addressHashModeToVersion: vi.fn(() => 22),
  addressToString: vi.fn(() => "SP2SENDERTESTADDRESS"),
}));

describe("verifyInboxPayment sponsored (RPC sponsorPayment)", () => {
  const recipientStxAddress = "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7";
  const network = "mainnet";
  const payload = {
    payload: { transaction: "00" },
    accepted: { asset: getSBTCAsset(network) },
    resource: {
      url: "https://aibtc.com/api/inbox/bc1recipient",
      network: networkToCAIP2(network),
    },
  } as unknown as PaymentPayloadV2;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sponsors through the binding and returns the txid and payer", async () => {
    const sponsorPayment = vi.fn().mockResolvedValue({
      success: true, txid: "ab".repeat(32), payer: "SP2SENDERTESTADDRESS", fee: "3000",
    });
    const relayRPC = { sponsorPayment } as unknown as RelayRPC;

    const result = await verifyInboxPayment(
      payload, recipientStxAddress, network, "https://relay.example", undefined, undefined, relayRPC
    );

    expect(sponsorPayment).toHaveBeenCalledWith("00", {
      expectedRecipient: recipientStxAddress,
      minAmount: expect.any(String),
      tokenType: "sBTC",
    });
    expect(result).toMatchObject({ success: true, payerStxAddress: "SP2SENDERTESTADDRESS", paymentTxid: "ab".repeat(32) });
  });

  it("maps a relay refusal to a typed error without counting it as a relay failure", async () => {
    const limit = vi.fn().mockResolvedValue({ success: true });
    const cfEnv = { RATE_LIMIT_RELAY_FAILURES: { limit } } as unknown as CloudflareEnv;
    const relayRPC = {
      sponsorPayment: vi.fn().mockResolvedValue({
        success: false, code: "RATE_LIMITED", error: "Too many sponsored payments", retryable: true,
      }),
    } as unknown as RelayRPC;

    const result = await verifyInboxPayment(
      payload, recipientStxAddress, network, "https://relay.example", undefined, undefined, relayRPC, undefined, cfEnv
    );

    expect(result).toMatchObject({ success: false, errorCode: "RATE_LIMITED", relayCode: "RATE_LIMITED" });
    expect(limit).not.toHaveBeenCalled();
  });

  it("counts a sponsored broadcast failure toward the relay circuit breaker", async () => {
    const { kv } = createMockKVWithOptions();
    const limit = vi.fn().mockResolvedValue({ success: true });
    const cfEnv = { RATE_LIMIT_RELAY_FAILURES: { limit } } as unknown as CloudflareEnv;
    const relayRPC = {
      sponsorPayment: vi.fn().mockResolvedValue({
        success: false, code: "BROADCAST_FAILED", error: "node unreachable", retryable: true,
      }),
    } as unknown as RelayRPC;

    const result = await verifyInboxPayment(
      payload, recipientStxAddress, network, "https://relay.example", undefined, kv, relayRPC, undefined, cfEnv
    );

    expect(result).toMatchObject({ success: false, errorCode: "BROADCAST_FAILED" });
    expect(limit).toHaveBeenCalledWith({ key: "relay-failures" });
  });

  it("refuses sponsored payments when the relay binding is missing", async () => {
    const result = await verifyInboxPayment(payload, recipientStxAddress, network, "https://relay.example");
    expect(result).toMatchObject({ success: false, errorCode: "RELAY_ERROR" });
  });
});
