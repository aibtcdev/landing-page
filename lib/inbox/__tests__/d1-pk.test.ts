import { describe, expect, it } from "vitest";
import { REPLY_D1_PK_PREFIX, deriveReplyD1Id } from "../d1-pk";

describe("d1-pk", () => {
  it("prefix is 'reply_'", () => {
    expect(REPLY_D1_PK_PREFIX).toBe("reply_");
  });

  it("helper prepends prefix to parent messageId", () => {
    expect(deriveReplyD1Id("msg_1234")).toBe("reply_msg_1234");
  });

  it("helper is deterministic", () => {
    const id = "msg_abc123";
    expect(deriveReplyD1Id(id)).toBe(deriveReplyD1Id(id));
  });

  it("reply PK is distinct from the inbound row's PK", () => {
    const parentId = "msg_xyz";
    expect(deriveReplyD1Id(parentId)).not.toBe(parentId);
  });
});
