import { describe, it, expect, beforeEach } from "vitest";
import {
  decrementUnreadCount,
  getAgentInbox,
  updateAgentInbox,
  storeMessage,
  getMessage,
} from "../kv-helpers";
import type { InboxAgentIndex, InboxMessage } from "../types";

/**
 * Create a mock KV namespace for testing.
 *
 * Implements get/put/delete operations using an in-memory Map.
 */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();

  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({
      keys: [],
      list_complete: true,
      cursor: "",
      cacheStatus: null,
    }),
    getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
  } as unknown as KVNamespace;
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
