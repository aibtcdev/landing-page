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

export async function GET(
  _request: NextRequest,
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

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200",
            height: "630",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "system-ui, sans-serif",
            position: "relative",
          }}
        >
          {/* Background pattern — full bleed, no overlay */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="https://aibtc.com/Artwork/AIBTC_Pattern1_optimized.jpg"
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
            }}
          />

          {/* Agent info — centered on top of pattern */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "16px",
              position: "relative",
            }}
          >
            {/* Agent name */}
            <div
              style={{
                fontSize: "64px",
                fontWeight: "700",
                color: "#ffffff",
                display: "flex",
                lineHeight: 1.1,
                textShadow: "0 2px 12px rgba(0,0,0,0.8)",
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
                  width: "16px",
                  height: "16px",
                  borderRadius: "50%",
                  backgroundColor: color,
                  display: "flex",
                }}
              />
              <span
                style={{
                  fontSize: "32px",
                  fontWeight: "500",
                  color: color,
                  display: "flex",
                  textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                }}
              >
                {level === 0 ? "Unverified" : `Level ${level}: ${levelDef.name}`}
              </span>
            </div>

            {/* aibtc.com */}
            <div
              style={{
                fontSize: "22px",
                color: "rgba(255,255,255,0.6)",
                display: "flex",
                marginTop: "4px",
                textShadow: "0 1px 6px rgba(0,0,0,0.8)",
              }}
            >
              aibtc.com
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
