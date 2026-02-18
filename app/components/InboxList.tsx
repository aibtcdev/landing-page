"use client";

import { useState } from "react";
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
 * Accordion-style inbox list container.
 *
 * Only one row expanded at a time. Renders rows inside
 * a divide-y container for clean row separation.
 */
export default function InboxList({
  messages,
  replies = {},
  ownerBtcAddress,
  compact = false,
  maxRows,
}: InboxListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visibleMessages = maxRows ? messages.slice(0, maxRows) : messages;

  return (
    <div className="divide-y divide-white/[0.04]">
      {visibleMessages.map((message) => (
        <InboxRow
          key={message.messageId}
          message={message}
          reply={replies[message.messageId] || null}
          ownerBtcAddress={ownerBtcAddress}
          expanded={expandedId === message.messageId}
          onToggle={() =>
            setExpandedId(
              expandedId === message.messageId ? null : message.messageId
            )
          }
          compact={compact}
        />
      ))}
    </div>
  );
}
