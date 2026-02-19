"use client";

import InboxRow from "./InboxRow";
import type { InboxMessageWithPeer } from "./InboxRow";
import type { OutboxReply } from "@/lib/inbox/types";

interface InboxListProps {
  messages: InboxMessageWithPeer[];
  replies?: Record<string, OutboxReply>;
  ownerBtcAddress?: string;
  compact?: boolean;
  maxRows?: number;
}

/**
 * Inbox message list — all messages visible as cards.
 * No accordion — you can read every message at a glance.
 */
export default function InboxList({
  messages,
  replies = {},
  ownerBtcAddress,
  compact = false,
  maxRows,
}: InboxListProps) {
  const visibleMessages = maxRows ? messages.slice(0, maxRows) : messages;

  return (
    <div className="divide-y divide-white/[0.08]">
      {visibleMessages.map((message) => (
        <InboxRow
          key={message.messageId}
          message={message}
          reply={replies[message.messageId] || null}
          ownerBtcAddress={ownerBtcAddress}
          compact={compact}
        />
      ))}
    </div>
  );
}
