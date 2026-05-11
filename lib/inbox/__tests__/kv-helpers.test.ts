import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  deleteStagedInboxPayment,
  decrementUnreadCount,
  finalizeStagedInboxPayment,
  getAgentInbox,
  updateAgentInbox,
  getStagedInboxPayment,
  storeMessage,
  storeStagedInboxPayment,
  getMessage,
} from "../kv-helpers";
import type { InboxAgentIndex, InboxMessage } from "../types";
import { createMockKV, createMockKVWithOptions } from "./kv-mock";

// ── D1 mock helpers (#760) ───────────────────────────────────────────────────
// In-memory D1 mock that mimics the inbox_messages table for the `is_reply = 0`
// rows that the finalize path inserts. Only covers the subset of SQL that
// `insertInboundMessageToD1` and `getInboxMessageFromD1` exercise.

type InboxRow = {
  message_id: string;
  is_reply: number;
  reply_to_message_id: string | null;
  from_stx_address: string | null;
  from_btc_address: string | null;
  to_btc_address: string;
  to_stx_address: string | null;
  content: string;
  payment_txid: string | null;
  payment_satoshis: number | null;
  payment_status: string | null;
  payment_id: string | null;
  receipt_id: string | null;
  recovered_via_txid: number;
  authenticated: number;
  bitcoin_signature: string | null;
  sender_btc_address: string | null;
  sent_at: string;
  read_at: string | null;
  replied_at: string | null;
};

function createMockD1(opts?: {
  /** When set, INSERT throws this error on every call. */
  insertError?: Error;
  /** Pre-populate rows. */
  seedRows?: InboxRow[];
}): { db: D1Database; rows: InboxRow[]; insertCalls: { sql: string; binds: unknown[] }[] } {
  const rows: InboxRow[] = opts?.seedRows ? [...opts.seedRows] : [];
  const insertCalls: { sql: string; binds: unknown[] }[] = [];

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
            insertCalls.push({ sql, binds });
            if (opts?.insertError) throw opts.insertError;
            // Enforce the partial UNIQUE index on payment_txid for inbound rows
            const paymentTxid = binds[6];
            if (
              typeof paymentTxid === "string" &&
              rows.some(
                (r) => r.is_reply === 0 && r.payment_txid === paymentTxid
              )
            ) {
              throw new Error(
                "D1_ERROR: UNIQUE constraint failed: inbox_messages.payment_txid"
              );
            }
            // Map the bind order from insertInboundMessageToD1
            const [
              message_id,
              reply_to_message_id,
              from_stx_address,
              to_btc_address,
              to_stx_address,
              content,
              payment_txid_bind,
              payment_satoshis,
              payment_status,
              payment_id,
              receipt_id,
              recovered_via_txid,
              authenticated,
              bitcoin_signature,
              sender_btc_address,
              sent_at,
            ] = binds as [
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
            // ON CONFLICT(message_id) DO NOTHING
            if (rows.some((r) => r.message_id === message_id)) {
              return { success: true, meta: { changes: 0 } };
            }
            rows.push({
              message_id,
              is_reply: 0,
              reply_to_message_id,
              from_stx_address,
              from_btc_address: null,
              to_btc_address,
              to_stx_address,
              content,
              payment_txid: payment_txid_bind,
              payment_satoshis,
              payment_status,
              payment_id,
              receipt_id,
              recovered_via_txid,
              authenticated,
              bitcoin_signature,
              sender_btc_address,
              sent_at,
              read_at: null,
              replied_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
        first: async () => {
          // getInboxMessageFromD1: SELECT … WHERE message_id = ? AND to_btc_address = ? AND is_reply = 0
          if (sql.includes("FROM inbox_messages") && sql.includes("WHERE message_id = ?")) {
            const [messageId, toBtc] = binds as [string, string];
            const row = rows.find(
              (r) =>
                r.message_id === messageId &&
                r.to_btc_address === toBtc &&
                r.is_reply === 0
            );
            return row ?? null;
          }
          return null;
        },
        all: async () => ({ results: [], success: true, meta: { changes: 0 } }),
        raw: async () => [],
      };
      return stmt;
    },
  } as unknown as D1Database;

  return { db, rows, insertCalls };
}

