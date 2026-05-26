/**
 * Tests for lib/inbox/d1-dual-write.ts
 *
 * Phase 2.5 Step 1 — reversible scaffolding.
 * Verifies:
 *  - insertInboundMessageToD1 calls D1 with correct column mapping and is_reply=0
 *  - insertReplyToD1 calls D1 with is_reply=1 and synthesized message_id via deriveReplyD1Id
 *  - insertReplyToD1 resolves STX toBtcAddress to BTC via KV lookup
 *  - insertReplyToD1 throws when BTC address cannot be resolved (caller catches)
 *  - Both helpers use ON CONFLICT(message_id) DO NOTHING (idempotent)
 *  - resolveReplyRecipientBtcAddress passes BTC addresses through unchanged
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  insertInboundMessageToD1,
  insertReplyToD1,
  markMessageReadAndDecrementStats,
  resolveReplyRecipientBtcAddress,
  updateMessageStateD1,
} from "../d1-dual-write";
import { deriveReplyD1Id } from "../d1-pk";
import type { InboxMessage, OutboxReply } from "../types";

// ---- D1 mock ----------------------------------------------------------------

/** Build a minimal D1 PreparedStatement mock. */
function createPreparedStatement(runResult: { meta: { changes: number } } = { meta: { changes: 1 } }) {
  const stmt = {
    bind: vi.fn(),
    run: vi.fn().mockResolvedValue(runResult),
    first: vi.fn(),
    all: vi.fn(),
    raw: vi.fn(),
  };
  // bind() returns the same stmt (chainable)
  stmt.bind.mockReturnValue(stmt);
  return stmt;
}

function createMockD1(runResult?: { meta: { changes: number } }): D1Database {
  const stmt = createPreparedStatement(runResult);
  return {
    prepare: vi.fn().mockReturnValue(stmt),
    batch: vi.fn(),
    dump: vi.fn(),
    exec: vi.fn(),
  } as unknown as D1Database;
}

// ---- KV mock ----------------------------------------------------------------

function createMockKV(data: Record<string, string> = {}): KVNamespace {
  return {
    get: vi.fn(async (key: string) => data[key] ?? null),
    put: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    getWithMetadata: vi.fn(),
  } as unknown as KVNamespace;
}

// ---- Fixtures ---------------------------------------------------------------

const INBOUND_MESSAGE: InboxMessage = {
  messageId: "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf",
  fromAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE",
  toBtcAddress: "bc1qyu22hyqr406pus0g9jmfytk4ss5z8qsje74l76",
  toStxAddress: "SPKH9AWG0ENZ87J1X0PBD4HETP22G8W22AFNVF8K",
  content: "gm agent — shipping update today",
  paymentTxid: "602f097b3de853e05546015af6ac9c32e858efcc9fd5ff92edb860d5cadc8c21",
  paymentSatoshis: 100,
  sentAt: "2026-02-18T02:26:42.598Z",
  authenticated: false,
};

const OUTBOX_REPLY: OutboxReply = {
  messageId: "msg_1771381860132_537377a5-2550-4753-a11f-841e9ddecd90",
  fromAddress: "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv",
  toBtcAddress: "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE", // STX address — must be resolved
  reply: "Great work — bookmarked.",
  signature: "Jx52I99dmnoFqmKkJXsLP4ELktANgZ6v1m1CFA7c5kz+Xr9W45m29QnabzGim5ubEzJP1eoynU/GjuRWMjRD9nQ=",
  repliedAt: "2026-02-19T22:14:43.426Z",
};

const STX_SENDER_BTC = "bc1qoriginal1111111111111111111111111111111";

// ── resolveReplyRecipientBtcAddress ──────────────────────────────────────────

