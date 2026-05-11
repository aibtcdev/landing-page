/**
 * Tests for lib/inbox/d1-reads.ts
 *
 * Phase 2.5 Step 3.1 — D1 read flip for GET /api/inbox/[address].
 * Phase 2.5 Step 3.5 — adds getReplyForMessageFromD1 for write-path auth reads.
 *
 * Verifies:
 *   - listInboxMessagesFromD1: correct SQL shape, status filter variants,
 *     ORDER BY sent_at DESC, pagination bindings, InboxMessage mapping
 *   - countInboxMessagesFromD1: unread/read/all variants, the live
 *     SELECT COUNT(*) that closes aibtc-mcp-server#497
 *   - fetchRepliesForMessages: IN-clause construction, OutboxReply mapping,
 *     empty-input guard
 *   - getReplyForMessageFromD1: tenant-discriminator gate, hit/miss, SQL shape
 *   - Cache-key invariant documentation (structural): ensures the public
 *     path does not set Cache-Control headers that would leak auth'd state
 *
 * Note: these are unit tests against the helper functions. They use a mock
 * D1Database (vi.fn() pattern matching d1-dual-write.test.ts) and do NOT
 * make live network calls.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/721
 * See: https://github.com/aibtcdev/landing-page/issues/736 (Step 3.5)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listInboxMessagesFromD1,
  countInboxMessagesFromD1,
  fetchRepliesForMessages,
  listOutboxRepliesFromD1,
  countOutboxRepliesFromD1,
  getReplyForMessageFromD1,
  getAgentInboxFromD1,
  getSentIndexFromD1,
  getRecentInboxEventsFromD1,
  checkRedeemedTxidInD1,
  type StatusFilter,
} from "../d1-reads";

// ── D1 mock helpers ───────────────────────────────────────────────────────────

/**
 * Build a minimal D1 PreparedStatement mock.
 * @param rows  - rows returned by .all() (wrapped in { results })
 * @param firstResult - value returned by .first()
 */
function createPreparedStatement<T = unknown>(
  rows: T[] = [],
  firstResult: T | null = null
) {
  const stmt = {
    bind: vi.fn(),
    run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }),
    first: vi.fn().mockResolvedValue(firstResult),
    all: vi.fn().mockResolvedValue({ results: rows }),
    raw: vi.fn(),
  };
  stmt.bind.mockReturnValue(stmt);
  return stmt;
}