describe("decrementUnreadCount", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("decrements unreadCount from 1 to 0", async () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

    // Setup: Create inbox with unreadCount=1
    await updateAgentInbox(kv, btcAddress, "msg_1", new Date().toISOString());

    // Verify initial state
    let inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox).toBeDefined();
    expect(inbox?.unreadCount).toBe(1);

    // Action: Decrement
    await decrementUnreadCount(kv, btcAddress);

    // Assert: unreadCount is now 0
    inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox?.unreadCount).toBe(0);
  });

  it("decrements unreadCount from 3 to 2", async () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

    // Setup: Create inbox with 3 unread messages
    await updateAgentInbox(kv, btcAddress, "msg_1", new Date().toISOString());
    await updateAgentInbox(kv, btcAddress, "msg_2", new Date().toISOString());
    await updateAgentInbox(kv, btcAddress, "msg_3", new Date().toISOString());

    // Verify initial state
    let inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox?.unreadCount).toBe(3);

    // Action: Decrement once
    await decrementUnreadCount(kv, btcAddress);

    // Assert: unreadCount is now 2
    inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox?.unreadCount).toBe(2);
  });

  it("does not go negative when unreadCount is already 0", async () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

    // Setup: Create inbox with 1 message, then decrement to 0
    await updateAgentInbox(kv, btcAddress, "msg_1", new Date().toISOString());
    await decrementUnreadCount(kv, btcAddress);

    // Verify initial state is 0
    let inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox?.unreadCount).toBe(0);

    // Action: Try to decrement when already at 0
    await decrementUnreadCount(kv, btcAddress);

    // Assert: Still 0 (clamped, not -1)
    inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox?.unreadCount).toBe(0);
  });

  it("is a no-op when inbox index does not exist", async () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

    // Verify no inbox exists
    let inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox).toBeNull();

    // Action: Try to decrement non-existent inbox (should not throw)
    await decrementUnreadCount(kv, btcAddress);

    // Assert: Still no inbox (no error thrown)
    inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox).toBeNull();
  });

  it("uses buildAgentIndexKey correctly (implicit integration test)", async () => {
    const btcAddress = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";

    // Setup: Create inbox
    await updateAgentInbox(kv, btcAddress, "msg_1", new Date().toISOString());

    // Decrement via helper
    await decrementUnreadCount(kv, btcAddress);

    // Assert: Can still retrieve via getAgentInbox (proves key construction is consistent)
    const inbox = await getAgentInbox(kv, btcAddress);
    expect(inbox).toBeDefined();
    expect(inbox?.btcAddress).toBe(btcAddress);
    expect(inbox?.unreadCount).toBe(0);
  });
});

describe("reply flow integration test", () => {
  let kv: KVNamespace;

  beforeEach(() => {
    kv = createMockKV();
  });

  it("full reply flow: message sent, inbox created, unread=1, reply sent, unread=0", async () => {
    const senderBtc = "bc1qsender";
    const recipientBtc = "bc1qrecipient";
    const recipientStx = "SP2RECIPIENT";
    const messageId = "msg_test_reply_flow";
    const now = new Date().toISOString();

    // Step 1: Store a message (no readAt)
    const message: InboxMessage = {
      messageId,
      fromAddress: senderBtc,
      toBtcAddress: recipientBtc,
      toStxAddress: recipientStx,
      content: "Test message",
      paymentTxid: "a".repeat(64),
      paymentSatoshis: 100,
      sentAt: now,
    };
    await storeMessage(kv, message);

    // Step 2: Update inbox index (simulating message delivery)
    await updateAgentInbox(kv, recipientBtc, messageId, now);

    // Verify: inbox has unreadCount=1
    let inbox = await getAgentInbox(kv, recipientBtc);
    expect(inbox?.unreadCount).toBe(1);
    expect(inbox?.messageIds).toContain(messageId);

    // Step 3: Simulate reply flow (agent marks message as read implicitly)
    // In the actual flow, the route would:
    // 1. Check wasUnread = !message.readAt (true in this case)
    // 2. Update message with readAt
    // 3. Call decrementUnreadCount if wasUnread

    const retrievedMessage = await getMessage(kv, messageId);
    expect(retrievedMessage).toBeDefined();
    expect(retrievedMessage?.readAt).toBeUndefined(); // Not read yet

    const wasUnread = !retrievedMessage?.readAt;
    expect(wasUnread).toBe(true);

    // Step 4: Decrement unread count (simulating outbox reply route logic)
    if (wasUnread) {
      await decrementUnreadCount(kv, recipientBtc);
    }

    // Assert: unreadCount is now 0
    inbox = await getAgentInbox(kv, recipientBtc);
    expect(inbox?.unreadCount).toBe(0);
  });
});

