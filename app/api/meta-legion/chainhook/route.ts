/**
 * POST /api/meta-legion/chainhook: inbound Chainhooks 2.0 webhook for the
 * Legion Exchange. The only writer of its rows in `legion_events`.
 *
 * Registered with `HOOK=exchange scripts/legion-chainhook.sh`: one
 * `contract_log` filter on the exchange, delivering here. Every public function
 * on the exchange prints, so the deliveries are the whole record: legions,
 * complete sets, orders, fills, qualifications, resolutions and redemptions.
 * They are decoded and upserted, and folded on read (lib/meta-legion/state.ts).
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
} from "@/lib/legion/chainhook";
import { recordLegionEvents, rollbackLegionEvents } from "@/lib/legion/d1";
import { EXCHANGE_CONTRACT } from "@/lib/meta-legion/constants";

export const dynamic = "force-dynamic";

const CONTRACTS = [EXCHANGE_CONTRACT];

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/meta-legion/chainhook",
    method: "POST",
    description:
      "Hiro Chainhooks 2.0 delivery target for the Legion Exchange. Not for agents: read /api/meta-legion instead.",
    auth: "Account consumer secret, as the x-chainhook-consumer-secret header or ?t=",
    contracts: CONTRACTS,
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: "/api/meta-legion/chainhook" })
    : createConsoleLogger({ rayId, path: "/api/meta-legion/chainhook" });

  const secret = env.LEGION_CHAINHOOK_SECRET;
  if (!secret) {
    logger.error("meta_legion.chainhook_secret_missing");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  // Authenticate before revealing any other config state.
  if (!isAuthorisedDelivery(request, secret)) {
    logger.warn("meta_legion.chainhook_unauthorised", {
      headers: [...request.headers.keys()].join(","),
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.error("meta_legion.chainhook_no_db");
    return NextResponse.json({ error: "Storage not configured" }, { status: 503 });
  }

  let payload: ChainhookOccurrence;
  try {
    payload = (await request.json()) as ChainhookOccurrence;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const applied = extractEvents(payload.event?.apply ?? [], CONTRACTS);
  const rolled = rollbackTxids(payload.event?.rollback ?? []);

  try {
    const removed = rolled.length > 0 ? await rollbackLegionEvents(db, rolled) : 0;
    if (applied.length > 0) await recordLegionEvents(db, applied);

    if (applied.length > 0 || removed > 0) {
      logger.info("meta_legion.chainhook_processed", {
        applied: applied.length,
        removed,
        events: applied.map((e) => e.event).join(","),
      });
    } else {
      // A silent no-op delivery is how a payload-shape mismatch hides: a
      // healthy 200 while nothing is ever indexed. Log it loudly.
      logger.warn("meta_legion.chainhook_zero_events", {
        blocks: payload.event?.apply?.length ?? 0,
        uuid: payload.chainhook?.uuid ?? "unknown",
      });
    }
    return NextResponse.json({ ok: true, received: applied.length, removed });
  } catch (err) {
    // 500 so Hiro retries; the upsert is idempotent by (txid, event_index).
    logger.error("meta_legion.chainhook_persist_failed", { error: String(err) });
    return NextResponse.json({ error: "Failed to persist events" }, { status: 500 });
  }
}
