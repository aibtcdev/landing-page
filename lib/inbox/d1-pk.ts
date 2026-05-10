/**
 * D1 primary-key helpers for the inbox_messages table.
 *
 * KV stores two shapes under the same messageId:
 *   inbox:message:{messageId}  — inbound (InboxMessage)
 *   inbox:reply:{messageId}    — reply (OutboxReply), keyed by the PARENT's ID
 *
 * If both rows used the KV-derived ID directly, they would collide on the
 * message_id PK. Reply rows therefore get a synthesized PK by prepending this
 * prefix to the parent's messageId.
 *
 * See: https://github.com/aibtcdev/landing-page/issues/673
 */

/** Prefix applied to the parent messageId to form a reply row's D1 PK. */
export const REPLY_D1_PK_PREFIX = "reply_";

/**
 * Returns the D1 primary key for a reply row given its parent's messageId.
 *
 * Caller contract: `parentMessageId` must not begin with `REPLY_D1_PK_PREFIX`.
 * Upstream message IDs are relay-sourced and structurally cannot carry this prefix.
 *
 * This derivation is intentionally one-way. To find the parent of a reply row,
 * use the `reply_to_message_id` FK column plus the `is_reply` discriminator —
 * do not strip this prefix from the synthesized PK.
 *
 * @example
 * deriveReplyD1Id("msg_1234") // => "reply_msg_1234"
 */
export function deriveReplyD1Id(parentMessageId: string): string {
  return `${REPLY_D1_PK_PREFIX}${parentMessageId}`;
}
