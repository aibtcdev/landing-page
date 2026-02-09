import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { validateMessageBody } from "@/lib/attention/validation";
import { AttentionMessage } from "@/lib/attention/types";
import { KV_PREFIXES } from "@/lib/attention/constants";
import { kvListAll } from "@/lib/attention/kv-helpers";

/**
 * GET /api/paid-attention/admin/message
 *
 * Query attention messages. Requires admin auth for all requests.
 *   (no params)         — self-documenting usage instructions
 *   ?current=true       — get current active message
 *   ?archived=true      — list all archived messages
 *   ?messageId=msg_123  — look up specific archived message
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    const { searchParams } = new URL(request.url);
    const current = searchParams.get("current");
    const archived = searchParams.get("archived");
    const messageId = searchParams.get("messageId");

    // Self-documentation
    if (!current && !archived && !messageId) {
      return NextResponse.json({
        endpoint: "/api/paid-attention/admin/message",
        description:
          "Manage attention messages. Rotate to new messages, query current and archived messages.",
        authentication: "Requires X-Admin-Key header",
        methods: {
          GET: {
            description: "Query messages",
            queryParams: {
              current: "Get current active message (?current=true)",
              archived: "List all archived messages (?archived=true)",
              messageId: "Look up specific message (?messageId=msg_123)",
            },
          },
          POST: {
            description: "Rotate to a new message",
            requestBody: {
              content: {
                type: "string",
                required: true,
                description: "Message content",
              },
              closedAt: {
                type: "string",
                required: false,
                description:
                  "ISO 8601 timestamp to close previous message (defaults to now)",
              },
            },
            behavior:
              "Creates new message, archives previous message if one exists",
          },
        },
      });
    }

    // Get current active message
    if (current === "true") {
      const currentMessageData = await kv.get(KV_PREFIXES.CURRENT_MESSAGE);
      if (!currentMessageData) {
        return NextResponse.json(
          { error: "No active message" },
          { status: 404 }
        );
      }

      try {
        const message = JSON.parse(currentMessageData) as AttentionMessage;
        return NextResponse.json({ success: true, message });
      } catch (e) {
        console.error("Failed to parse current message:", e);
        return NextResponse.json(
          { error: "Current message data is corrupted" },
          { status: 500 }
        );
      }
    }

    // Look up specific archived message
    if (messageId) {
      const messageData = await kv.get(`${KV_PREFIXES.MESSAGE}${messageId}`);
      if (!messageData) {
        return NextResponse.json(
          { error: `Message not found: ${messageId}` },
          { status: 404 }
        );
      }

      try {
        const message = JSON.parse(messageData) as AttentionMessage;
        return NextResponse.json({ success: true, message });
      } catch (e) {
        console.error(`Failed to parse message ${messageId}:`, e);
        return NextResponse.json(
          { error: `Message ${messageId} is corrupted` },
          { status: 500 }
        );
      }
    }

    // List all archived messages
    if (archived === "true") {
      const messages = await kvListAll<AttentionMessage>(kv, KV_PREFIXES.MESSAGE);

      return NextResponse.json({
        success: true,
        count: messages.length,
        messages,
      });
    }

    return NextResponse.json(
      {
        error:
          "Missing query parameter. Use ?current=true, ?archived=true, or ?messageId=msg_123",
      },
      { status: 400 }
    );
  } catch (e) {
    console.error("Message admin GET error:", e);
    return NextResponse.json(
      { error: `Failed to query messages: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

/**
 * POST /api/paid-attention/admin/message
 *
 * Rotate to a new message. Archives the current message (if one exists)
 * and creates a new active message at attention:current.
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Malformed JSON body" },
        { status: 400 }
      );
    }

    const validation = validateMessageBody(body);
    if (validation.errors) {
      return NextResponse.json(
        { error: "Invalid request body", validationErrors: validation.errors },
        { status: 400 }
      );
    }

    const { content, closedAt } = validation.data;

    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // Generate new message ID
    const messageId = `msg_${Date.now()}`;
    const createdAt = new Date().toISOString();

    // Check for current message and archive it
    const currentMessageData = await kv.get(KV_PREFIXES.CURRENT_MESSAGE);
    if (currentMessageData) {
      try {
        const currentMessage = JSON.parse(
          currentMessageData
        ) as AttentionMessage;
        const archivedMessage: AttentionMessage = {
          ...currentMessage,
          closedAt: closedAt || new Date().toISOString(),
        };

        // Archive at attention:message:{messageId}
        await kv.put(
          `${KV_PREFIXES.MESSAGE}${currentMessage.messageId}`,
          JSON.stringify(archivedMessage)
        );
      } catch (e) {
        console.error("Failed to archive current message:", e);
        return NextResponse.json(
          { error: "Failed to archive current message" },
          { status: 500 }
        );
      }
    }

    // Create new message
    const newMessage: AttentionMessage = {
      messageId,
      content,
      createdAt,
      closedAt: null,
      responseCount: 0,
    };

    // Write new message to both current and archive locations
    await Promise.all([
      kv.put(KV_PREFIXES.CURRENT_MESSAGE, JSON.stringify(newMessage)),
      kv.put(`${KV_PREFIXES.MESSAGE}${messageId}`, JSON.stringify(newMessage)),
    ]);

    return NextResponse.json({
      success: true,
      message: "New message created successfully",
      newMessage,
    });
  } catch (e) {
    console.error("Message admin POST error:", e);
    return NextResponse.json(
      { error: `Failed to create message: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}
