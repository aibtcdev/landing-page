// CACHE_INVARIANTS:POSTURE=auth-required
// This route accepts chainhook predicate firings from Hiro's controller
// (or a self-hosted controller). HMAC-authenticated; no public cache.

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createLogger, createConsoleLogger, isLogsRPC } from "@/lib/logging";
import {
  parseChainhookPayload,
  extractChainhookSignature,
  verifyChainhookSignature,
} from "@/lib/competition/chainhook";
import { verifyAndPersistSwap } from "@/lib/competition/verify";

interface IngestSummary {
  scanned: number;
  inserted: number;
  alreadyKnown: number;
  rejected: number;
  pending: number;
}

export async function GET() {
  return NextResponse.json(
    {
      endpoint: "/api/competition/chainhook",
      method: "POST",
      description:
        "Receives Hiro chainhook predicate firings for the trading competition. HMAC-authenticated via CHAINHOOK_SECRET. Each tx in `apply` is handed to verifyAndPersistSwap with source='chainhook'. Rollback entries are ignored (the verifier persists only terminal-status rows; rolled-back txs simply never replay).",
      auth: {
        scheme: "HMAC-SHA256",
        header: "Authorization: Bearer {hex} (or X-Chainhook-Signature: {hex})",
        body: "HMAC-SHA256(env.CHAINHOOK_SECRET, request_body)",
      },
      response: {
        "200": { processed: "number", inserted: "number", rejected: "number" },
        "401": "Missing or invalid signature",
        "400": "Malformed JSON payload",
        "503": "D1 unavailable — retry",
      },
      notes: [
        "Predicate registration is OUT OF SCOPE of this route; configure the chainhook controller against the contracts in lib/competition/allowlist.ts.",
        "Source enum: this route always writes source='chainhook'. First-writer-wins on (txid).",
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

  const secret = env.CHAINHOOK_SECRET;
  if (!secret) {
    logger.error("CHAINHOOK_SECRET not configured");
    return NextResponse.json(
      { error: "Server configuration error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }

  const providedSig = extractChainhookSignature(request.headers);
  if (!providedSig) {
    return NextResponse.json(
      { error: "Missing chainhook signature (Authorization: Bearer … or X-Chainhook-Signature)" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Read raw body once — both signature verify and JSON parse need it.
  const rawBody = await request.text();

  const sigValid = await verifyChainhookSignature(rawBody, providedSig, secret);
  if (!sigValid) {
    logger.warn("Chainhook signature mismatch");
    return NextResponse.json(
      { error: "Invalid chainhook signature" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Body is not valid JSON" },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const parseRes = parseChainhookPayload(payload);
  if (!parseRes.ok) {
    return NextResponse.json(
      { error: parseRes.reason },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const db = env.DB as D1Database | undefined;
  if (!db) {
    logger.warn("D1 binding missing on competition/chainhook POST");
    return NextResponse.json(
      {
        error: "transient_d1_unavailable",
        message: "Competition database temporarily unavailable. Please retry shortly.",
        retry_after: 5,
      },
      { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } }
    );
  }

  const summary: IngestSummary = {
    scanned: parseRes.txids.length,
    inserted: 0,
    alreadyKnown: 0,
    rejected: 0,
    pending: 0,
  };

  // Process txids serially. Chainhook batches are small (predicate firings
  // per block) and serial processing keeps Hiro rate-limit exposure simple;
  // verifyAndPersistSwap already handles its own retries.
  for (const txid of parseRes.txids) {
    try {
      const result = await verifyAndPersistSwap(env, db, txid, "chainhook", logger);
      if (result.status === "verified") {
        if (result.inserted) summary.inserted++;
        else summary.alreadyKnown++;
      } else if (result.status === "pending") {
        summary.pending++;
      } else {
        summary.rejected++;
        logger.info("Chainhook txid rejected", {
          txid,
          code: result.code,
          reason: result.reason,
        });
      }
    } catch (err) {
      summary.rejected++;
      logger.warn("Chainhook verify threw", { txid, error: String(err) });
    }
  }

  return NextResponse.json(
    {
      processed: summary.scanned,
      inserted: summary.inserted,
      alreadyKnown: summary.alreadyKnown,
      rejected: summary.rejected,
      pending: summary.pending,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
