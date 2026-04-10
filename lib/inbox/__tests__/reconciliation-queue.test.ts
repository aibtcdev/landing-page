import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMessage, getStagedInboxPayment, storeStagedInboxPayment } from "@/lib/inbox";
import { processInboxReconciliationQueue } from "@/lib/inbox/reconciliation-queue";
import { createMockKV } from "./kv-mock";

const mocks = vi.hoisted(() => ({
  invalidateAgentListCache: vi.fn(),
  hasAchievement: vi.fn(),
  grantAchievement: vi.fn(),
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

vi.mock("@/lib/achievements", () => ({
  hasAchievement: mocks.hasAchievement,
  grantAchievement: mocks.grantAchievement,
}));

describe("inbox reconciliation queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasAchievement.mockResolvedValue(true);
    mocks.grantAchievement.mockResolvedValue(undefined);
    mocks.invalidateAgentListCache.mockResolvedValue(undefined);
  });

  it("finalizes a confirmed staged payment and acks the queue message", async () => {
    const kv = createMockKV();
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
    expect(await getMessage(kv, "msg_queue_finalize")).toEqual(
      expect.objectContaining({
        paymentStatus: "confirmed",
        paymentTxid: "c".repeat(64),
      })
    );
  });

  it("requeues in-flight payments with delay and acks the current message", async () => {
    const kv = createMockKV();
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
        X402_RELAY: {
          submitPayment: vi.fn(),
          checkPayment: vi.fn(),
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
    expect(mocks.logger.info).toHaveBeenCalledWith(
      "payment.queue",
      expect.objectContaining({
        paymentId: "pay_missing_staged",
        action: "ack_missing_staged_record",
      })
    );
  });

  it("retries the current queue message when the requeue binding is unavailable", async () => {
    const kv = createMockKV();
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
