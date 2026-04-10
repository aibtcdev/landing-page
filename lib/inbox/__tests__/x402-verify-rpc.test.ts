import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentPayloadV2 } from "x402-stacks";
import { verifyInboxPayment } from "../x402-verify";
import type { RelayRPC } from "../relay-rpc";
import { getSBTCAsset } from "../x402-config";
import { networkToCAIP2 } from "x402-stacks";
import { createMockKVWithOptions } from "./kv-mock";

const mocks = vi.hoisted(() => ({
  submitViaRPC: vi.fn(),
}));

vi.mock("../relay-rpc", async () => {
  const actual = await vi.importActual<typeof import("../relay-rpc")>("../relay-rpc");
  return {
    ...actual,
    submitViaRPC: mocks.submitViaRPC,
  };
});

vi.mock("@stacks/transactions", () => ({
  AuthType: { Sponsored: 1 },
  StacksWireType: { Address: "address" },
  deserializeTransaction: vi.fn(() => ({
    auth: {
      authType: 1,
      spendingCondition: {
        hashMode: 0,
        signer: "00".repeat(20),
      },
    },
  })),
  addressHashModeToVersion: vi.fn(() => 22),
  addressToString: vi.fn(() => "SP2SENDERTESTADDRESS"),
}));

describe("verifyInboxPayment RPC contract", () => {
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

  it("preserves relay-owned paymentId and canonical checkStatusUrl from the RPC path", async () => {
    mocks.submitViaRPC.mockResolvedValue({
      success: true,
      paymentStatus: "pending",
      paymentId: "pay_rpc_hint_case",
      checkStatusUrl: "https://relay.example/check/pay_rpc_hint_case",
    });

    const relayRPC = {} as RelayRPC;
    const result = await verifyInboxPayment(
      payload,
      recipientStxAddress,
      network,
      "https://relay.example",
      undefined,
      undefined,
      relayRPC
    );

    expect(result).toMatchObject({
      success: true,
      paymentStatus: "pending",
      paymentId: "pay_rpc_hint_case",
      checkStatusUrl: "https://relay.example/check/pay_rpc_hint_case",
    });
  });

  it("counts missing canonical identity as a relay failure for breaker accounting", async () => {
    const { kv, store } = createMockKVWithOptions();
    mocks.submitViaRPC.mockResolvedValue({
      success: false,
      errorCode: "MISSING_CANONICAL_IDENTITY",
      error: "Relay accepted payment but did not return a canonical payment identity",
    });

    const relayRPC = {} as RelayRPC;
    const result = await verifyInboxPayment(
      payload,
      recipientStxAddress,
      network,
      "https://relay.example",
      undefined,
      kv,
      relayRPC
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("MISSING_CANONICAL_IDENTITY");
    expect(store.get("inbox:relay:circuit-breaker:count")).toBe("1");
  });
});
