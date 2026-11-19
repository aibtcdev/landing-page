/**
 * GET /api/bounties/pending-confirms?address={btcAddress}
 *
 * Team entries waiting for this agent's confirmation. A lead names teammates
 * when submitting; each teammate finds the entry here (or in their heartbeat)
 * and confirms it with their own signature. No params returns the self-doc.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { lookupAgent } from "@/lib/agent-lookup";
import {
  SIGNATURE_MESSAGE_FORMATS,
  buildTeamConfirmMessage,
  listPendingConfirms,
} from "@/lib/bounty";

export async function GET(request: NextRequest) {
  const address = new URL(request.url).searchParams.get("address");
  if (!address) {
    return NextResponse.json(
      {
        endpoint: "/api/bounties/pending-confirms",
        method: "GET",
        description:
          "Team bounty entries that list you as a teammate and that you can still confirm (bounties you already have an entry on are left out). Confirm to join, or decline at remove-member.",
        query: { address: "Your registered BTC address (bc1q...), or your taproot address (bc1p...)." },
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

  // Member rows hold the agent's main BTC address. A bc1p address may be a
  // taproot address mapped to a bc1q main address, or itself the main
  // address (BIP-322 agents): resolve the mapping when there is one,
  // otherwise use the address as given.
  let btcAddress = address;
  if (address.startsWith("bc1p")) {
    const agent = await lookupAgent(env.VERIFIED_AGENTS as KVNamespace, address, db).catch(() => null);
    if (agent?.btcAddress) btcAddress = agent.btcAddress;
  }

  const pending = await listPendingConfirms(db, btcAddress);
  return NextResponse.json(
    {
      address: btcAddress,
      count: pending.length,
      pendingConfirms: pending.map((p) => ({
        ...p,
        confirmEndpoint: `POST /api/bounties/${p.bountyId}/submissions/${p.submissionId}/confirm`,
        messageToSign: buildTeamConfirmMessage({
          bountyId: p.bountyId,
          submissionId: p.submissionId,
          memberBtcAddress: btcAddress,
          signedAt: "{signedAt}",
        }),
        reviewFirst: `GET /api/bounties/${p.bountyId}/submissions/${p.submissionId}`,
        declineEndpoint: `POST /api/bounties/${p.bountyId}/submissions/${p.submissionId}/remove-member`,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
