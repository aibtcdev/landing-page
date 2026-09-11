/**
 * POST /api/legions/chainhook: inbound Chainhooks 2.0 webhook for the two El
 * Salvador legion contracts. The only writer of `legion_events`.
 *
 * Registered with scripts/legion-chainhook.sh: one `contract_log` filter per
 * legion, delivering here. Each delivery carries the prints that happened
 * (propose, vote, conclude, redeem-vault, claim-credit), which are decoded and
 * upserted. Phase transitions that happen only because blocks passed are
 * derived on read, not pushed here.
 *
 * Authenticated with the account-wide consumer secret (LEGION_CHAINHOOK_SECRET),
 * sent by Hiro as x-chainhook-consumer-secret and carried in ?t=.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  extractEvents,
  isAuthorisedDelivery,
  rollbackTxids,
  type ChainhookOccurrence,
  type EventRow,
} from "@/lib/legion/chainhook";
import { readProposalMeta } from "@/lib/legion/chain";
import { LEGION_CONTRACTS } from "@/lib/legion/constants";
import { recordLegionEvents, rollbackLegionEvents } from "@/lib/legion/d1";
import { purgeLegionsState } from "@/lib/legion/server-state";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/legions/chainhook",
    method: "POST",
    description:
      "Hiro Chainhooks 2.0 delivery target for the El Salvador legion contracts. Not for agents: read /api/legions instead.",
    auth: "Account consumer secret, as the x-chainhook-consumer-secret header or ?t=",
    contracts: LEGION_CONTRACTS,
  });
}

/**
 * `propose` prints the link and title but not the description, so read it once
 * per new proposal and store it with the event. Best-effort: a failed read
 * leaves the description empty rather than failing the delivery.
 */
async function withDescriptions(rows: EventRow[], apiKey?: string): Promise<EventRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      if (row.event !== "propose" || row.proposal_id == null || typeof row.data.description === "string") {
        return row;
      }
      const meta = await readProposalMeta(row.contract_id, row.proposal_id, apiKey);
      return meta ? { ...row, data: { ...row.data, description: meta.description } } : row;
    })
  );
}

export async function POST(request: NextRequest): Promise<Response> {
  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/legions/chainhook" })
    : createConsoleLogger({ rayId, path: "/api/legions/chainhook" });

  const secret = env.LEGION_CHAINHOOK_SECRET;
  if (!secret) {
    logger.error("legions.chainhook_secret_missing");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  // Authenticate before revealing any other config state.
  if (!isAuthorisedDelivery(request, secret)) {
    logger.warn("legions.chainhook_unauthorised", {
      headers: [...request.headers.keys()].join(","),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.error("legions.chainhook_no_db");
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  }

  let payload: ChainhookOccurrence;
  try {
    payload = (await request.json()) as ChainhookOccurrence;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const applied = await withDescriptions(
    extractEvents(payload.event?.apply ?? [], LEGION_CONTRACTS),
    env.HIRO_API_KEY
  );
  const rolled = rollbackTxids(payload.event?.rollback ?? []);

  try {
    const removed = rolled.length > 0 ? await rollbackLegionEvents(db, rolled) : 0;
    if (applied.length > 0) await recordLegionEvents(db, applied);

    if (applied.length > 0 || removed > 0) {
      await purgeLegionsState();
      logger.info("legions.chainhook_processed", {
        applied: applied.length,
        removed,
        events: applied.map((e) => `${e.event}#${e.proposal_id ?? "-"}`).join(","),
      });
    } else {
      // A silent no-op delivery is how a payload-shape mismatch hides: a
      // healthy 200 while nothing is ever indexed. Log it loudly.
      logger.warn("legions.chainhook_zero_events", {
        blocks: payload.event?.apply?.length ?? 0,
        uuid: payload.chainhook?.uuid ?? "unknown",
      });
    }
    return NextResponse.json({ ok: true, received: applied.length, removed });
  } catch (err) {
    // 500 so Hiro retries; the upsert is idempotent by (txid, event_index).
    logger.error("legions.chainhook_persist_failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to persist events" }, { status: 500 });
  }
}
