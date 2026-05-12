import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import {
  classifyAddress,
  lookupProfileByBtcAddress,
  lookupProfileByStxAddress,
  mapRowToAgentRecord,
  mapRowToClaimRecord,
  claimRecordToStatus,
} from "@/lib/cache/agent-profile";
import { buildEdgeCacheKey, withEdgeCache } from "@/lib/edge-cache";
import { BG_PATTERN_DATA_URI } from "../bg-pattern";

/** TTL for OG image cache entries: 24 hours. */
const OG_CACHE_TTL_SECONDS = 86400;

const levelColors: Record<number, string> = {
  0: "rgba(255,255,255,0.3)",
  1: "#F7931A",
  2: "#7DA2FF",
};

/**
 * Fetch an image and return it as a base64 data URI.
 * Returns null on failure (timeout, network error, non-OK status).
 */
async function fetchImageAsDataUri(
  url: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "image/jpeg";
    const base64 = Buffer.from(new Uint8Array(buf)).toString("base64");
    return `data:${ct};base64,${base64}`;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ address: string }> }
) {
  const { address } = await params;

  // Early-exit for address shapes that are out of scope (numeric IDs, BNS
  // names) — no point hitting the cache for a known-404 path.
  const earlyBranch = classifyAddress(address);
  if (earlyBranch !== "btc" && earlyBranch !== "stx" && earlyBranch !== "taproot") {
    return new Response("Agent not found", { status: 404 });
  }

  const cacheKeyUrl = buildEdgeCacheKey("/api/og", address);
  return withEdgeCache(cacheKeyUrl, OG_CACHE_TTL_SECONDS, async () => {
  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;
    const db = env.DB as D1Database;

    // Phase 2.4: D1-first lookup — single SELECT + LEFT JOIN claims.
    // Taproot (bc1p*), BTC (bc1q*, 1*, 3*), and STX (SP*, ST*, SM*) addresses
    // are all handled from the first commit (no early-return on non-btc/non-stx).
    // For validation-excluded agents (~708 records, #691) not yet in D1,
    // fall back to KV btc:/stx: key to preserve 200 image responses.
    //
    // Note: address shape is already validated by the early-exit above
    // (classifyAddress is deterministic — no need to re-check here).
    const branch = earlyBranch;

    let agent: AgentRecord | null = null;
    let claim: ClaimStatus | null = null;
    let kvFallbackKey: string | null = null;

    if (branch === "btc") {
      const row = await lookupProfileByBtcAddress(db, address);
      if (row) {
        agent = mapRowToAgentRecord(row);
        const claimRecord = mapRowToClaimRecord(row);
        if (claimRecord) claim = claimRecordToStatus(claimRecord);
      } else {
        kvFallbackKey = `btc:${address}`;
      }
    } else if (branch === "taproot") {
      // Taproot bc1p* — reverse-lookup canonical btc via KV `taproot:{addr}`
      // (the taproot KV index is not being migrated in Phase 2.4 per RFC), then D1.
      const canonicalBtc = await kv.get(`taproot:${address}`);
      if (canonicalBtc) {
        const row = await lookupProfileByBtcAddress(db, canonicalBtc);
        if (row) {
          agent = mapRowToAgentRecord(row);
          const claimRecord = mapRowToClaimRecord(row);
          if (claimRecord) claim = claimRecordToStatus(claimRecord);
        } else {
          kvFallbackKey = `btc:${canonicalBtc}`;
        }
      }
    } else {
      // branch === "stx"
      const row = await lookupProfileByStxAddress(db, address);
      if (row) {
        agent = mapRowToAgentRecord(row);
        const claimRecord = mapRowToClaimRecord(row);
        if (claimRecord) claim = claimRecordToStatus(claimRecord);
      } else {
        kvFallbackKey = `stx:${address}`;
      }
    }

    // KV fallback for validation-excluded agents (transitional per #691).
    // These agents exist in KV but have not been backfilled to D1 yet.
    // Mirrors pre-flip behavior: one KV read for agent, one for claim.
    if (!agent && kvFallbackKey) {
      const kvValue = await kv.get(kvFallbackKey);
      if (kvValue) {
        try {
          agent = JSON.parse(kvValue) as AgentRecord;
          // Also attempt claim KV read on fallback path (mirrors pre-flip behavior).
          const claimData = await kv.get(`claim:${agent.btcAddress}`);
          if (claimData) {
            try {
              claim = JSON.parse(claimData) as ClaimStatus;
            } catch {
              /* malformed claim — leave null */
            }
          }
        } catch {
          // Malformed KV record — leave agent null, fall through to 404
        }
      }
    }

    if (!agent) {
      return new Response("Agent not found", { status: 404 });
    }

    const level = computeLevel(agent, claim);
    const levelDef = LEVELS[level];
    const displayName = agent.displayName || generateName(agent.btcAddress);
    const color = levelColors[level] ?? levelColors[0];

    // Fetch avatar as base64
    const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
    const avatarSrc = await fetchImageAsDataUri(avatarUrl, 3000);

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200",
            height: "630",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            fontFamily: "system-ui, sans-serif",
            background: "#000000",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Background pattern — inline base64 to avoid fetch issues on CF Workers */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BG_PATTERN_DATA_URI}
            alt=""
            width="1200"
            height="630"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1200px",
              height: "630px",
              objectFit: "cover",
              opacity: 1,
            }}
          />

          {/* Dark overlay for text readability */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1200px",
              height: "630px",
              background: "rgba(0,0,0,0.7)",
              display: "flex",
            }}
          />

          {/* Content: left-aligned layout */}
          <div
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: "48px",
              padding: "0 80px",
              position: "relative",
              width: "100%",
            }}
          >
            {/* Avatar */}
            <div
              style={{
                display: "flex",
                position: "relative",
                flexShrink: 0,
              }}
            >
              {/* Orbital ring */}
              <div
                style={{
                  position: "absolute",
                  top: "-14px",
                  left: "-14px",
                  width: "268px",
                  height: "268px",
                  borderRadius: "50%",
                  border: `3px solid ${color}`,
                  display: "flex",
                }}
              />
              {level >= 2 && (
                <div
                  style={{
                    position: "absolute",
                    top: "-28px",
                    left: "-28px",
                    width: "296px",
                    height: "296px",
                    borderRadius: "50%",
                    border: `2px solid ${levelColors[2]}60`,
                    display: "flex",
                  }}
                />
              )}

              {avatarSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarSrc}
                  alt=""
                  width="240"
                  height="240"
                  style={{
                    borderRadius: "50%",
                    border: `4px solid ${color}50`,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "240px",
                    height: "240px",
                    borderRadius: "50%",
                    border: `4px solid ${color}50`,
                    background: `linear-gradient(135deg, ${color}40 0%, ${color}20 100%)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "96px",
                    fontWeight: "700",
                    color: color,
                  }}
                >
                  {displayName.charAt(0)}
                </div>
              )}
            </div>

            {/* Agent info */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {/* Agent name */}
              <div
                style={{
                  fontSize: "56px",
                  fontWeight: "700",
                  color: "#ffffff",
                  display: "flex",
                  lineHeight: 1.1,
                }}
              >
                {displayName}
              </div>

              {/* Level badge */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                }}
              >
                <div
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    backgroundColor: color,
                    display: "flex",
                  }}
                />
                <span
                  style={{
                    fontSize: "28px",
                    fontWeight: "500",
                    color: color,
                    display: "flex",
                  }}
                >
                  {level === 0 ? "Unverified" : `Level ${level}: ${levelDef.name}`}
                </span>
              </div>

              {/* aibtc.com */}
              <div
                style={{
                  fontSize: "20px",
                  color: "rgba(255,255,255,0.4)",
                  display: "flex",
                  marginTop: "4px",
                }}
              >
                aibtc.com
              </div>
            </div>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch {
    return new Response("Failed to generate image", { status: 500 });
  }
  }); // end withEdgeCache
}
