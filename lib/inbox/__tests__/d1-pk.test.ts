import { describe, it, expect } from "vitest";
import { REPLY_D1_PK_PREFIX, deriveReplyD1Id } from "../d1-pk";

describe("REPLY_D1_PK_PREFIX", () => {
  it('prefix value is "reply_"', () => {
    expect(REPLY_D1_PK_PREFIX).toBe("reply_");
  });
});

describe("deriveReplyD1Id", () => {
  it("prepends REPLY_D1_PK_PREFIX to the parent messageId", () => {
    const parentId = "msg_1234";
    const result = deriveReplyD1Id(parentId);
    expect(result).toBe(`${REPLY_D1_PK_PREFIX}${parentId}`);
  });

  it("is deterministic — same input always returns same output", () => {
    const parentId = "msg_abcdef";
    expect(deriveReplyD1Id(parentId)).toBe(deriveReplyD1Id(parentId));
  });

  it("reply PK is distinct from the inbound row PK (no collision)", () => {
    const parentId = "msg_5678";
    const replyPk = deriveReplyD1Id(parentId);
    expect(replyPk).not.toBe(parentId);
  });

  it("matches the expected full PK for a representative message ID", () => {
    expect(deriveReplyD1Id("msg_1234")).toBe("reply_msg_1234");
  });
});
