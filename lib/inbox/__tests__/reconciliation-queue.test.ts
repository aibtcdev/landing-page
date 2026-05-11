import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStagedInboxPayment, storeStagedInboxPayment } from "@/lib/inbox";
import { processInboxReconciliationQueue } from "@/lib/inbox/reconciliation-queue";
import { createMockKV } from "./kv-mock";

/**
 * In-memory D1 mock that mimics inbox_messages INSERTs and message_id lookups
 * for the finalize path (#760). Only covers what the reconcile → finalize
 * code path exercises.
 */
function createMockD1(): { db: D1Database; insertedMessageIds: string[] } {
  const rows: Record<string, { messageId: string; paymentTxid: string | null; paymentStatus: string | null; toBtcAddress: string; sentAt: string }> = {};
  const insertedMessageIds: string[] = [];

  const db = {
    prepare: (sql: string) => {
      let binds: unknown[] = [];
      const stmt: any = {
        bind: (...b: unknown[]) => {
          binds = b;
          return stmt;
        },
        run: async () => {
          if (sql.includes("INSERT INTO inbox_messages")) {
            const [messageId, , , toBtcAddress, , , paymentTxid, , paymentStatus, , , , , , , sentAt] = binds as [
              string,
              string | null,
              string,
              string,
              string | null,
              string,
              string | null,
              number | null,
              string | null,
              string | null,
              string | null,
              number,
              number,
              string | null,
              string | null,
              string,
            ];
            if (rows[messageId]) {
              return { success: true, meta: { changes: 0 } };
            }
            rows[messageId] = { messageId, paymentTxid, paymentStatus, toBtcAddress, sentAt };
            insertedMessageIds.push(messageId);
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        first: async () => {
          if (sql.includes("FROM inbox_messages") && sql.includes("WHERE message_id = ?")) {
            const [messageId, toBtcAddress] = binds as [string, string];
            const row = rows[messageId];
            if (!row || row.toBtcAddress !== toBtcAddress) return null;
            // Return shape matching D1InboxRow's required columns
            return {
              message_id: row.messageId,
              from_stx_address: null,
              to_btc_address: row.toBtcAddress,
              to_stx_address: null,
              content: "",
              payment_txid: row.paymentTxid,
              payment_satoshis: null,
              payment_status: row.paymentStatus,
              payment_id: null,
              receipt_id: null,
              recovered_via_txid: 0,
              authenticated: 0,
              bitcoin_signature: null,
              sender_btc_address: null,
              sent_at: row.sentAt,
              read_at: null,
              replied_at: null,
              reply_to_message_id: null,
            };
          }
          return null;
        },
        all: async () => ({ results: [], success: true, meta: { changes: 0 } }),
        raw: async () => [],
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, insertedMessageIds };
}

const mocks = vi.hoisted(() => ({
  invalidateAgentListCache: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/cache", () => ({
  invalidateAgentListCache: mocks.invalidateAgentListCache,
}));

describe("inbox reconciliation queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.invalidateAgentListCache.mockResolvedValue(undefined);
  });

  it("finalizes a confirmed staged payment and acks the queue message", async () => {
    const kv = createMockKV();
    const { db, insertedMessageIds } = createMockD1();
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_queue_finalize",
      createdAt: sentAt,
      senderSentIndexBtcAddress: "bc1sender",
      message: {
        messageId: "msg_queue_finalize",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId: "pay_queue_finalize",
      },
    });

    const ack = vi.fn();
    const retry = vi.fn();
    const queueSend = vi.fn();

    await processInboxReconciliationQueue(
      {
        queue: "landing-page-inbox-reconciliation",
        messages: [
          {
            id: "queue-message-1",
            timestamp: new Date(),
            attempts: 1,
            body: {
              paymentId: "pay_queue_finalize",
              stagedAt: sentAt,
              attempt: 0,
              source: "inbox_post" as const,
            },
            ack,
            retry,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        X402_RELAY: {
          submitPayment: vi.fn(),
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_queue_finalize",
            status: "confirmed",
            txid: "c".repeat(64),
          }),
        },
        INBOX_RECONCILIATION_QUEUE: {
          send: queueSend,
          sendBatch: vi.fn(),
        },
      },
      mocks.logger,
      "test-version"
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
    expect(await getStagedInboxPayment(kv, "pay_queue_finalize")).toBeNull();
    // Finalize wrote to D1 (the #760 fix) and not to legacy KV.
    expect(insertedMessageIds).toEqual(["msg_queue_finalize"]);
  });

  it("requeues in-flight payments with delay and acks the current message", async () => {
    const kv = createMockKV();
    const { db } = createMockD1();
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_queue_retry",
      createdAt: sentAt,
      message: {
        messageId: "msg_queue_retry",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId: "pay_queue_retry",
      },
    });

    const ack = vi.fn();
    const retry = vi.fn();
    const queueSend = vi.fn().mockResolvedValue(undefined);

    await processInboxReconciliationQueue(
      {
        queue: "landing-page-inbox-reconciliation",
        messages: [
          {
            id: "queue-message-2",
            timestamp: new Date(),
            attempts: 1,
            body: {
              paymentId: "pay_queue_retry",
              stagedAt: sentAt,
              attempt: 0,
              source: "inbox_post" as const,
            },
            ack,
            retry,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        X402_RELAY: {
          submitPayment: vi.fn(),
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_queue_retry",
            status: "queued",
            checkStatusUrl: "https://relay.example/check/pay_queue_retry",
          }),
        },
        INBOX_RECONCILIATION_QUEUE: {
          send: queueSend,
          sendBatch: vi.fn(),
        },
      },
      mocks.logger,
      "test-version"
    );

    expect(queueSend).toHaveBeenCalledWith(
      {
        paymentId: "pay_queue_retry",
        stagedAt: sentAt,
        attempt: 1,
        source: "queue_retry",
      },
      { delaySeconds: 30 }
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(await getStagedInboxPayment(kv, "pay_queue_retry")).not.toBeNull();
  });

  it("acks missing staged records without retrying", async () => {
    const kv = createMockKV();
    const { db } = createMockD1();
    const ack = vi.fn();
    const retry = vi.fn();
    const queueSend = vi.fn();

    await processInboxReconciliationQueue(
      {
        queue: "landing-page-inbox-reconciliation",
        messages: [
          {
            id: "queue-message-3",
            timestamp: new Date(),
            attempts: 2,
            body: {
              paymentId: "pay_missing_staged",
              stagedAt: new Date().toISOString(),
              attempt: 1,
              source: "queue_retry" as const,
            },
            ack,
            retry,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        X402_RELAY: {
          submitPayment: vi.fn(),
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_missing_staged",
            status: "queued",
            checkStatusUrl: "https://relay.example/check/pay_missing_staged",
          }),
        },
        INBOX_RECONCILIATION_QUEUE: {
          send: queueSend,
          sendBatch: vi.fn(),
        },
      },
      mocks.logger,
      "test-version"
    );

    // reconcileStagedInboxPayment returns "noop" when no staged record exists
    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it("retries the current queue message when the requeue binding is unavailable", async () => {
    const kv = createMockKV();
    const { db } = createMockD1();
    const sentAt = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_queue_retry_binding_missing",
      createdAt: sentAt,
      message: {
        messageId: "msg_queue_retry_binding_missing",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt,
        paymentStatus: "pending",
        paymentId: "pay_queue_retry_binding_missing",
      },
    });

    const ack = vi.fn();
    const retry = vi.fn();

    await processInboxReconciliationQueue(
      {
        queue: "landing-page-inbox-reconciliation",
        messages: [
          {
            id: "queue-message-4",
            timestamp: new Date(),
            attempts: 1,
            body: {
              paymentId: "pay_queue_retry_binding_missing",
              stagedAt: sentAt,
              attempt: 0,
              source: "inbox_post" as const,
            },
            ack,
            retry,
          },
        ],
        ackAll: vi.fn(),
        retryAll: vi.fn(),
      },
      {
        VERIFIED_AGENTS: kv,
        DB: db,
        X402_RELAY: {
          submitPayment: vi.fn(),
          checkPayment: vi.fn().mockResolvedValue({
            paymentId: "pay_queue_retry_binding_missing",
            status: "queued",
            checkStatusUrl: "https://relay.example/check/pay_queue_retry_binding_missing",
          }),
        },
      },
      mocks.logger,
      "test-version"
    );

    expect(ack).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "payment.queue",
      expect.objectContaining({
        paymentId: "pay_queue_retry_binding_missing",
        action: "enqueue_failed",
      })
    );
  });
});