describe("resolveReplyRecipientBtcAddress", () => {
  it("returns BTC address unchanged when already BTC-shaped (bc1q...)", async () => {
    const kv = createMockKV();
    const btcAddr = "bc1qp66jvxe765wgwpzqk8kcrmgh2mucyxg540mtzv";
    const result = await resolveReplyRecipientBtcAddress(kv, btcAddr);
    expect(result).toBe(btcAddr);
    expect(kv.get).not.toHaveBeenCalled();
  });

  it("resolves STX address to BTC address via KV lookup", async () => {
    const stxAddr = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";
    const kv = createMockKV({
      [`stx:${stxAddr}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });
    const result = await resolveReplyRecipientBtcAddress(kv, stxAddr);
    expect(result).toBe(STX_SENDER_BTC);
    expect(kv.get).toHaveBeenCalledWith(`stx:${stxAddr}`);
  });

  it("returns null when STX address KV record not found", async () => {
    const kv = createMockKV();
    const result = await resolveReplyRecipientBtcAddress(kv, "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE");
    expect(result).toBeNull();
  });

  it("returns null when KV record has no btcAddress field", async () => {
    const stxAddr = "SP4DXVEC16FS6QR7RBKGWZYJKTXPC81W49W0ATJE";
    const kv = createMockKV({ [`stx:${stxAddr}`]: JSON.stringify({ stxAddress: stxAddr }) });
    const result = await resolveReplyRecipientBtcAddress(kv, stxAddr);
    expect(result).toBeNull();
  });
});

// ── insertInboundMessageToD1 ─────────────────────────────────────────────────

describe("insertInboundMessageToD1", () => {
  it("calls D1 prepare() with an INSERT INTO inbox_messages statement", async () => {
    const db = createMockD1();
    await insertInboundMessageToD1(db, INBOUND_MESSAGE);
    expect(db.prepare).toHaveBeenCalledOnce();
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("INSERT INTO inbox_messages");
  });

  it("uses ON CONFLICT(message_id) DO NOTHING for idempotency", async () => {
    const db = createMockD1();
    await insertInboundMessageToD1(db, INBOUND_MESSAGE);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ON CONFLICT(message_id) DO NOTHING");
  });

  it("passes is_reply=0 as the second positional bind parameter", async () => {
    const db = createMockD1();
    await insertInboundMessageToD1(db, INBOUND_MESSAGE);
    // is_reply=0 is hardcoded in the SQL literal, not a bind param — verify SQL contains ", 0,"
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain(", 0,"); // "?, 0, ?," — is_reply literal
  });

  it("binds message_id to message.messageId", async () => {
    const db = createMockD1();
    // After prepare() is called, get the stmt mock to inspect bind args
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await insertInboundMessageToD1(db, INBOUND_MESSAGE);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(INBOUND_MESSAGE.messageId);
  });

  it("binds from_stx_address to message.fromAddress", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await insertInboundMessageToD1(db, INBOUND_MESSAGE);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // fromAddress is the 3rd bind param (after messageId, replyTo)
    expect(bindArgs[2]).toBe(INBOUND_MESSAGE.fromAddress);
  });

  it("binds to_btc_address to message.toBtcAddress", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await insertInboundMessageToD1(db, INBOUND_MESSAGE);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[3]).toBe(INBOUND_MESSAGE.toBtcAddress);
  });

  it("binds paymentTxid as null when absent", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    const msgWithoutTxid = { ...INBOUND_MESSAGE, paymentTxid: undefined };
    await insertInboundMessageToD1(db, msgWithoutTxid);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // paymentTxid is bound after content (index 6 = messageId, replyTo, fromStx, toBtc, toStx, content, paymentTxid)
    // => index 6
    expect(bindArgs[6]).toBeNull();
  });

  it("resolves and calls .run()", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await insertInboundMessageToD1(db, INBOUND_MESSAGE);

    expect(stmtMock.run).toHaveBeenCalledOnce();
  });
});

// ── insertReplyToD1 ───────────────────────────────────────────────────────────

describe("insertReplyToD1", () => {
  it("calls D1 prepare() with an INSERT INTO inbox_messages statement", async () => {
    const db = createMockD1();
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });
    await insertReplyToD1(db, kv, OUTBOX_REPLY);
    expect(db.prepare).toHaveBeenCalledOnce();
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("INSERT INTO inbox_messages");
  });

  it("uses ON CONFLICT(message_id) DO NOTHING for idempotency", async () => {
    const db = createMockD1();
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });
    await insertReplyToD1(db, kv, OUTBOX_REPLY);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("ON CONFLICT(message_id) DO NOTHING");
  });

  it("synthesizes message_id via deriveReplyD1Id (not the parent ID directly)", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });

    await insertReplyToD1(db, kv, OUTBOX_REPLY);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // First bind param is message_id — must be the derived reply PK, not the parent
    expect(bindArgs[0]).toBe(deriveReplyD1Id(OUTBOX_REPLY.messageId));
    expect(bindArgs[0]).not.toBe(OUTBOX_REPLY.messageId);
  });

  it("sets is_reply=1 as a SQL literal in the statement", async () => {
    const db = createMockD1();
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });
    await insertReplyToD1(db, kv, OUTBOX_REPLY);
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain(", 1,"); // is_reply=1 literal
  });

  it("binds reply_to_message_id to the parent messageId", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });

    await insertReplyToD1(db, kv, OUTBOX_REPLY);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // Second bind param is reply_to_message_id = parent's messageId unchanged
    expect(bindArgs[1]).toBe(OUTBOX_REPLY.messageId);
  });

  it("resolves STX toBtcAddress to BTC via KV and binds resolved address", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });

    await insertReplyToD1(db, kv, OUTBOX_REPLY);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // to_btc_address (4th bind param: replyMsgId, replyToId, fromBtc, toBtc)
    expect(bindArgs[3]).toBe(STX_SENDER_BTC);
    // Must NOT be the raw STX address
    expect(bindArgs[3]).not.toBe(OUTBOX_REPLY.toBtcAddress);
  });

  it("binds from_btc_address to reply.fromAddress", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });

    await insertReplyToD1(db, kv, OUTBOX_REPLY);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // from_btc_address (3rd bind param)
    expect(bindArgs[2]).toBe(OUTBOX_REPLY.fromAddress);
  });

  it("binds content to reply.reply field", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });

    await insertReplyToD1(db, kv, OUTBOX_REPLY);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // content is 5th bind param (replyMsgId, replyToId, fromBtc, toBtc, reply.reply)
    expect(bindArgs[4]).toBe(OUTBOX_REPLY.reply);
  });

  it("throws when reply recipient BTC address cannot be resolved", async () => {
    const db = createMockD1();
    const kv = createMockKV(); // empty — STX lookup will return null

    await expect(
      insertReplyToD1(db, kv, OUTBOX_REPLY)
    ).rejects.toThrow(/Unable to resolve reply recipient BTC address/);

    // D1 should NOT have been called — resolution failure aborts before INSERT
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("resolves and calls .run()", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV({
      [`stx:${OUTBOX_REPLY.toBtcAddress}`]: JSON.stringify({ btcAddress: STX_SENDER_BTC }),
    });

    await insertReplyToD1(db, kv, OUTBOX_REPLY);

    expect(stmtMock.run).toHaveBeenCalledOnce();
  });

  it("works when toBtcAddress is already a BTC address (no KV lookup needed)", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);
    const kv = createMockKV(); // no KV data needed

    const replyWithBtcRecipient: OutboxReply = {
      ...OUTBOX_REPLY,
      toBtcAddress: "bc1qoriginal_sender_btc_address_here_111111",
    };

    await insertReplyToD1(db, kv, replyWithBtcRecipient);

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // to_btc_address = the BTC address passed through unchanged
    expect(bindArgs[3]).toBe(replyWithBtcRecipient.toBtcAddress);
    expect(kv.get).not.toHaveBeenCalled();
  });
});

// ── updateMessageStateD1 ──────────────────────────────────────────────────────

describe("updateMessageStateD1", () => {
  const MSG_ID = "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf";
  const READ_AT = "2026-05-10T12:00:00.000Z";
  const REPLIED_AT = "2026-05-10T12:05:00.000Z";

  it("is a noop when updates object is empty — does not call D1", async () => {
    const db = createMockD1();
    await updateMessageStateD1(db, MSG_ID, {});
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("builds a single-clause UPDATE when only readAt is provided", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { readAt: READ_AT });

    expect(db.prepare).toHaveBeenCalledOnce();
    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("UPDATE inbox_messages SET");
    expect(sql).toContain("read_at = ?");
    expect(sql).not.toContain("replied_at");
  });

  it("binds readAt and messageId in correct order for single-field update", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { readAt: READ_AT });

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(READ_AT);    // first SET value
    expect(bindArgs[1]).toBe(MSG_ID);     // WHERE message_id = ?
  });

  it("builds a single-clause UPDATE when only repliedAt is provided", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { repliedAt: REPLIED_AT });

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("replied_at = ?");
    expect(sql).not.toContain("read_at");
  });

  it("binds repliedAt and messageId in correct order for single-field update", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { repliedAt: REPLIED_AT });

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(REPLIED_AT);
    expect(bindArgs[1]).toBe(MSG_ID);
  });

  it("builds a two-clause UPDATE when both readAt and repliedAt are provided", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { readAt: READ_AT, repliedAt: REPLIED_AT });

    const sql: string = (db.prepare as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sql).toContain("read_at = ?");
    expect(sql).toContain("replied_at = ?");
  });

  it("binds readAt, repliedAt, and messageId in correct order for two-field update", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { readAt: READ_AT, repliedAt: REPLIED_AT });

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    expect(bindArgs[0]).toBe(READ_AT);     // first SET value
    expect(bindArgs[1]).toBe(REPLIED_AT);  // second SET value
    expect(bindArgs[2]).toBe(MSG_ID);      // WHERE message_id = ?
  });

  it("calls .run() on the prepared statement", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    await updateMessageStateD1(db, MSG_ID, { readAt: READ_AT });

    expect(stmtMock.run).toHaveBeenCalledOnce();
  });

  it("targets the correct row via WHERE message_id = ?", async () => {
    const db = createMockD1();
    const stmtMock = createPreparedStatement();
    (db.prepare as ReturnType<typeof vi.fn>).mockReturnValue(stmtMock);

    const customMsgId = "msg_custom_id_for_test";
    await updateMessageStateD1(db, customMsgId, { readAt: READ_AT });

    const bindArgs: unknown[] = stmtMock.bind.mock.calls[0];
    // Last bind param must be the messageId (WHERE clause)
    expect(bindArgs[bindArgs.length - 1]).toBe(customMsgId);
  });
});

// ── markMessageReadAndDecrementStats ─────────────────────────────────────────

describe("markMessageReadAndDecrementStats", () => {
  const MSG_ID = "msg_1771381602504_30487f5e-1f3a-473a-8068-e040295a76bf";
  const BTC_ADDRESS = "bc1qyu22hyqr406pus0g9jmfytk4ss5z8qsje74l76";
  const READ_AT = "2026-05-10T12:00:00.000Z";

  function createBatchDb(markChanges: number) {
    const stmts: Array<{
      bind: ReturnType<typeof vi.fn>;
      run: ReturnType<typeof vi.fn>;
      first: ReturnType<typeof vi.fn>;
      all: ReturnType<typeof vi.fn>;
      raw: ReturnType<typeof vi.fn>;
    }> = [];
    const prepare = vi.fn(() => {
      const stmt = {
        bind: vi.fn(),
        run: vi.fn(),
        first: vi.fn(),
        all: vi.fn(),
        raw: vi.fn(),
      };
      stmt.bind.mockReturnValue(stmt);
      stmts.push(stmt);
      return stmt;
    });
    const batch = vi.fn().mockResolvedValue([
      { meta: { changes: markChanges } },
      { meta: { changes: markChanges } },
    ]);
    const db = {
      prepare,
      batch,
      dump: vi.fn(),
      exec: vi.fn(),
    } as unknown as D1Database;
    return { db, prepare, batch, stmts };
  }

  it("batches read_at update with guarded stats decrement", async () => {
    const { db, prepare, batch } = createBatchDb(1);

    const result = await markMessageReadAndDecrementStats(
      db,
      MSG_ID,
      BTC_ADDRESS,
      READ_AT
    );

    expect(result.changes).toBe(1);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(batch).toHaveBeenCalledOnce();

    const markSql = (prepare.mock.calls[0] as unknown[])[0] as string;
    expect(markSql).toContain("UPDATE inbox_messages");
    expect(markSql).toContain("read_at IS NULL");

    const statsSql = (prepare.mock.calls[1] as unknown[])[0] as string;
    expect(statsSql).toContain("UPDATE agent_inbox_stats");
    expect(statsSql).toContain("unread_count = MAX(0, unread_count - 1)");
    expect(statsSql).toContain("read_at = ?");
  });

  it("binds the exact read_at timestamp into the stats guard", async () => {
    const { db, stmts } = createBatchDb(1);

    await markMessageReadAndDecrementStats(db, MSG_ID, BTC_ADDRESS, READ_AT);

    expect(stmts[0].bind.mock.calls[0]).toEqual([READ_AT, MSG_ID, BTC_ADDRESS]);
    expect(stmts[1].bind.mock.calls[0]).toEqual([
      expect.any(String),
      BTC_ADDRESS,
      MSG_ID,
      BTC_ADDRESS,
      READ_AT,
    ]);
  });

  it("returns zero changes when the guarded message update did not change a row", async () => {
    const { db } = createBatchDb(0);

    const result = await markMessageReadAndDecrementStats(
      db,
      MSG_ID,
      BTC_ADDRESS,
      READ_AT
    );

    expect(result.changes).toBe(0);
  });
});