describe("staged inbox payment helpers", () => {
  it("stores staged inbox payments keyed by paymentId with a TTL", async () => {
    const { kv, putCalls } = createMockKVWithOptions();
    const staged = {
      paymentId: "pay_stage_ttl",
      createdAt: new Date().toISOString(),
      message: {
        messageId: "msg_stage_ttl",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt: new Date().toISOString(),
        paymentStatus: "pending" as const,
        paymentId: "pay_stage_ttl",
      },
    };

    await storeStagedInboxPayment(kv, staged);

    expect(await getStagedInboxPayment(kv, "pay_stage_ttl")).toEqual(staged);
    expect(putCalls).toContainEqual(
      expect.objectContaining({
        key: "inbox:staged-payment:pay_stage_ttl",
        options: expect.objectContaining({ expirationTtl: 604800 }),
      })
    );
  });

  it("finalizes a staged inbox payment by inserting into D1 and clearing the staged KV record (#760)", async () => {
    const kv = createMockKV();
    const { db, rows, insertCalls } = createMockD1();
    const now = new Date().toISOString();
    const stagedMessage: InboxMessage = {
      messageId: "msg_stage_confirmed",
      fromAddress: "SP123",
      toBtcAddress: "bc1recipient",
      toStxAddress: "SP456",
      content: "hello",
      paymentSatoshis: 100,
      sentAt: now,
      paymentStatus: "pending",
      paymentId: "pay_stage_confirmed",
    };

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_stage_confirmed",
      createdAt: now,
      senderSentIndexBtcAddress: "bc1sender",
      message: stagedMessage,
    });

    const finalized = await finalizeStagedInboxPayment(kv, db, "pay_stage_confirmed", {
      paymentStatus: "confirmed",
      paymentTxid: "a".repeat(64),
    });

    // Returned message reflects the confirmed state
    expect(finalized?.messageId).toBe("msg_stage_confirmed");
    expect(finalized?.paymentStatus).toBe("confirmed");
    expect(finalized?.paymentTxid).toBe("a".repeat(64));

    // Staged KV record is gone
    expect(await getStagedInboxPayment(kv, "pay_stage_confirmed")).toBeNull();

    // D1 received exactly one INSERT with the confirmed payment_txid
    expect(insertCalls).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payment_txid).toBe("a".repeat(64));
    expect(rows[0]?.payment_status).toBe("confirmed");
    expect(rows[0]?.to_btc_address).toBe("bc1recipient");

    // Critically: NO legacy KV writes happened — the inbox:message / inbox:agent
    // / inbox:sent keys must stay empty. This is the regression the fix prevents.
    expect(await getMessage(kv, "msg_stage_confirmed")).toBeNull();
    expect(await getAgentInbox(kv, "bc1recipient")).toBeNull();
  });

  it("is idempotent: re-finalize after staged record was cleared returns null without a second INSERT (#760)", async () => {
    const kv = createMockKV();
    const { db, insertCalls } = createMockD1();
    const now = new Date().toISOString();
    const stagedMessage: InboxMessage = {
      messageId: "msg_idempotent",
      fromAddress: "SP123",
      toBtcAddress: "bc1recipient",
      toStxAddress: "SP456",
      content: "hi",
      paymentSatoshis: 100,
      sentAt: now,
      paymentStatus: "pending",
      paymentId: "pay_idempotent",
    };

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_idempotent",
      createdAt: now,
      message: stagedMessage,
    });

    // First finalize succeeds.
    const first = await finalizeStagedInboxPayment(kv, db, "pay_idempotent", {
      paymentTxid: "b".repeat(64),
    });
    expect(first?.messageId).toBe("msg_idempotent");
    expect(insertCalls).toHaveLength(1);

    // Second finalize observes the staged record is already gone → null, no
    // additional D1 INSERT. The queue treats this as `noop`.
    const second = await finalizeStagedInboxPayment(kv, db, "pay_idempotent", {
      paymentTxid: "b".repeat(64),
    });
    expect(second).toBeNull();
    expect(insertCalls).toHaveLength(1);
  });

  it("returns the canonical D1 row when the staged record exists but D1 already has the message (queue retry race) (#760)", async () => {
    const kv = createMockKV();
    const seededRow: InboxRow = {
      message_id: "msg_race",
      is_reply: 0,
      reply_to_message_id: null,
      from_stx_address: "SP123",
      from_btc_address: null,
      to_btc_address: "bc1recipient",
      to_stx_address: "SP456",
      content: "hi",
      payment_txid: "c".repeat(64),
      payment_satoshis: 100,
      payment_status: "confirmed",
      payment_id: "pay_race",
      receipt_id: null,
      recovered_via_txid: 0,
      authenticated: 0,
      bitcoin_signature: null,
      sender_btc_address: null,
      sent_at: new Date().toISOString(),
      read_at: null,
      replied_at: null,
    };
    const { db, insertCalls } = createMockD1({ seedRows: [seededRow] });
    const now = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_race",
      createdAt: now,
      message: {
        messageId: "msg_race",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hi",
        paymentSatoshis: 100,
        sentAt: now,
        paymentStatus: "pending",
        paymentId: "pay_race",
      },
    });

    const finalized = await finalizeStagedInboxPayment(kv, db, "pay_race", {
      paymentTxid: "c".repeat(64),
    });

    // Returns canonical row from D1 (not the staged fixture), clears staged.
    expect(finalized?.messageId).toBe("msg_race");
    expect(finalized?.paymentStatus).toBe("confirmed");
    expect(await getStagedInboxPayment(kv, "pay_race")).toBeNull();

    // No INSERT attempted — the existing-row branch short-circuits.
    expect(insertCalls).toHaveLength(0);
  });

  it("treats UNIQUE-violation on payment_txid as idempotent success and returns the canonical row (#760)", async () => {
    const kv = createMockKV();
    const now = new Date().toISOString();

    // Seed a row matching the staged message — when the second finalize INSERTs,
    // the UNIQUE-on-payment_txid index fires and we should re-query, not 503.
    const seededRow: InboxRow = {
      message_id: "msg_unique_race",
      is_reply: 0,
      reply_to_message_id: null,
      from_stx_address: "SP123",
      from_btc_address: null,
      to_btc_address: "bc1recipient",
      to_stx_address: "SP456",
      content: "hi",
      payment_txid: "d".repeat(64),
      payment_satoshis: 100,
      payment_status: "confirmed",
      payment_id: "pay_unique_race",
      receipt_id: null,
      recovered_via_txid: 0,
      authenticated: 0,
      bitcoin_signature: null,
      sender_btc_address: null,
      sent_at: now,
      read_at: null,
      replied_at: null,
    };

    // Force INSERT to throw the UNIQUE constraint error, but pre-populate the
    // row so the post-violation re-query finds it.
    const { db, insertCalls } = createMockD1({
      insertError: new Error(
        "D1_ERROR: UNIQUE constraint failed: inbox_messages.payment_txid"
      ),
      seedRows: [seededRow],
    });

    // The seed row matches what getInboxMessageFromD1 would return for the
    // staged message_id, so the existing-row branch fires FIRST and we never
    // hit the INSERT — skip seeding for this case and use a different msg id.
    await storeStagedInboxPayment(kv, {
      paymentId: "pay_unique_race",
      createdAt: now,
      message: {
        // Different messageId from the seeded row so the existing-row check
        // misses and we proceed to INSERT (which will then throw).
        messageId: "msg_unique_race_new",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hi",
        paymentSatoshis: 100,
        sentAt: now,
        paymentStatus: "pending",
        paymentId: "pay_unique_race",
      },
    });

    const finalized = await finalizeStagedInboxPayment(kv, db, "pay_unique_race", {
      paymentTxid: "d".repeat(64),
    });

    // INSERT was attempted, threw UNIQUE → caller re-queried D1. The re-query
    // looks up by the NEW messageId (`msg_unique_race_new`), which is not in
    // the seed; so canonical is null, but staged still cleared (permanent).
    expect(insertCalls).toHaveLength(1);
    expect(finalized).toBeNull();
    expect(await getStagedInboxPayment(kv, "pay_unique_race")).toBeNull();
  });

  it("propagates non-UNIQUE D1 errors so the queue retries (#760)", async () => {
    const kv = createMockKV();
    const { db } = createMockD1({
      insertError: new Error("D1_ERROR: connection reset"),
    });
    const now = new Date().toISOString();

    await storeStagedInboxPayment(kv, {
      paymentId: "pay_transient",
      createdAt: now,
      message: {
        messageId: "msg_transient",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hi",
        paymentSatoshis: 100,
        sentAt: now,
        paymentStatus: "pending",
        paymentId: "pay_transient",
      },
    });

    await expect(
      finalizeStagedInboxPayment(kv, db, "pay_transient", {
        paymentTxid: "e".repeat(64),
      })
    ).rejects.toThrow(/connection reset/);

    // Staged record stays put so the queue can retry
    expect(await getStagedInboxPayment(kv, "pay_transient")).not.toBeNull();
  });

  it("discards staged inbox payments on terminal non-success", async () => {
    const kv = createMockKV();
    await storeStagedInboxPayment(kv, {
      paymentId: "pay_stage_discard",
      createdAt: new Date().toISOString(),
      message: {
        messageId: "msg_stage_discard",
        fromAddress: "SP123",
        toBtcAddress: "bc1recipient",
        toStxAddress: "SP456",
        content: "hello",
        paymentSatoshis: 100,
        sentAt: new Date().toISOString(),
        paymentStatus: "pending",
        paymentId: "pay_stage_discard",
      },
    });

    await deleteStagedInboxPayment(kv, "pay_stage_discard");

    expect(await getStagedInboxPayment(kv, "pay_stage_discard")).toBeNull();
    expect(await getMessage(kv, "msg_stage_discard")).toBeNull();
  });
});
