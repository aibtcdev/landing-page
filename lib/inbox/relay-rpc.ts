/**
 * RPC type definitions for the X402_RELAY service binding.
 *
 * These interfaces match the RelayRPC WorkerEntrypoint exposed by the
 * x402-sponsor-relay worker (x402Stacks/x402-sponsor-relay). Phase 2
 * will use these types when replacing the HTTP fetch path in
 * verifyInboxPayment() with submitPayment() + checkPayment() RPC calls.
 */

/** Parameters for RelayRPC.submitPayment() */
export interface RelaySubmitParams {
  transaction: string;          // hex-serialized Stacks transaction
  maxTimeoutSeconds?: number;   // optional polling limit for the relay
  settle?: {
    expectedRecipient: string;
    minAmount: string;
    tokenType: string;
  };
}

/** Response from RelayRPC.submitPayment() */
export interface RelaySubmitResult {
  paymentId: string;
  status: "queued" | "rejected";
  error?: string;
  code?: string;               // e.g. SENDER_NONCE_STALE
  retryAfter?: number;
}

/** Response from RelayRPC.checkPayment() */
export interface RelayCheckResult {
  paymentId: string;
  status: "queued" | "processing" | "confirmed" | "failed" | "timeout";
  txid?: string;
  receiptId?: string;
  error?: string;
  code?: string;
  settlement?: {
    status: string;
    sender?: string;
    recipient?: string;
    amount?: string;
  };
}

/** Typed interface for the X402_RELAY service binding RPC methods. */
export interface RelayRPC {
  submitPayment(params: RelaySubmitParams): Promise<RelaySubmitResult>;
  checkPayment(paymentId: string): Promise<RelayCheckResult>;
}
