import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { lookupAgent } from "@/lib/agent-lookup";
import type { InboxAgentIndex, InboxMessage, SentMessageIndex } from "@/lib/inbox/types";

/**
 * GET /api/admin/backfill-sent — Self-documenting endpoint.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/backfill-sent",
    description:
      "One-time backfill: scan all inbox indices and build inbox:sent:{btcAddress} indices for senders.",
    method: "POST",
    headers: { "X-Admin-Key": "required" },
    parameters: {
      dryRun:
        "If true, report what would be written without writing (default: false)",
    },
  });
}

/**
 * POST /api/admin/backfill-sent — Backfill sent message indices.
 *
 * Scans all inbox:agent:* keys, reads each message, resolves the sender's
 * BTC address from their STX fromAddress, and builds inbox:sent:* indices.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Parse optional body
  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: boolean };
    dryRun = body?.dryRun === true;
  } catch {
    // no body is fine
  }

  // Step 1: List all inbox:agent:* keys
  const inboxKeys: string[] = [];
  let cursor: string | undefined;
  let listComplete = false;

  while (!listComplete) {
    const result = await kv.list({ prefix: "inbox:agent:", cursor });
    for (const key of result.keys) {
      inboxKeys.push(key.name);
    }
    listComplete = result.list_complete;
    cursor = !result.list_complete ? result.cursor : undefined;
  }

  // Step 2: Read all inbox indices
  const allMessageIds = new Set<string>();
  for (const key of inboxKeys) {
    const data = await kv.get(key);
    if (!data) continue;
    try {
      const index = JSON.parse(data) as InboxAgentIndex;
      for (const id of index.messageIds) {
        allMessageIds.add(id);
      }
    } catch {
      // skip bad data
    }
  }

  // Step 3: Read all messages and group by sender STX address
  const senderMessages = new Map<
    string,
    { messageId: string; sentAt: string }[]
  >();

  // Batch reads (50 at a time to avoid overwhelming KV)
  const messageIdArray = Array.from(allMessageIds);
  for (let i = 0; i < messageIdArray.length; i += 50) {
    const batch = messageIdArray.slice(i, i + 50);
    const results = await Promise.all(
      batch.map((id) => kv.get(`inbox:message:${id}`))
    );

    for (const raw of results) {
      if (!raw) continue;
      try {
        const msg = JSON.parse(raw) as InboxMessage;
        if (!msg.fromAddress || msg.fromAddress === "unknown") continue;

        const existing = senderMessages.get(msg.fromAddress) || [];
        existing.push({ messageId: msg.messageId, sentAt: msg.sentAt });
        senderMessages.set(msg.fromAddress, existing);
      } catch {
        // skip bad data
      }
    }
  }

  // Step 4: Resolve sender STX addresses to BTC addresses
  const sentIndices = new Map<string, SentMessageIndex>();
  let resolvedCount = 0;
  let unresolvedCount = 0;

  for (const [stxAddress, messages] of senderMessages) {
    const agent = await lookupAgent(kv, stxAddress);
    if (!agent) {
      unresolvedCount++;
      continue;
    }
    resolvedCount++;

    // Sort messages by sentAt ascending (chronological order for the index)
    messages.sort(
      (a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
    );

    // Check for existing sent index and merge
    const existingRaw = await kv.get(`inbox:sent:${agent.btcAddress}`);
    let existingIds: string[] = [];
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as SentMessageIndex;
        existingIds = existing.messageIds;
      } catch {
        // ignore
      }
    }

    const allIds = new Set([...existingIds, ...messages.map((m) => m.messageId)]);
    const lastSentAt =
      messages.length > 0 ? messages[messages.length - 1].sentAt : null;

    sentIndices.set(agent.btcAddress, {
      btcAddress: agent.btcAddress,
      messageIds: Array.from(allIds),
      lastSentAt,
    });
  }

  // Step 5: Write sent indices (unless dry run)
  if (!dryRun) {
    for (const [btcAddress, index] of sentIndices) {
      await kv.put(`inbox:sent:${btcAddress}`, JSON.stringify(index));
    }
  }

  // Build summary
  const summary = Array.from(sentIndices.entries()).map(
    ([btcAddress, index]) => ({
      btcAddress,
      sentCount: index.messageIds.length,
      lastSentAt: index.lastSentAt,
    })
  );

  return NextResponse.json({
    success: true,
    dryRun,
    stats: {
      inboxIndicesScanned: inboxKeys.length,
      uniqueMessagesFound: allMessageIds.size,
      uniqueSenders: senderMessages.size,
      sendersResolved: resolvedCount,
      sendersUnresolved: unresolvedCount,
      sentIndicesWritten: dryRun ? 0 : sentIndices.size,
    },
    indices: summary,
  });
}
