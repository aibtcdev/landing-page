import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  getMessage,
  getReply,
  updateMessage,
  getAgentInbox,
  validateMarkRead,
  buildMarkReadMessage,
  decrementUnreadCount,
} from "@/lib/inbox";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string; messageId: string }> }
) {
  const { address, messageId } = await params;
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Resolve address (BTC or STX) to agent record
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        hint: "Check the agent directory at https://aibtc.com/agents",
      },
      { status: 404 }
    );
  }

  // Fetch message and reply in parallel
  const [message, reply] = await Promise.all([
    getMessage(kv, messageId),
    getReply(kv, messageId),
  ]);

  if (!message) {
    return NextResponse.json(
      {
        error: "Message not found",
        messageId,
        hint: "Check GET /api/inbox/[address] to see available messages",
      },
      { status: 404 }
    );
  }

  // Verify message belongs to this agent (compare resolved BTC address)
  if (message.toBtcAddress !== agent.btcAddress) {
    return NextResponse.json(
      {
        error: "Message does not belong to this address",
        messageId,
        expectedAddress: message.toBtcAddress,
        providedAddress: address,
      },
      { status: 400 }
    );
  }

  // Return message with reply if exists
  return NextResponse.json({
    message,
    reply: reply || null,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ address: string; messageId: string }> }
) {
  const { address, messageId } = await params;
  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  // Resolve address (BTC or STX) to agent record
  const agent = await lookupAgent(kv, address);

  if (!agent) {
    return NextResponse.json(
      {
        error: "Agent not found",
        address,
        hint: "Check the agent directory at https://aibtc.com/agents",
      },
      { status: 404 }
    );
  }

  // Parse request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON body" },
      { status: 400 }
    );
  }

  // Validate mark-read request
  const validation = validateMarkRead(body);
  if (validation.errors) {
    return NextResponse.json(
      { error: validation.errors.join(", ") },
      { status: 400 }
    );
  }

  const { signature } = validation.data;

  // Verify messageId matches route param
  if (validation.data.messageId !== messageId) {
    return NextResponse.json(
      {
        error: "Message ID mismatch",
        expected: messageId,
        provided: validation.data.messageId,
      },
      { status: 400 }
    );
  }

  // Fetch message
  const message = await getMessage(kv, messageId);

  if (!message) {
    return NextResponse.json(
      {
        error: "Message not found",
        messageId,
      },
      { status: 404 }
    );
  }

  // Verify message belongs to this agent (compare resolved BTC address)
  if (message.toBtcAddress !== agent.btcAddress) {
    return NextResponse.json(
      {
        error: "Message does not belong to this address",
        messageId,
      },
      { status: 403 }
    );
  }

  // Build expected message format
  const messageToVerify = buildMarkReadMessage(messageId);

  // Verify BIP-137 signature
  let btcResult;
  try {
    btcResult = verifyBitcoinSignature(signature, messageToVerify);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Invalid Bitcoin signature: ${(e as Error).message}`,
        expectedMessage: messageToVerify,
      },
      { status: 400 }
    );
  }

  if (!btcResult.valid) {
    return NextResponse.json(
      {
        error: "Bitcoin signature verification failed",
        expectedMessage: messageToVerify,
      },
      { status: 400 }
    );
  }

  // Verify signer is recipient
  if (btcResult.address !== message.toBtcAddress) {
    return NextResponse.json(
      {
        error: "Signature verification failed: signer is not the recipient",
        expectedSigner: message.toBtcAddress,
        actualSigner: btcResult.address,
      },
      { status: 403 }
    );
  }

  // Check if already marked as read
  if (message.readAt) {
    return NextResponse.json(
      {
        error: "Message already marked as read",
        readAt: message.readAt,
      },
      { status: 409 }
    );
  }

  // Update message with readAt timestamp
  const now = new Date().toISOString();
  const updatedMessage = await updateMessage(kv, messageId, { readAt: now });

  if (!updatedMessage) {
    return NextResponse.json(
      { error: "Failed to update message" },
      { status: 500 }
    );
  }

  // Decrement unreadCount on the agent inbox index (clamped to 0)
  await decrementUnreadCount(kv, message.toBtcAddress);

  return NextResponse.json({
    success: true,
    message: "Message marked as read",
    messageId,
    readAt: now,
  });
}
