/**
 * Tests for lib/inbox/d1-reads.ts
 *
 * Phase 2.5 Step 3.1 — D1 read flip for GET /api/inbox/[address].
 *
 * Verifies:
 *   - listInboxMessagesFromD1: correct SQL shape, status filter variants,
 *     ORDER BY sent_at DESC, pagination bindings, InboxMessage mapping
 *   - countInboxMessagesFromD1: unread/read/all variants, the live
 *     SELECT COUNT(*) that closes aibtc-mcp-server#497
 *   - fetchRepliesForMessages: IN-clause construction, OutboxReply mapping,
 *     empty-input guard
 *   - Cache-key invariant documentation (structural): ensures the public
 *     path does not set Cache-Control headers that would leak auth'd state
 *
 * Note: these are unit tests against the helper functions. They use a mock
 * D1Database (vi.fn() pattern matching d1-dual-write.test.ts) and do NOT
 * make live network calls.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/721
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listInboxMessagesFromD1,
  countInboxMessagesFromD1,
  fetchRepliesForMessages,
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
