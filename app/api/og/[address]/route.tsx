import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";

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

    // Determine address type and look up agent
    const prefix = address.startsWith("SP") ? "stx" : address.startsWith("bc1") ? "btc" : null;
    if (!prefix) {
      return new Response("Invalid address", { status: 400 });
    }

    // Fetch agent and claim in parallel (claim needs btcAddress, but we can
    // speculatively fetch if address is already btc; otherwise sequential)
    const agentData = await kv.get(`${prefix}:${address}`);
    if (!agentData) {
      return new Response("Agent not found", { status: 404 });
    }

    const agent = JSON.parse(agentData) as AgentRecord;

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
    const displayName = generateName(agent.btcAddress);
    const color = levelColors[level];

    // Pre-fetch avatar with timeout to avoid cold-start delays that cause
    // Twitter's card crawler to time out and cache a no-image card
    const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
    let avatarSrc: string | null = null;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const avatarRes = await fetch(avatarUrl, { signal: controller.signal });
      clearTimeout(timeout);
      if (avatarRes.ok) {
        const buf = await avatarRes.arrayBuffer();
        const ct = avatarRes.headers.get("content-type") || "image/svg+xml";
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        avatarSrc = `data:${ct};base64,${btoa(binary)}`;
      }
    } catch {
      // Avatar fetch timed out or failed — render without it
    }

    return new ImageResponse(
      (
        <div
          style={{
            width: "1200",
            height: "630",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #0d0d12 0%, #1a1a24 50%, #0d0d12 100%)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {/* Level glow */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              width: "400px",
              height: "400px",
              borderRadius: "50%",
              background: `radial-gradient(circle, ${color}30 0%, transparent 70%)`,
            }}
          />

          {/* Avatar with orbital ring */}
          <div
            style={{
              display: "flex",
              position: "relative",
              marginBottom: "24px",
            }}
          >
            {/* Orbital ring */}
            <div
              style={{
                position: "absolute",
                top: "-12px",
                left: "-12px",
                width: "144px",
                height: "144px",
                borderRadius: "50%",
                border: `3px solid ${color}`,
                display: "flex",
              }}
            />
            {level >= 2 && (
              <div
                style={{
                  position: "absolute",
                  top: "-24px",
                  left: "-24px",
                  width: "168px",
                  height: "168px",
                  borderRadius: "50%",
                  border: `2px solid ${levelColors[2]}80`,
                  display: "flex",
                }}
              />
            )}

            {avatarSrc ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={avatarSrc}
                alt=""
                width="120"
                height="120"
                style={{
                  borderRadius: "50%",
                  border: `3px solid ${color}40`,
                }}
              />
            ) : (
              <div
                style={{
                  width: "120px",
                  height: "120px",
                  borderRadius: "50%",
                  border: `3px solid ${color}40`,
                  background: `linear-gradient(135deg, ${color}40 0%, ${color}20 100%)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "48px",
                  fontWeight: "700",
                  color: color,
                }}
              >
                {displayName.charAt(0)}
              </div>
            )}
          </div>

          {/* Agent name */}
          <div
            style={{
              fontSize: "48px",
              fontWeight: "600",
              color: "#ffffff",
              marginBottom: "8px",
              display: "flex",
            }}
          >
            {displayName}
          </div>

          {/* Level badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "24px",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "50%",
                backgroundColor: color,
                display: "flex",
              }}
            />
            <span
              style={{
                fontSize: "24px",
                fontWeight: "500",
                color: color,
                display: "flex",
              }}
            >
              {level === 0 ? "Unverified" : `Level ${level}: ${levelDef.name}`}
            </span>
          </div>

          {/* AIBTC branding */}
          <div
            style={{
              fontSize: "18px",
              color: "rgba(255,255,255,0.35)",
              display: "flex",
            }}
          >
            aibtc.com
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
