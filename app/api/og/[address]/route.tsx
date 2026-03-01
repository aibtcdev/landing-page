import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import { lookupAgent } from "@/lib/agent-lookup";

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

  try {
    const { env } = await getCloudflareContext();
    const kv = env.VERIFIED_AGENTS as KVNamespace;

    // lookupAgent handles all address formats (bc1, 1..., 3..., SP, bc1p taproot)
    const agent = await lookupAgent(kv, address);
    if (!agent) {
      return new Response("Agent not found", { status: 404 });
    }

    // Get claim status for level computation
    const claimData = await kv.get(`claim:${agent.btcAddress}`);
    let claim: ClaimStatus | null = null;
    if (claimData) {
      try {
        claim = JSON.parse(claimData) as ClaimStatus;
      } catch { /* ignore */ }
    }

    const level = computeLevel(agent, claim);
    const levelDef = LEVELS[level];
    const displayName = agent.displayName || generateName(agent.btcAddress);
    const color = levelColors[level] ?? levelColors[0];

    // Fetch background pattern and avatar in parallel
    const bgUrl = "https://aibtc.com/Artwork/AIBTC_Pattern1_optimized.jpg";
    const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;

    const [bgSrc, avatarSrc] = await Promise.all([
      fetchImageAsDataUri(bgUrl, 4000),
      fetchImageAsDataUri(avatarUrl, 3000),
    ]);

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
            background: "#0a0a0f",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Background pattern */}
          {bgSrc && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bgSrc}
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
                opacity: 0.7,
              }}
            />
          )}

          {/* Dark gradient overlay for text readability */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "1200px",
              height: "630px",
              background: "linear-gradient(135deg, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.3) 50%, rgba(0,0,0,0.55) 100%)",
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
                  width: "188px",
                  height: "188px",
                  borderRadius: "50%",
                  border: `3px solid ${color}`,
                  display: "flex",
                }}
              />
              {level >= 2 && (
                <div
                  style={{
                    position: "absolute",
                    top: "-26px",
                    left: "-26px",
                    width: "212px",
                    height: "212px",
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
                  width="160"
                  height="160"
                  style={{
                    borderRadius: "50%",
                    border: `4px solid ${color}50`,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "160px",
                    height: "160px",
                    borderRadius: "50%",
                    border: `4px solid ${color}50`,
                    background: `linear-gradient(135deg, ${color}40 0%, ${color}20 100%)`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "64px",
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
}
