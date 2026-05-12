// CACHE_INVARIANTS:POSTURE=auth-required
// Cron catch-up endpoint. Shared-secret authenticated; never cached.
// Triggered by an external scheduler (e.g. Cloudflare Cron Trigger via fetch).

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import { runCompetitionCron } from "@/lib/competition/cron";

export async function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/cron",
      methods: ["POST"],
      description:
        "15-min catch-up sweep for the trading-comp verifier. Walks registered_wallets and re-fetches recent Hiro tx history, filtering by allowlist and submitting each match via verifyAndPersistSwap with source='cron'. Pairs with POST /api/competition/trades (agent-submit fast path) — first writer wins on (txid).",
      auth: {
        scheme: "Shared secret",
        header: "X-Cron-Secret: {env.CRON_SECRET}",
      },
      response: {
        scanned: "number (addresses walked this run)",
        found: "number (allowlisted txs touching those addresses)",
        inserted: "number (new rows written to swaps)",
        alreadyKnown: "number (rows that existed from another ingestion path)",
        pending: "number (txs Hiro reported as still in flight)",
        rejected: "number (verifier rejected — sender/allowlist/parse failure)",
        cursor: "string | null (next stx_address to resume from)",
      },
      notes: [
        "Per-run cap: 100 addresses (CRON_MAX_ADDRESSES_PER_RUN). Sized for a 15-min cadence — the full membership cycles in roughly 5 runs at the current scale.",
        "The sweep resumes across runs via D1 (competition_state.cron_cursor).",
        "wrangler cron-trigger wiring is tracked as a follow-up; this route is callable today via HTTPS with the shared secret.",
      ],
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: NextRequest) {
  const { env, ctx } = await getCloudflareContext();
  const rayId = request.headers.get("cf-ray") || crypto.randomUUID();
  const logger = isLogsRPC(env.LOGS)
    ? createLogger(env.LOGS, ctx, { rayId, path: request.nextUrl.pathname })
    : createConsoleLogger({ rayId, path: request.nextUrl.pathname });

  const expectedSecret = env.CRON_SECRET;
  if (!expectedSecret) {
    logger.error("CRON_SECRET not configured");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const provided = request.headers.get("x-cron-secret");
  if (!provided || provided !== expectedSecret) {
    return NextResponse.json(
      { error: "Invalid or missing X-Cron-Secret" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.warn("D1 binding missing on competition/cron");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 60,
      },
      { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } }
    );
  }

  const summary = await runCompetitionCron(
    { DB: db, HIRO_API_KEY: env.HIRO_API_KEY },
    logger
  );

  return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
}
