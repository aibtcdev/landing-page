import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { INBOX_PRICE_SATS } from "@/lib/inbox/constants";
import type { InboxAgentIndex } from "@/lib/inbox/types";

/**
 * GET /api/admin/reconcile-sats — Self-documenting endpoint.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  return NextResponse.json({
    endpoint: "/api/admin/reconcile-sats",
    description:
      "Recompute stats:totalSatsTransacted from inbox indices to correct counter drift.",
    method: "POST",
    headers: { "X-Admin-Key": "required" },
    parameters: {
      dryRun:
        "If true, report computed totals without writing (default: false)",
    },
  });
}

/**
 * POST /api/admin/reconcile-sats — Reconcile sats counter from canonical inbox data.
 *
 * This is intended as a repair/reconciliation path because KV increments are
 * best-effort (non-atomic read-modify-write).
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  const { env } = await getCloudflareContext();
  const kv = env.VERIFIED_AGENTS as KVNamespace;

  let dryRun = false;
  try {
    const body = (await request.json()) as { dryRun?: boolean };
    dryRun = body?.dryRun === true;
  } catch {
    // no body is fine
  }

  // Scan all inbox:agent:* indices and sum message counts
  let cursor: string | undefined;
  let listComplete = false;
  let agentIndicesScanned = 0;
  let totalMessages = 0;

  while (!listComplete) {
    const result = await kv.list({ prefix: "inbox:agent:", cursor });

    for (const key of result.keys) {
      const raw = await kv.get(key.name);
      if (!raw) continue;

      try {
        const idx = JSON.parse(raw) as InboxAgentIndex;
        totalMessages += idx.messageIds.length;
        agentIndicesScanned++;
      } catch {
        // Ignore malformed records
      }
    }

    listComplete = result.list_complete;
    cursor = !result.list_complete ? result.cursor : undefined;
  }

  const computedTotalSats = totalMessages * INBOX_PRICE_SATS;
  const currentRaw = await kv.get("stats:totalSatsTransacted");
  const currentTotalSats =
    typeof currentRaw === "string" && !Number.isNaN(Number.parseInt(currentRaw, 10))
      ? Number.parseInt(currentRaw, 10)
      : null;

  if (!dryRun) {
    await kv.put("stats:totalSatsTransacted", String(computedTotalSats));
  }

  return NextResponse.json({
    success: true,
    dryRun,
    stats: {
      agentIndicesScanned,
      totalMessages,
      satsPerMessage: INBOX_PRICE_SATS,
      currentTotalSats,
      computedTotalSats,
      deltaSats:
        typeof currentTotalSats === "number"
          ? computedTotalSats - currentTotalSats
          : null,
      wroteCounter: !dryRun,
    },
  });
}
