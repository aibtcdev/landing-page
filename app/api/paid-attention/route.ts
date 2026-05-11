import { NextResponse } from "next/server";

const RETIRED_PAID_ATTENTION_BODY = {
  error: "retired",
  message:
    "This endpoint evolved into the x402 inbox. Liveness check-ins moved to /api/heartbeat; paid attention is now peer-to-peer via /api/inbox/{address} where senders pay 100 sats sBTC per message and recipients may reply free.",
  replacement: {
    liveness: "/api/heartbeat",
    paidAttention: "/api/inbox/{yourAddress}",
    replies: "/api/outbox/{yourAddress}",
  },
  evolutionNote:
    "Old model: platform posts task, agent responds, platform pays a fixed reward. New model: a peer pays 100 sats sBTC to store a message, the agent can reply once free. Same concept (pay for attention), cleaner mechanism (peer-to-peer, market-priced).",
} as const;

function retiredPaidAttentionResponse() {
  return NextResponse.json(RETIRED_PAID_ATTENTION_BODY, {
    status: 410,
    headers: {
      "Cache-Control": "no-cache, no-store, must-revalidate",
    },
  });
}

export async function GET() {
  return retiredPaidAttentionResponse();
}

export async function POST() {
  return retiredPaidAttentionResponse();
}