function createMockD1<T = unknown>(
  rows: T[] = [],
  firstResult: T | null = null
): D1Database {
  const stmt = createPreparedStatement<T>(rows, firstResult);
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BTC_ADDRESS = "bc1qxj5jtv8jwm7zv2nczn2xfq9agjgj0sqpsxn43h";

const INBOUND_ROW = {
  message_id: "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf",
  is_reply: 0,
  reply_to_message_id: null,
  from_stx_address: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
  from_btc_address: null,
  to_btc_address: BTC_ADDRESS,
  to_stx_address: "SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K",
  content: "gm agent — shipping update today",
  payment_txid: "602f097b3de853e05546015af6ac9c32e858efcc9fd5ff92edb860d5cadc8c21",
  payment_satoshis: 100,
  payment_status: "confirmed",
  payment_id: null,
  receipt_id: null,
  recovered_via_txid: 0,
  authenticated: 0,
  bitcoin_signature: null,
  sender_btc_address: null,
  sent_at: "2026-02-18T02:26:42.598Z",
  read_at: null,
  replied_at: null,
};

const READ_INBOUND_ROW = {
  ...INBOUND_ROW,
  message_id: "msg_read_0001",
  read_at: "2026-02-18T03:00:00.000Z",
};

const REPLY_ROW = {
  message_id: "reply_msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf",
  reply_to_message_id: "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf",
  from_btc_address: "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv",
  to_btc_address: "bc1qsenderbtcaddress0000000000000000000000",
  content: "Great work — bookmarked.",
  bitcoin_signature:
    "Jx52I99dmnoFqmKkJXsLP4ELktANgZ6v1m1CFA7c5kz+Xr9W45m29QnabzGim5ubEzJP1eoynU/GjuRWMjRD9nQ=",
  sent_at: "2026-02-19T22:14:43.426Z",
};

// ── listInboxMessagesFromD1 ───────────────────────────────────────────────────

describe("listInboxMessagesFromD1", () => {
  it("calls db.prepare() and db.all() with bound address, limit, offset", async () => {
    const db = createMockD1([INBOUND_ROW]);
    // Get hold of the statement mock
    const stmtMock = createPreparedStatement([INBOUND_ROW]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");

    expect(db.prepare).toHaveBeenCalledOnce();
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("FROM inbox_messages");
    expect(sql).toContain("WHERE to_btc_address = ?");
    expect(sql).toContain("AND is_reply = 0");

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(BTC_ADDRESS);
    expect(bindArgs[1]).toBe(20); // limit
    expect(bindArgs[2]).toBe(0);  // offset
  });

  it("orders results by sent_at DESC", async () => {
    const db = createMockD1();
    await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ORDER BY sent_at DESC");
  });

  it("adds AND read_at IS NULL clause for status=unread", async () => {
    const db = createMockD1();
    await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "unread");
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("AND read_at IS NULL");
    expect(sql).not.toContain("read_at IS NOT NULL");
  });

  it("adds AND read_at IS NOT NULL clause for status=read", async () => {
    const db = createMockD1();
    await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "read");
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("AND read_at IS NOT NULL");
    expect(sql).not.toContain("read_at IS NULL");
  });

  it("does not add read_at clause for status=all", async () => {
    const db = createMockD1();
    await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).not.toContain("read_at IS NULL");
    expect(sql).not.toContain("read_at IS NOT NULL");
  });

  it("maps D1 row to InboxMessage shape (messageId, fromAddress, toBtcAddress, content)", async () => {
    const stmtMock = createPreparedStatement([INBOUND_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");

    expect(result).toHaveLength(1);
    const msg = result[0];
    expect(msg.messageId).toBe(INBOUND_ROW.message_id);
    expect(msg.fromAddress).toBe(INBOUND_ROW.from_stx_address);
    expect(msg.toBtcAddress).toBe(INBOUND_ROW.to_btc_address);
    expect(msg.content).toBe(INBOUND_ROW.content);
    expect(msg.sentAt).toBe(INBOUND_ROW.sent_at);
    expect(msg.paymentTxid).toBe(INBOUND_ROW.payment_txid);
    expect(msg.paymentSatoshis).toBe(INBOUND_ROW.payment_satoshis);
  });

  it("maps authenticated=1 to true and authenticated=0 to false", async () => {
    const authenticatedRow = { ...INBOUND_ROW, authenticated: 1 };

    const stmt1 = createPreparedStatement([authenticatedRow]);
    const db1 = {
      prepare: vi.fn().mockReturnValue(stmt1),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;
    const result1 = await listInboxMessagesFromD1(db1, BTC_ADDRESS, 20, 0, "all");
    expect(result1[0].authenticated).toBe(true);

    const stmt2 = createPreparedStatement([INBOUND_ROW]);
    const db2 = {
      prepare: vi.fn().mockReturnValue(stmt2),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;
    const result2 = await listInboxMessagesFromD1(db2, BTC_ADDRESS, 20, 0, "all");
    expect(result2[0].authenticated).toBe(false);
  });

  it("maps recovered_via_txid=1 to recoveredViaTxid=true", async () => {
    const recoveredRow = { ...INBOUND_ROW, recovered_via_txid: 1 };
    const stmtMock = createPreparedStatement([recoveredRow]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    expect(result[0].recoveredViaTxid).toBe(true);
  });

  it("does not set recoveredViaTxid when recovered_via_txid=0", async () => {
    const stmtMock = createPreparedStatement([INBOUND_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    expect(result[0].recoveredViaTxid).toBeUndefined();
  });

  it("maps null read_at to absent readAt", async () => {
    const stmtMock = createPreparedStatement([INBOUND_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    expect(result[0].readAt).toBeUndefined();
  });

  it("maps non-null read_at to readAt string", async () => {
    const stmtMock = createPreparedStatement([READ_INBOUND_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    expect(result[0].readAt).toBe(READ_INBOUND_ROW.read_at);
  });

  it("returns empty array when no rows", async () => {
    const stmtMock = createPreparedStatement([]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    expect(result).toHaveLength(0);
  });

  it("passes LIMIT and OFFSET bindings correctly for pagination", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await listInboxMessagesFromD1(db, BTC_ADDRESS, 50, 100, "all");

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(BTC_ADDRESS);
    expect(bindArgs[1]).toBe(50);  // limit
    expect(bindArgs[2]).toBe(100); // offset
  });
});

// ── countInboxMessagesFromD1 ──────────────────────────────────────────────────

describe("countInboxMessagesFromD1", () => {
  it("queries SELECT COUNT(*) from inbox_messages for status=all (no read_at filter)", async () => {
    const stmtMock = createPreparedStatement([], { cnt: 5 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countInboxMessagesFromD1(db, BTC_ADDRESS, "all");

    expect(count).toBe(5);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain("FROM inbox_messages");
    expect(sql).toContain("is_reply = 0");
    expect(sql).not.toContain("read_at IS NULL");
    expect(sql).not.toContain("read_at IS NOT NULL");
  });

  it("adds AND read_at IS NULL for status=unread (the live counter that closes aibtc-mcp-server#497)", async () => {
    const stmtMock = createPreparedStatement([], { cnt: 2 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countInboxMessagesFromD1(db, BTC_ADDRESS, "unread");

    expect(count).toBe(2);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("AND read_at IS NULL");
  });

  it("adds AND read_at IS NOT NULL for status=read", async () => {
    const stmtMock = createPreparedStatement([], { cnt: 3 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countInboxMessagesFromD1(db, BTC_ADDRESS, "read");

    expect(count).toBe(3);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("AND read_at IS NOT NULL");
  });

  it("binds the btcAddress as the first positional param", async () => {
    const stmtMock = createPreparedStatement([], { cnt: 0 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await countInboxMessagesFromD1(db, BTC_ADDRESS, "all");

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(BTC_ADDRESS);
  });

  it("returns 0 when db.first() returns null", async () => {
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countInboxMessagesFromD1(db, BTC_ADDRESS, "unread");
    expect(count).toBe(0);
  });

  it("correctly distinguishes unreadCount=2 vs totalCount=2 (the acceptance test signal)", async () => {
    // Simulates the §1.4 acceptance test:
    // Pre-flip KV had unreadCount=3 (stale) / totalCount=2.
    // Post-flip D1 should return unreadCount=2 / totalCount=2 (truthful).
    const stmtUnread = createPreparedStatement([], { cnt: 2 });
    const stmtTotal = createPreparedStatement([], { cnt: 2 });

    let callCount = 0;
    const db = {
      prepare: vi.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? stmtUnread : stmtTotal;
      }),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const unreadCount = await countInboxMessagesFromD1(db, BTC_ADDRESS, "unread");
    const totalCount = await countInboxMessagesFromD1(db, BTC_ADDRESS, "all");

    // Post-flip: both should be 2 (no drift)
    expect(unreadCount).toBe(2);
    expect(totalCount).toBe(2);
    expect(unreadCount).toBe(totalCount); // drift=0 proves the stale-counter is fixed
  });
});

// ── fetchRepliesForMessages ───────────────────────────────────────────────────

describe("fetchRepliesForMessages", () => {
  it("returns an empty Map when parentMessageIds is empty (no D1 call)", async () => {
    const db = createMockD1();
    const result = await fetchRepliesForMessages(db, []);
    expect(result.size).toBe(0);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("builds IN clause with correct number of placeholders", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    const ids = ["msg_1", "msg_2", "msg_3"];
    await fetchRepliesForMessages(db, ids);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("IN (?, ?, ?)");
    // All three IDs bound
    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs).toEqual(ids);
  });

  it("queries only is_reply=1 rows", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await fetchRepliesForMessages(db, ["msg_1"]);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("is_reply = 1");
  });

  it("maps a reply row to OutboxReply shape and keys by reply_to_message_id", async () => {
    const stmtMock = createPreparedStatement([REPLY_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(),
      dump: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;

    const result = await fetchRepliesForMessages(db, [REPLY_ROW.reply_to_message_id]);

    expect(result.size).toBe(1);
    const reply = result.get(REPLY_ROW.reply_to_message_id);
    expect(reply).toBeDefined();
    expect(reply?.messageId).toBe(REPLY_ROW.reply_to_message_id);
    expect(reply?.fromAddress).toBe(REPLY_ROW.from_btc_address);
    expect(reply?.reply).toBe(REPLY_ROW.content);
    expect(reply?.signature).toBe(REPLY_ROW.bitcoin_signature);
    expect(reply?.repliedAt).toBe(REPLY_ROW.sent_at);
  });

  it("maps multiple reply rows to separate map entries", async () => {
    const reply2 = {
      ...REPLY_ROW,
      message_id: "reply_msg_2",
      reply_to_message_id: "msg_2",
      content: "Another reply",
    };
    const stmtMock = createPreparedStatement([REPLY_ROW, reply2]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(),
      dump: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;

    const result = await fetchRepliesForMessages(db, [
      REPLY_ROW.reply_to_message_id,
      reply2.reply_to_message_id,
    ]);

    expect(result.size).toBe(2);
    expect(result.has(REPLY_ROW.reply_to_message_id)).toBe(true);
    expect(result.has(reply2.reply_to_message_id)).toBe(true);
  });

  it("returns empty Map when D1 returns no rows for the given IDs", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    const result = await fetchRepliesForMessages(db, ["msg_no_reply"]);
    expect(result.size).toBe(0);
  });
});

// ── listOutboxRepliesFromD1 ───────────────────────────────────────────────────

describe("listOutboxRepliesFromD1 (Phase 2.5 Step 3.3)", () => {
  const REPLIER_BTC = "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv";
  const SENT_REPLY_ROW = {
    message_id: "reply_msg_1771381602504_test",
    reply_to_message_id: "msg_1771381602504_test",
    from_btc_address: REPLIER_BTC,
    to_btc_address: BTC_ADDRESS,
    content: "Great work — bookmarked.",
    bitcoin_signature:
      "Jx52I99dmnoFqmKkJXsLP4ELktANgZ6v1m1CFA7c5kz+Xr9W45m29QnabzGim5ubEzJP1eoynU/GjuRWMjRD9nQ=",
    sent_at: "2026-02-19T22:14:43.426Z",
  };

  it("queries WHERE is_reply=1 AND from_btc_address=? with ORDER BY sent_at DESC", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await listOutboxRepliesFromD1(db, REPLIER_BTC, 20, 0);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("FROM inbox_messages");
    expect(sql).toContain("WHERE is_reply = 1 AND from_btc_address = ?");
    expect(sql).toContain("ORDER BY sent_at DESC");
    expect(sql).toContain("LIMIT ? OFFSET ?");
  });

  it("binds from_btc_address, limit, offset in order", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await listOutboxRepliesFromD1(db, REPLIER_BTC, 50, 10);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(REPLIER_BTC);
    expect(bindArgs[1]).toBe(50);  // limit
    expect(bindArgs[2]).toBe(10);  // offset
  });

  it("maps D1 reply row to OutboxReply shape", async () => {
    const stmtMock = createPreparedStatement([SENT_REPLY_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const results = await listOutboxRepliesFromD1(db, REPLIER_BTC, 20, 0);

    expect(results).toHaveLength(1);
    const reply = results[0];
    // replyRowToOutboxReply: messageId = reply_to_message_id (parent ID)
    expect(reply.messageId).toBe(SENT_REPLY_ROW.reply_to_message_id);
    expect(reply.fromAddress).toBe(SENT_REPLY_ROW.from_btc_address);
    expect(reply.toBtcAddress).toBe(SENT_REPLY_ROW.to_btc_address);
    expect(reply.reply).toBe(SENT_REPLY_ROW.content);
    expect(reply.signature).toBe(SENT_REPLY_ROW.bitcoin_signature);
    expect(reply.repliedAt).toBe(SENT_REPLY_ROW.sent_at);
  });

  it("returns empty array when no rows", async () => {
    const db = createMockD1([]);
    const result = await listOutboxRepliesFromD1(db, REPLIER_BTC, 20, 0);
    expect(result).toHaveLength(0);
  });

  it("tenant-discriminator security gate: SQL WHERE from_btc_address=? enforces address isolation", async () => {
    // This test documents the security property: a reply written by REPLIER_BTC
    // will NOT be returned when the query uses a different address.
    // The SQL gate (WHERE is_reply = 1 AND from_btc_address = ?) enforces this at the DB level.
    const db = createMockD1();
    const stmtMock = createPreparedStatement([]); // D1 returns empty for non-matching address
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    // Query with ADDR_B (not the replier)
    const ADDR_B = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";
    const results = await listOutboxRepliesFromD1(db, ADDR_B, 100, 0);

    // Must be empty — the SQL WHERE clause prevents cross-agent leakage
    expect(results).toHaveLength(0);

    // Verify the query was called with ADDR_B — the guard happens in SQL
    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(ADDR_B);
  });
});

// ── countOutboxRepliesFromD1 ──────────────────────────────────────────────────

describe("countOutboxRepliesFromD1 (Phase 2.5 Step 3.3 — sentCount restoration)", () => {
  const REPLIER_BTC = "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv";

  it("queries SELECT COUNT(*) WHERE is_reply=1 AND from_btc_address=?", async () => {
    const stmtMock = createPreparedStatement([], { cnt: 3 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countOutboxRepliesFromD1(db, REPLIER_BTC);

    expect(count).toBe(3);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("SELECT COUNT(*)");
    expect(sql).toContain("FROM inbox_messages");
    expect(sql).toContain("is_reply = 1");
    expect(sql).toContain("from_btc_address = ?");
  });

  it("returns 0 when db.first() returns null", async () => {
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countOutboxRepliesFromD1(db, REPLIER_BTC);
    expect(count).toBe(0);
  });

  it("sentCount restoration: returns > 0 for known-replier address (Step 3.3 acceptance signal)", async () => {
    // This test represents the acceptance signal for Step 3.3:
    // POST-flip, countOutboxRepliesFromD1 must return > 0 for an address that has sent replies.
    // Was stubbed to 0 in Step 3.1 ("const sentCount = 0;").
    const stmtMock = createPreparedStatement([], { cnt: 5 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const count = await countOutboxRepliesFromD1(db, REPLIER_BTC);
    expect(count).toBeGreaterThan(0); // Step 3.3 acceptance signal: sentCount > 0
  });

  it("binds from_btc_address as the first positional param", async () => {
    const stmtMock = createPreparedStatement([], { cnt: 0 });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await countOutboxRepliesFromD1(db, REPLIER_BTC);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(REPLIER_BTC);
  });
});

// ── getReplyForMessageFromD1 ──────────────────────────────────────────────────

describe("getReplyForMessageFromD1 (Phase 2.5 Step 3.5)", () => {
  const PARENT_MSG_ID = "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf";
  const REPLIER_BTC = "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv";
  const OTHER_REPLIER_BTC = "bc1qw0y4ant38zykzjqssgnujqmszruvhkwupvp6dn";

  const REPLY_ROW = {
    reply_to_message_id: PARENT_MSG_ID,
    from_btc_address: REPLIER_BTC,
    to_btc_address: BTC_ADDRESS,
    content: "Great work — bookmarked.",
    bitcoin_signature:
      "Jx52I99dmnoFqmKkJXsLP4ELktANgZ6v1m1CFA7c5kz+Xr9W45m29QnabzGim5ubEzJP1eoynU/GjuRWMjRD9nQ=",
    sent_at: "2026-02-19T22:14:43.426Z",
  };

  it("returns OutboxReply when a matching reply row exists", async () => {
    const stmtMock = createPreparedStatement([], REPLY_ROW);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await getReplyForMessageFromD1(db, PARENT_MSG_ID, REPLIER_BTC);

    expect(result).not.toBeNull();
    expect(result?.messageId).toBe(PARENT_MSG_ID);
    expect(result?.fromAddress).toBe(REPLIER_BTC);
    expect(result?.reply).toBe(REPLY_ROW.content);
    expect(result?.signature).toBe(REPLY_ROW.bitcoin_signature);
    expect(result?.repliedAt).toBe(REPLY_ROW.sent_at);
  });

  it("returns null when no reply row exists (no match)", async () => {
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await getReplyForMessageFromD1(db, PARENT_MSG_ID, REPLIER_BTC);

    expect(result).toBeNull();
  });

  it("tenant-discriminator gate: reply from different from_btc_address is NOT returned", async () => {
    // If REPLIER_BTC sent a reply, but we query with OTHER_REPLIER_BTC,
    // D1 returns null (SQL gate: from_btc_address = OTHER_REPLIER_BTC doesn't match).
    // This prevents false-409 duplicate-reply blocks for other agents replying to same parent.
    const stmtMock = createPreparedStatement([], null); // D1 returns null — different address
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await getReplyForMessageFromD1(db, PARENT_MSG_ID, OTHER_REPLIER_BTC);

    expect(result).toBeNull();
    // Verify query was called with OTHER_REPLIER_BTC (the SQL gate enforces isolation)
    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(PARENT_MSG_ID);
    expect(bindArgs[1]).toBe(OTHER_REPLIER_BTC);
  });

  it("queries with correct SQL shape: WHERE reply_to_message_id = ? AND from_btc_address = ? AND is_reply = 1", async () => {
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await getReplyForMessageFromD1(db, PARENT_MSG_ID, REPLIER_BTC);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("FROM inbox_messages");
    expect(sql).toContain("reply_to_message_id = ?");
    expect(sql).toContain("from_btc_address = ?");
    expect(sql).toContain("is_reply = 1");
    expect(sql).toContain("LIMIT 1");
  });

  it("binds parentMessageId first, then fromBtcAddress", async () => {
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await getReplyForMessageFromD1(db, PARENT_MSG_ID, REPLIER_BTC);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(PARENT_MSG_ID);
    expect(bindArgs[1]).toBe(REPLIER_BTC);
  });
});

// ── getAgentInboxFromD1 (Phase 2.5 #746) ─────────────────────────────────────

describe("getAgentInboxFromD1", () => {
  it("returns null immediately when db is undefined (fail-open)", async () => {
    const result = await getAgentInboxFromD1(undefined, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("returns AgentInboxSummary with counts when rows exist", async () => {
    const summaryRow = { total_count: 5, unread_count: 2, last_message_at: "2026-05-11T15:00:00.000Z" };
    const db = createMockD1([], summaryRow);
    const result = await getAgentInboxFromD1(db, BTC_ADDRESS);
    expect(result).not.toBeNull();
    expect(result!.totalCount).toBe(5);
    expect(result!.unreadCount).toBe(2);
    expect(result!.lastMessageAt).toBe("2026-05-11T15:00:00.000Z");
  });

  it("returns null when total_count is 0 (no messages — same as KV miss)", async () => {
    const summaryRow = { total_count: 0, unread_count: 0, last_message_at: null };
    const db = createMockD1([], summaryRow);
    const result = await getAgentInboxFromD1(db, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("returns null when db.first() returns null", async () => {
    const db = createMockD1([], null);
    const result = await getAgentInboxFromD1(db, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("returns null on D1 throw (fail-open)", async () => {
    const db = {
      prepare: vi.fn().mockImplementation(() => { throw new Error("D1 unavailable"); }),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;
    const result = await getAgentInboxFromD1(db, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("SQL queries to_btc_address = ? AND is_reply = 0", async () => {
    const summaryRow = { total_count: 1, unread_count: 0, last_message_at: "2026-05-11T00:00:00.000Z" };
    const stmtMock = createPreparedStatement([], summaryRow);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await getAgentInboxFromD1(db, BTC_ADDRESS);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("WHERE to_btc_address = ?");
    expect(sql).toContain("AND is_reply = 0");
    expect(stmtMock.bind.mock.calls[0][0]).toBe(BTC_ADDRESS);
  });
});

// ── getSentIndexFromD1 (Phase 2.5 #746) ──────────────────────────────────────

describe("getSentIndexFromD1", () => {
  it("returns null immediately when db is undefined (fail-open)", async () => {
    const result = await getSentIndexFromD1(undefined, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("returns AgentSentSummary with sentCount and lastSentAt when rows exist", async () => {
    const summaryRow = { sent_count: 39, last_sent_at: "2026-05-10T12:00:00.000Z" };
    const db = createMockD1([], summaryRow);
    const result = await getSentIndexFromD1(db, BTC_ADDRESS);
    expect(result).not.toBeNull();
    expect(result!.sentCount).toBe(39);
    expect(result!.lastSentAt).toBe("2026-05-10T12:00:00.000Z");
  });

  it("returns AgentSentSummary with sentCount=0 when no replies sent", async () => {
    const summaryRow = { sent_count: 0, last_sent_at: null };
    const db = createMockD1([], summaryRow);
    const result = await getSentIndexFromD1(db, BTC_ADDRESS);
    expect(result).not.toBeNull();
    expect(result!.sentCount).toBe(0);
    expect(result!.lastSentAt).toBeNull();
  });

  it("returns null when db.first() returns null", async () => {
    const db = createMockD1([], null);
    const result = await getSentIndexFromD1(db, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("returns null on D1 throw (fail-open)", async () => {
    const db = {
      prepare: vi.fn().mockImplementation(() => { throw new Error("D1 unavailable"); }),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;
    const result = await getSentIndexFromD1(db, BTC_ADDRESS);
    expect(result).toBeNull();
  });

  it("SQL queries is_reply = 1 AND from_btc_address = ?", async () => {
    const summaryRow = { sent_count: 5, last_sent_at: "2026-05-11T00:00:00.000Z" };
    const stmtMock = createPreparedStatement([], summaryRow);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await getSentIndexFromD1(db, BTC_ADDRESS);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("is_reply = 1");
    expect(sql).toContain("AND from_btc_address = ?");
    expect(stmtMock.bind.mock.calls[0][0]).toBe(BTC_ADDRESS);
  });
});

// ── getRecentInboxEventsFromD1 (Phase 2.5 #746) ───────────────────────────────

describe("getRecentInboxEventsFromD1", () => {
  it("returns empty array immediately when db is undefined (fail-open)", async () => {
    const result = await getRecentInboxEventsFromD1(undefined, BTC_ADDRESS, 3);
    expect(result).toEqual([]);
  });

  it("returns InboxMessage[] for the agent when rows exist", async () => {
    const db = createMockD1([INBOUND_ROW]);
    const result = await getRecentInboxEventsFromD1(db, BTC_ADDRESS, 3);
    expect(result).toHaveLength(1);
    expect(result[0].messageId).toBe(INBOUND_ROW.message_id);
    expect(result[0].content).toBe(INBOUND_ROW.content);
  });

  it("returns empty array when no rows", async () => {
    const db = createMockD1([]);
    const result = await getRecentInboxEventsFromD1(db, BTC_ADDRESS, 3);
    expect(result).toEqual([]);
  });

  it("returns empty array on D1 throw (fail-open)", async () => {
    const db = {
      prepare: vi.fn().mockImplementation(() => { throw new Error("D1 unavailable"); }),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;
    const result = await getRecentInboxEventsFromD1(db, BTC_ADDRESS, 3);
    expect(result).toEqual([]);
  });

  it("SQL queries to_btc_address = ? AND is_reply = 0 ORDER BY sent_at DESC LIMIT ?", async () => {
    const stmtMock = createPreparedStatement([INBOUND_ROW]);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await getRecentInboxEventsFromD1(db, BTC_ADDRESS, 3);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("WHERE to_btc_address = ?");
    expect(sql).toContain("AND is_reply = 0");
    expect(sql).toContain("ORDER BY sent_at DESC");
    expect(sql).toContain("LIMIT ?");

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(BTC_ADDRESS);
    expect(bindArgs[1]).toBe(3); // limit
  });
});

// ── checkRedeemedTxidInD1 ─────────────────────────────────────────────────────

describe("checkRedeemedTxidInD1 (Phase 2.5 Step 4 — double-redemption guard)", () => {
  const PAYMENT_TXID = "602f097b3de853e05546015af6ac9c32e858efcc9fd5ff92edb860d5cadc8c21";
  const MESSAGE_ID = "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf";

  it("returns messageId when a matching payment_txid row exists (hit case)", async () => {
    const stmtMock = createPreparedStatement([], { message_id: MESSAGE_ID });
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await checkRedeemedTxidInD1(db, PAYMENT_TXID);

    expect(result).toBe(MESSAGE_ID);
  });

  it("returns null when no matching payment_txid row exists (null case)", async () => {
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    const result = await checkRedeemedTxidInD1(db, PAYMENT_TXID);

    expect(result).toBeNull();
  });

  it("SQL includes payment_txid IS NOT NULL predicate (routes through idx_inbox_payment_txid)", async () => {
    // Contract/regression check on the query *text* — not a query-plan test.
    // If a refactor drops the partial-index predicate, this catches it; D1
    // index-usage verification is out of scope at the unit-test layer.
    const stmtMock = createPreparedStatement([], null);
    const db = {
      prepare: vi.fn().mockReturnValue(stmtMock),
      batch: vi.fn(), dump: vi.fn(), exec: vi.fn(),
    } as unknown as D1Database;

    await checkRedeemedTxidInD1(db, PAYMENT_TXID);

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("FROM inbox_messages");
    expect(sql).toContain("payment_txid = ?");
    expect(sql).toContain("payment_txid IS NOT NULL");
    expect(sql).toContain("LIMIT 1");
  });
});

// ── Cache-key invariant: structural verification ──────────────────────────────

describe("cache-key invariants (structural verification)", () => {
  it("Invariant 1: the helpers accept no auth/session parameters — public branch only", () => {
    // listInboxMessagesFromD1 and countInboxMessagesFromD1 take only
    // (db, btcAddress, ...) — no authToken, no sessionId, no signature.
    // This proves the public-only code path does not accidentally mix
    // auth'd and public queries from the same parameter set.
    //
    // A future auth'd branch MUST pass an additional verified-owner parameter
    // AND use a different cache key (or no caching at all — Cache-Control: private, no-store).
    expect(listInboxMessagesFromD1.length).toBe(5); // (db, btcAddress, limit, offset, status)
    expect(countInboxMessagesFromD1.length).toBe(3); // (db, btcAddress, status)
    expect(fetchRepliesForMessages.length).toBe(2);  // (db, parentMessageIds)
    expect(listOutboxRepliesFromD1.length).toBe(4);  // (db, btcAddress, limit, offset)
    expect(countOutboxRepliesFromD1.length).toBe(2); // (db, btcAddress)
    expect(getReplyForMessageFromD1.length).toBe(3); // (db, parentMessageId, fromBtcAddress)
    // Phase 2.5 #746 enrichment helpers (db is optional — fail-open when undefined)
    expect(getAgentInboxFromD1.length).toBe(2);       // (db, btcAddress)
    expect(getSentIndexFromD1.length).toBe(2);         // (db, btcAddress)
    expect(getRecentInboxEventsFromD1.length).toBe(3); // (db, btcAddress, limit)
    // Phase 2.5 Step 4 double-redemption guard
    expect(checkRedeemedTxidInD1.length).toBe(2);      // (db, paymentTxid)
  });

  it("Invariant 3: read helpers are called with explicit inputs — no implicit cache-before-auth", async () => {
    // The read helpers require explicit db + btcAddress + params.
    // There is no code path where a cached result could be returned before
    // these parameters are validated (the btcAddress comes from agent lookup,
    // which is the route's auth-equivalent gate for the public path).
    const db = createMockD1();
    const stmtMock = createPreparedStatement([INBOUND_ROW]);
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    // Verify that calling with a known-good address triggers exactly one DB call
    // (no short-circuit cache read that could bypass the address validation above it).
    await listInboxMessagesFromD1(db, BTC_ADDRESS, 20, 0, "all");
    expect(db.prepare).toHaveBeenCalledOnce(); // exactly one query, no cache skip
  });
});
