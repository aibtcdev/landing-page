/**
 * GET  /api/admin/competition/finalize — self-doc + list rounds.
 * POST /api/admin/competition/finalize — drive round status machine.
 *
 * All requests require the X-Admin-Key header (validated via requireAdmin).
 *
 * POST body: { roundId: string; action: "close"|"snapshot"|"finalize"; tokenIds?: string[]; decimalsMap?: Record<string,number> }
 * POST query: ?dry-run=true — runs compute pipeline but writes nothing.
 *
 * Status machine:
 *   open        → closed      : action "close",    requires now >= grace_ends_at
 *   closed      → finalizing  : action "snapshot", captures Tenero KV prices
 *   finalizing  → finalized   : action "finalize", persists results + rewards
 *
 * Dry-run semantics per action:
 *   "close"    → returns wouldUpdate without writing.
 *   "snapshot" → returns what would be captured (priced/unpriced) without writing.
 *   "finalize" → returns computed results + reward rows without writing to D1.
 *
 * Quest: 2026-05-20-competition-snapshot-finalize, Phase 3.
 */

import { NextRequest, NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/admin/auth";
import { computeRoundResults } from "@/lib/competition/finalize/compute";
import { persistRoundResults } from "@/lib/competition/finalize/persist";
import { captureRoundPriceSnapshot } from "@/lib/competition/finalize/snapshot";
import { getCachedTokenPrices } from "@/lib/external/tenero/kv-cache";

// ── D1 row types (mirroring competition_rounds columns) ───────────────────────

interface D1RoundRow {
  round_id: string;
  starts_at: number;
  ends_at: number;
  grace_ends_at: number;
  status: string;
  min_volume_usd: number;
  min_priced_trade_count: number;
  created_at: string;
  finalized_at: string | null;
}

// ── Known error prefixes mapped to HTTP status codes ──────────────────────────

const ERROR_STATUS_MAP: Array<[string, number]> = [
  ["round_not_found:", 404],
  ["already_finalized:", 409],
  ["already_snapshotted:", 409],
  ["unexpected_status:", 409],
  ["wrong_status:", 409],
  ["grace_period_active:", 409],
  ["concurrent_modification:", 409],
  // #880: Tenero refresh disabled → KV cache empty. Treat as 503 so the
  // operator gets a clear "dependency not ready" signal instead of 500.
  ["empty_price_cache:", 503],
];

function mapErrorToStatus(message: string): number {
  for (const [prefix, status] of ERROR_STATUS_MAP) {
    if (message.startsWith(prefix)) return status;
  }
  return 500;
}

// ── GET ───────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/competition/finalize
 *
 * Returns self-documentation and a list of all competition rounds with their
 * current status, ordered newest-first.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  try {
    const { env } = await getCloudflareContext();
    const db = env.DB as D1Database;

    const roundsResult = await db
      .prepare("SELECT * FROM competition_rounds ORDER BY starts_at DESC")
      .all<D1RoundRow>();

    const rounds = roundsResult.results ?? [];

    return NextResponse.json({
      endpoint: "/api/admin/competition/finalize",
      description:
        "Admin-gated competition round status machine. Drives open→closed→finalizing→finalized transitions.",
      methods: ["GET", "POST"],
      actions: {
        close:
          "Transition round from open → closed. Requires now >= grace_ends_at.",
        snapshot:
          "Capture Tenero KV prices into D1 snapshot; transitions closed → finalizing. Requires tokenIds + decimalsMap.",
        finalize:
          "Compute results + rewards and write to D1; transitions finalizing → finalized.",
      },
      dryRun:
        "Add ?dry-run=true to run the compute pipeline without writing anything.",
      rounds,
    });
  } catch (e) {
    console.error("competition/finalize GET error:", e);
    return NextResponse.json(
      { error: `Failed to list rounds: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}

// ── POST ──────────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/competition/finalize
 *
 * Body: { roundId, action, tokenIds?, decimalsMap? }
 * Query: ?dry-run=true
 */
export async function POST(request: NextRequest) {
  const denied = await requireAdmin(request);
  if (denied) return denied;

  // Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Malformed JSON body" },
      { status: 400 }
    );
  }

  // Validate shape
  if (typeof body !== "object" || body === null) {
    return NextResponse.json(
      { error: "Body must be a JSON object" },
      { status: 400 }
    );
  }

  const raw = body as Record<string, unknown>;
  const roundId = raw.roundId;
  const action = raw.action;

  if (typeof roundId !== "string" || roundId.trim() === "") {
    return NextResponse.json(
      { error: "roundId must be a non-empty string" },
      { status: 400 }
    );
  }

  if (action !== "close" && action !== "snapshot" && action !== "finalize") {
    return NextResponse.json(
      {
        error:
          'action must be one of "close", "snapshot", or "finalize"',
      },
      { status: 400 }
    );
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get("dry-run") === "true";

  try {
    const { env } = await getCloudflareContext();
    const db = env.DB as D1Database;
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // ── Fetch the round ────────────────────────────────────────────────────────
    const roundRow = await db
      .prepare("SELECT * FROM competition_rounds WHERE round_id = ?1")
      .bind(roundId)
      .first<D1RoundRow>();

    if (!roundRow) {
      return NextResponse.json(
        { error: `round_not_found: ${roundId}` },
        { status: 404 }
      );
    }

    // ── action: close ──────────────────────────────────────────────────────────
    if (action === "close") {
      if (roundRow.status !== "open") {
        return NextResponse.json(
          {
            error: "wrong_status: expected open",
            current: roundRow.status,
            roundId,
          },
          { status: 409 }
        );
      }

      const nowSecs = Math.floor(Date.now() / 1000);
      if (nowSecs < roundRow.grace_ends_at) {
        return NextResponse.json(
          {
            error: "grace_period_active",
            grace_ends_at: roundRow.grace_ends_at,
            now: nowSecs,
            remainingSecs: roundRow.grace_ends_at - nowSecs,
          },
          { status: 409 }
        );
      }

      if (dryRun) {
        return NextResponse.json({
          dryRun: true,
          roundId,
          action: "close",
          wouldUpdate: { status: "closed" },
        });
      }

      const updateResult = await db
        .prepare(
          "UPDATE competition_rounds SET status = 'closed' WHERE round_id = ?1 AND status = 'open'"
        )
        .bind(roundId)
        .run();

      if (updateResult.meta.changes === 0) {
        return NextResponse.json(
          { error: "concurrent_modification: round status changed before write" },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        roundId,
        action: "close",
        round: { ...roundRow, status: "closed" },
      });
    }

    // ── action: snapshot ───────────────────────────────────────────────────────
    if (action === "snapshot") {
      const tokenIds = raw.tokenIds;
      const decimalsMapRaw = raw.decimalsMap;

      if (
        !Array.isArray(tokenIds) ||
        tokenIds.length === 0 ||
        !tokenIds.every((t) => typeof t === "string")
      ) {
        return NextResponse.json(
          { error: "tokenIds must be a non-empty array of strings" },
          { status: 400 }
        );
      }

      if (
        typeof decimalsMapRaw !== "object" ||
        decimalsMapRaw === null ||
        Array.isArray(decimalsMapRaw)
      ) {
        return NextResponse.json(
          { error: "decimalsMap must be a plain object mapping tokenId → decimals" },
          { status: 400 }
        );
      }

      if (roundRow.status !== "closed") {
        return NextResponse.json(
          {
            error: "wrong_status: expected closed",
            current: roundRow.status,
            roundId,
          },
          { status: 409 }
        );
      }

      // Validate decimalsMap entries up front so a typo like
      // {"decimalsMap": {"token": "abc"}} fails at the boundary with a 400
      // instead of getting silently coerced to NaN and reaching snapshot
      // writes / dry-run misclassification.
      const decimalsMap = new Map<string, number>();
      const invalidDecimals: string[] = [];
      for (const [k, v] of Object.entries(
        decimalsMapRaw as Record<string, unknown>
      )) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isInteger(n) && n >= 0) {
          decimalsMap.set(k, n);
        } else {
          invalidDecimals.push(k);
        }
      }
      if (invalidDecimals.length > 0) {
        return NextResponse.json(
          {
            error:
              "decimalsMap entries must be non-negative integers (e.g. 6 or 8)",
            invalidTokens: invalidDecimals,
          },
          { status: 400 }
        );
      }
      // Every requested tokenId must have a decimals entry — otherwise the
      // snapshot would silently classify it as unpriced for a recoverable
      // reason (no decimals provided) vs an actual missing price.
      const missingDecimals = (tokenIds as string[]).filter(
        (t) => !decimalsMap.has(t)
      );
      if (missingDecimals.length > 0) {
        return NextResponse.json(
          {
            error: "decimalsMap is missing entries for some tokenIds",
            missingTokens: missingDecimals,
          },
          { status: 400 }
        );
      }

      if (dryRun) {
        // Fetch KV prices without writing anything
        const priceCache = await getCachedTokenPrices(kv, tokenIds as string[]);
        const priced: string[] = [];
        const unpriced: string[] = [];
        for (const tokenId of tokenIds as string[]) {
          const cached = priceCache.get(tokenId);
          const decimals = decimalsMap.get(tokenId);
          if (
            cached &&
            cached.priceUsd !== null &&
            typeof cached.priceUsd === "number" &&
            Number.isFinite(cached.priceUsd) &&
            typeof decimals === "number" &&
            Number.isInteger(decimals) &&
            decimals >= 0
          ) {
            priced.push(tokenId);
          } else {
            unpriced.push(tokenId);
          }
        }
        // Mirror the captureRoundPriceSnapshot pre-flight gate so dry-run
        // surfaces the #880 dependency before the real call would 503.
        if (priced.length === 0) {
          return NextResponse.json(
            {
              error:
                "empty_price_cache: zero priced tokens; check Tenero refresh scheduler (see issue #880)",
              dryRun: true,
              roundId,
              action: "snapshot",
              unpriced,
            },
            { status: 503 }
          );
        }
        return NextResponse.json({
          dryRun: true,
          roundId,
          action: "snapshot",
          wouldCapture: { priced: priced.length, unpriced, pricedTokenIds: priced },
        });
      }

      const result = await captureRoundPriceSnapshot(db, {
        roundId,
        kv,
        tokenIds: tokenIds as string[],
        decimalsMap,
      });

      return NextResponse.json({
        success: true,
        roundId,
        action: "snapshot",
        result,
      });
    }

    // ── action: finalize ───────────────────────────────────────────────────────
    if (action === "finalize") {
      if (roundRow.status !== "finalizing") {
        return NextResponse.json(
          {
            error: "wrong_status: expected finalizing",
            current: roundRow.status,
            roundId,
          },
          { status: 409 }
        );
      }

      const { results, rewards } = await computeRoundResults(db, { roundId });

      if (dryRun) {
        return NextResponse.json({
          dryRun: true,
          roundId,
          action: "finalize",
          computed: {
            resultCount: results.length,
            rewardCount: rewards.length,
            results,
            rewards,
          },
        });
      }

      await persistRoundResults(db, roundId, results, rewards);

      return NextResponse.json({
        success: true,
        roundId,
        action: "finalize",
        resultCount: results.length,
        rewardCount: rewards.length,
      });
    }

    // TypeScript exhaustiveness — should never reach here
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    const httpStatus = mapErrorToStatus(message);

    if (httpStatus === 500) {
      console.error("competition/finalize POST error:", e);
    }

    return NextResponse.json(
      { error: message },
      { status: httpStatus }
    );
  }
}
