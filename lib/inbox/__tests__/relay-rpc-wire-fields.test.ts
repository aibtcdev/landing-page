/**
 * Tests for Phase 5.1 relay RPC wire-field extraction.
 *
 * The relay's `/sponsor` + RPC `submitPayment` responses surface four new
 * fields that the LP parsers must extract and propagate downstream:
 *   - `nonceExpiresAt`        (relay PR#379, success arm)
 *   - `sponsorNonceValidForMs` (relay PR#383, success arm)
 *   - `responsible`           (relay PR#381, error arm)
 *   - `agentErrorCode`        (relay PR#381, error arm when responsible="sender")
 *
 * These are NOT in `@aibtc/tx-schemas`'s `RpcSubmitPaymentResultSchema` yet
 * (which uses `z.core.$strip`), so the parsers extract them BEFORE the zod
 * parse and re-attach after.  Backward compat: an older relay version that
 * omits these fields must continue to parse without error.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __testUtils, submitViaRPC } from "../relay-rpc";
import type { RelayRPC, RelaySettleOptions } from "../relay-rpc";
import type { Logger } from "@/lib/logging";

const mockLogger: Logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

const baseTxHex = "aabbccdd112233445566778899001122334455667788990011223344556677889900";
const baseSettle: RelaySettleOptions = {
  expectedRecipient: "SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7",
  minAmount: "100",
  tokenType: "sBTC",
};

const FUTURE_ISO = "2027-01-01T00:00:00.000Z";

describe("extractRelayWireExtras", () => {
  const { extractRelayWireExtras } = __testUtils;

  it("returns empty object for non-object input", () => {
    expect(extractRelayWireExtras(null)).toEqual({});
    expect(extractRelayWireExtras(undefined)).toEqual({});
    expect(extractRelayWireExtras("string")).toEqual({});
    expect(extractRelayWireExtras(42)).toEqual({});
  });

  it("extracts nonceExpiresAt when present and string", () => {
    expect(extractRelayWireExtras({ nonceExpiresAt: FUTURE_ISO })).toEqual({
      nonceExpiresAt: FUTURE_ISO,
    });
  });

  it("ignores nonceExpiresAt when not a non-empty string", () => {
    expect(extractRelayWireExtras({ nonceExpiresAt: "" })).toEqual({});
    expect(extractRelayWireExtras({ nonceExpiresAt: 1234 })).toEqual({});
    expect(extractRelayWireExtras({ nonceExpiresAt: null })).toEqual({});
  });

  it("extracts sponsorNonceValidForMs when present and finite number", () => {
    expect(extractRelayWireExtras({ sponsorNonceValidForMs: 600_000 })).toEqual({
      sponsorNonceValidForMs: 600_000,
    });
  });

  it("ignores sponsorNonceValidForMs when not a finite number", () => {
    expect(extractRelayWireExtras({ sponsorNonceValidForMs: "600000" })).toEqual({});
    expect(extractRelayWireExtras({ sponsorNonceValidForMs: NaN })).toEqual({});
    expect(extractRelayWireExtras({ sponsorNonceValidForMs: Infinity })).toEqual({});
  });

  it("extracts responsible when one of sender|sponsor|network", () => {
    expect(extractRelayWireExtras({ responsible: "sender" })).toEqual({ responsible: "sender" });
    expect(extractRelayWireExtras({ responsible: "sponsor" })).toEqual({ responsible: "sponsor" });
    expect(extractRelayWireExtras({ responsible: "network" })).toEqual({ responsible: "network" });
  });

  it("ignores responsible for unrecognized values", () => {
    expect(extractRelayWireExtras({ responsible: "bogus" })).toEqual({});
    expect(extractRelayWireExtras({ responsible: 1 })).toEqual({});
  });

  it("extracts agentErrorCode when non-empty string", () => {
    expect(extractRelayWireExtras({ agentErrorCode: "sender_nonce_confirmed" })).toEqual({
      agentErrorCode: "sender_nonce_confirmed",
    });
  });

  it("ignores agentErrorCode when empty or non-string", () => {
    expect(extractRelayWireExtras({ agentErrorCode: "" })).toEqual({});
    expect(extractRelayWireExtras({ agentErrorCode: null })).toEqual({});
  });

  it("extracts all four fields from a single object", () => {
    expect(
      extractRelayWireExtras({
        nonceExpiresAt: FUTURE_ISO,
        sponsorNonceValidForMs: 600_000,
        responsible: "sender",
        agentErrorCode: "sender_nonce_confirmed",
      })
    ).toEqual({
      nonceExpiresAt: FUTURE_ISO,
      sponsorNonceValidForMs: 600_000,
      responsible: "sender",
      agentErrorCode: "sender_nonce_confirmed",
    });
  });
});

describe("parseSubmitPaymentResult — success arm", () => {
  const { parseSubmitPaymentResult } = __testUtils;

  it("extracts nonceExpiresAt + sponsorNonceValidForMs on accepted+all-fields", () => {
    const result = parseSubmitPaymentResult({
      accepted: true,
      paymentId: "pay_001",
      status: "queued",
      checkStatusUrl: "https://relay/check/pay_001",
      nonceExpiresAt: FUTURE_ISO,
      sponsorNonceValidForMs: 600_000,
    });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.paymentId).toBe("pay_001");
      expect(result.nonceExpiresAt).toBe(FUTURE_ISO);
      expect(result.sponsorNonceValidForMs).toBe(600_000);
    }
  });

  it("backward compat: accepted+missing wire fields → fields undefined", () => {
    const result = parseSubmitPaymentResult({
      accepted: true,
      paymentId: "pay_002",
      status: "queued",
    });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.paymentId).toBe("pay_002");
      expect(result.nonceExpiresAt).toBeUndefined();
      expect(result.sponsorNonceValidForMs).toBeUndefined();
    }
  });

  it("preserves wire fields on the pre-paymentId success short-circuit", () => {
    // This is the legacy shape: accepted=true but paymentId is not a string —
    // the parser short-circuits with a synthesized 'queued' result.  Wire
    // fields must still be surfaced for staging code that needs the TTL.
    const result = parseSubmitPaymentResult({
      accepted: true,
      // paymentId omitted (the early-return branch)
      checkStatusUrl: "https://relay/check/no-id",
      nonceExpiresAt: FUTURE_ISO,
      sponsorNonceValidForMs: 600_000,
    });
    expect(result.accepted).toBe(true);
    if (result.accepted) {
      expect(result.checkStatusUrl).toBe("https://relay/check/no-id");
      expect(result.nonceExpiresAt).toBe(FUTURE_ISO);
      expect(result.sponsorNonceValidForMs).toBe(600_000);
    }
  });
});

describe("parseSubmitPaymentResult — error arm", () => {
  const { parseSubmitPaymentResult } = __testUtils;

  it("extracts responsible + agentErrorCode on rejected+responsible=sender", () => {
    const result = parseSubmitPaymentResult({
      accepted: false,
      error: "Sender nonce already confirmed on chain",
      code: "SENDER_NONCE_STALE",
      responsible: "sender",
      agentErrorCode: "sender_nonce_confirmed",
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.code).toBe("SENDER_NONCE_STALE");
      expect(result.responsible).toBe("sender");
      expect(result.agentErrorCode).toBe("sender_nonce_confirmed");
    }
  });

  it("extracts responsible on rejected+responsible=sponsor (no agentErrorCode)", () => {
    const result = parseSubmitPaymentResult({
      accepted: false,
      error: "Sponsor nonce conflict",
      code: "INTERNAL_ERROR",
      responsible: "sponsor",
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.responsible).toBe("sponsor");
      expect(result.agentErrorCode).toBeUndefined();
    }
  });

  it("extracts responsible on rejected+responsible=network", () => {
    const result = parseSubmitPaymentResult({
      accepted: false,
      error: "Mempool rate limited",
      code: "BROADCAST_RATE_LIMITED",
      responsible: "network",
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.responsible).toBe("network");
      expect(result.agentErrorCode).toBeUndefined();
    }
  });

  it("backward compat: rejected without attribution fields parses cleanly", () => {
    const result = parseSubmitPaymentResult({
      accepted: false,
      error: "Some pre-Phase-1 relay rejection",
      code: "SENDER_NONCE_STALE",
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.code).toBe("SENDER_NONCE_STALE");
      expect(result.responsible).toBeUndefined();
      expect(result.agentErrorCode).toBeUndefined();
    }
  });

  it("backward compat: rejected without error field synthesizes default and preserves extras", () => {
    const result = parseSubmitPaymentResult({
      accepted: false,
      code: "INTERNAL_ERROR",
      responsible: "sponsor",
    });
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.error).toBe("Payment submission rejected by relay");
      expect(result.responsible).toBe("sponsor");
    }
  });
});

describe("parseCheckPaymentResult — wire-field extraction", () => {
  const { parseCheckPaymentResult } = __testUtils;

  it("extracts nonceExpiresAt + sponsorNonceValidForMs from check response", () => {
    const result = parseCheckPaymentResult({
      paymentId: "pay_check_001",
      status: "queued",
      nonceExpiresAt: FUTURE_ISO,
      sponsorNonceValidForMs: 600_000,
    });
    expect(result.paymentId).toBe("pay_check_001");
    expect(result.nonceExpiresAt).toBe(FUTURE_ISO);
    expect(result.sponsorNonceValidForMs).toBe(600_000);
  });

  it("extracts responsible + agentErrorCode from failed check arm", () => {
    const result = parseCheckPaymentResult({
      paymentId: "pay_check_002",
      status: "failed",
      errorCode: "BROADCAST_FAILED",
      error: "tx rejected by mempool",
      responsible: "sender",
      agentErrorCode: "sender_nonce_confirmed",
    });
    expect(result.status).toBe("failed");
    expect(result.responsible).toBe("sender");
    expect(result.agentErrorCode).toBe("sender_nonce_confirmed");
  });

  it("backward compat: check response without wire fields parses cleanly", () => {
    const result = parseCheckPaymentResult({
      paymentId: "pay_check_003",
      status: "confirmed",
      txid: "a".repeat(64),
    });
    expect(result.status).toBe("confirmed");
    expect(result.nonceExpiresAt).toBeUndefined();
    expect(result.responsible).toBeUndefined();
  });
});

describe("submitViaRPC — propagates wire fields to InboxPaymentVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("propagates nonceExpiresAt + sponsorNonceValidForMs on pending-success (poll exhausted)", async () => {
    const rpc: RelayRPC = {
      submitPayment: vi.fn().mockResolvedValue({
        accepted: true,
        paymentId: "pay_pending_001",
        status: "queued",
        nonceExpiresAt: FUTURE_ISO,
        sponsorNonceValidForMs: 600_000,
      }),
      // checkPayment always returns 'queued' so poll exhausts and we hit
      // the pending-success arm.
      checkPayment: vi.fn().mockResolvedValue({
        paymentId: "pay_pending_001",
        status: "queued",
      }),
    };

    const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.paymentStatus).toBe("pending");
    expect(result.nonceExpiresAt).toBe(FUTURE_ISO);
    expect(result.sponsorNonceValidForMs).toBe(600_000);
  });

  it("propagates responsible + agentErrorCode on submitPayment rejection", async () => {
    const rpc: RelayRPC = {
      submitPayment: vi.fn().mockResolvedValue({
        accepted: false,
        error: "Sender nonce already confirmed on chain",
        code: "SENDER_NONCE_STALE",
        responsible: "sender",
        agentErrorCode: "sender_nonce_confirmed",
      }),
      checkPayment: vi.fn(),
    };

    const result = await submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("SENDER_NONCE_STALE");
    expect(result.responsible).toBe("sender");
    expect(result.agentErrorCode).toBe("sender_nonce_confirmed");
    expect(rpc.checkPayment).not.toHaveBeenCalled();
  });

  it("propagates nonceExpiresAt + sponsorNonceValidForMs on confirmed-success", async () => {
    const rpc: RelayRPC = {
      submitPayment: vi.fn().mockResolvedValue({
        accepted: true,
        paymentId: "pay_confirmed_001",
        status: "queued",
        nonceExpiresAt: FUTURE_ISO,
        sponsorNonceValidForMs: 600_000,
      }),
      checkPayment: vi.fn().mockResolvedValue({
        paymentId: "pay_confirmed_001",
        status: "confirmed",
        txid: "a".repeat(64),
      }),
    };

    const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.paymentStatus).toBe("confirmed");
    expect(result.nonceExpiresAt).toBe(FUTURE_ISO);
    expect(result.sponsorNonceValidForMs).toBe(600_000);
  });

  it("propagates responsible + agentErrorCode on terminal failure (checkPayment status=failed)", async () => {
    const rpc: RelayRPC = {
      submitPayment: vi.fn().mockResolvedValue({
        accepted: true,
        paymentId: "pay_fail_attrib_001",
        status: "queued",
      }),
      checkPayment: vi.fn().mockResolvedValue({
        paymentId: "pay_fail_attrib_001",
        status: "failed",
        errorCode: "BROADCAST_FAILED",
        error: "tx rejected by mempool",
        responsible: "sender",
        agentErrorCode: "sender_nonce_confirmed",
      }),
    };

    const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe("BROADCAST_FAILED");
    expect(result.responsible).toBe("sender");
    expect(result.agentErrorCode).toBe("sender_nonce_confirmed");
  });

  it("backward compat: relay omitting wire fields → result has undefined extras, no parse error", async () => {
    const rpc: RelayRPC = {
      submitPayment: vi.fn().mockResolvedValue({
        accepted: true,
        paymentId: "pay_legacy_001",
        status: "queued",
      }),
      checkPayment: vi.fn().mockResolvedValue({
        paymentId: "pay_legacy_001",
        status: "confirmed",
        txid: "b".repeat(64),
      }),
    };

    const resultPromise = submitViaRPC(rpc, baseTxHex, baseSettle, mockLogger);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.paymentStatus).toBe("confirmed");
    expect(result.nonceExpiresAt).toBeUndefined();
    expect(result.sponsorNonceValidForMs).toBeUndefined();
    expect(result.responsible).toBeUndefined();
    expect(result.agentErrorCode).toBeUndefined();
  });
});
