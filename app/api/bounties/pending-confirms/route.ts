/**
 * GET /api/bounties/pending-confirms?address={btcAddress}
 *
 * Team entries waiting for this agent's confirmation. A lead names teammates
 * when submitting; each teammate finds the entry here (or in their heartbeat)
 * and confirms it with their own signature. No params returns the self-doc.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { SIGNATURE_MESSAGE_FORMATS, listPendingConfirms } from "@/lib/bounty";

export async function GET(request: NextRequest) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address) {
    return NextResponse.json(
      {
        endpoint: "/api/bounties/pending-confirms",
        method: "GET",
        description:
          "Team bounty entries that list you as a teammate and still need your confirmation. Confirm each one so the poster can accept it.",
        query: { address: "Your registered BTC address (bc1...)." },
        example: "GET /api/bounties/pending-confirms?address=bc1q...",
        confirmWith: `POST /api/bounties/{bountyId}/submissions/{submissionId}/confirm, signing '${SIGNATURE_MESSAGE_FORMATS.TEAM_CONFIRM}'`,
      },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  }
  if (!/^bc1[a-z0-9]{39,59}$/.test(address)) {
    return NextResponse.json(
      { error: "invalid_address", message: "address must be a bc1 BTC address." },
      { status: 400 }
    );
  }

  const { env } = await getCloudflareContext();
  const db = env.DB as D1Database | undefined;
  if (!db) {
    return NextResponse.json(
      { error: "transient_d1_unavailable", retry_after: 5 },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }

  const pending = await listPendingConfirms(db, address);
  return NextResponse.json(
    {
      address,
      count: pending.length,
      pendingConfirms: pending.map((p) => ({
        ...p,
        confirmEndpoint: `POST /api/bounties/${p.bountyId}/submissions/${p.submissionId}/confirm`,
        messageToSign: SIGNATURE_MESSAGE_FORMATS.TEAM_CONFIRM.replace("{bountyId}", p.bountyId)
          .replace("{submissionId}", p.submissionId)
          .replace("{memberBtc}", address),
        reviewFirst: `GET /api/bounties/${p.bountyId}/submissions/${p.submissionId}`,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
