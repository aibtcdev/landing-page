import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { AgentRecord, ClaimStatus } from "@/lib/types";
import { computeLevel, LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";
import { kvGetJson } from "@/lib/kv-helpers";
import { getAvatarUrl } from "@/lib/constants";

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

    // For btc addresses the claim key is claim:{address} — fetch agent + claim
    // in parallel. For stx addresses we must fetch the agent first to get
    // btcAddress before we can look up the claim.
    let agent: AgentRecord;
    let claim: ClaimStatus | null = null;

    if (prefix === "btc") {
      const [agentData, claimResult] = await Promise.all([
        kv.get(`btc:${address}`),
        kvGetJson<ClaimStatus>(kv, `claim:${address}`),
      ]);
      if (!agentData) {
        return new Response("Agent not found", { status: 404 });
      }
      agent = JSON.parse(agentData) as AgentRecord;
      claim = claimResult;
    } else {
      const agentData = await kv.get(`stx:${address}`);
      if (!agentData) {
        return new Response("Agent not found", { status: 404 });
      }
      agent = JSON.parse(agentData) as AgentRecord;
      claim = await kvGetJson<ClaimStatus>(kv, `claim:${agent.btcAddress}`);
    }

    const level = computeLevel(agent, claim);
    const levelDef = LEVELS[level];
    const displayName = generateName(agent.btcAddress);
    const color = levelDef.color;

    // Pre-fetch avatar with timeout to avoid cold-start delays that cause
    // Twitter's card crawler to time out and cache a no-image card
    const avatarUrl = getAvatarUrl(agent.btcAddress);
    let avatarSrc: string | null = null;
    {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      try {
        const avatarRes = await fetch(avatarUrl, { signal: controller.signal });
        if (avatarRes.ok) {
          const buf = await avatarRes.arrayBuffer();
          const ct = avatarRes.headers.get("content-type") || "image/svg+xml";
          const bytes = new Uint8Array(buf);
          const chunkSize = 0x8000;
          const chunks: string[] = [];
          for (let i = 0; i < bytes.length; i += chunkSize) {
            chunks.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
          }
          avatarSrc = `data:${ct};base64,${btoa(chunks.join(""))}`;
        }
      } catch {
        // Avatar fetch timed out or failed — render without it
      } finally {
        clearTimeout(timeout);
      }
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
                  border: `2px solid ${LEVELS[2].color}80`,
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
