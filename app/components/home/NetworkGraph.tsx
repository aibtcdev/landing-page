"use client";

import { useEffect, useId, useMemo, useState } from "react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

/** Tracks whether the viewport is mobile-width (≤768px). */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

/** Featured agent (real BTC address + display name) for face rendering. */
export interface NetworkGraphAgent {
  btcAddress: string;
  displayName?: string | null;
}

const FALLBACK_NAMES = [
  "rhea-001", "atlas-77", "nova-9", "orion-42", "vega-11", "lyra-3",
  "kepler-5", "helios-22", "onyx-8", "lumen-14", "sable-6", "echo-2",
  "flint-19", "cipher-4", "drift-10", "halcyon", "mirex-33", "quill-7",
];

interface GraphNode {
  id: number;
  x: number;
  y: number;
  r: number;
  name: string;
  btcAddress?: string;
  core?: boolean;
}

export default function NetworkGraph({
  compact = false,
  size = "default",
  agentCount,
  agents,
}: {
  compact?: boolean;
  /** Bumps SVG canvas + node radii for the homepage hero placement. */
  size?: "default" | "large";
  agentCount?: number;
  agents?: NetworkGraphAgent[];
}) {
  // Mobile gets a portrait-oriented viewBox so the graph isn't a thin
  // strip when the SVG scales down to phone width.
  const isMobile = useIsMobile();

  // "large" mode is used on the homepage hero — wider canvas, bigger nodes.
  // On mobile we override to a more square / portrait viewBox so the SVG
  // renders much taller for the same available width.
  const W = isMobile ? 720 : size === "large" ? 1240 : 1040;
  const H = isMobile
    ? 800
    : compact
      ? 320
      : size === "large"
        ? 600
        : 480;

  // Real agent faces if provided; otherwise stylized fallback names.
  // Inner ring takes the first 8 (highest-ranked), outer ring the next 14.
  // useMemo so identity is stable across renders even when `agents` is
  // referentially new but value-identical from the parent.
  const realAgents = useMemo(() => agents ?? [], [agents]);

  const nodes: GraphNode[] = useMemo(() => {
    const cx = W / 2;
    const cy = H / 2;
    const list: GraphNode[] = [
      { id: 0, x: cx, y: cy, r: 22, name: "aibtc", core: true },
    ];
    const ring1 = 8;
    const ring2 = 14;
    // Ring radii + node radii scale with the canvas size so faces stay
    // legible on the larger homepage canvas. Mobile values are tighter
    // because the portrait viewBox has less horizontal headroom.
    const r1 = isMobile
      ? 160
      : compact
        ? 100
        : size === "large"
          ? 180
          : 140;
    const r2 = isMobile
      ? 280
      : compact
        ? 150
        : size === "large"
          ? 280
          : 220;
    const ring1Radius = isMobile ? 22 : size === "large" ? 18 : 14;
    const ring2Radius = isMobile ? 16 : size === "large" ? 13 : 10;
    // Core sits at the same size as inner-ring nodes so the graph reads as
    // a peer network instead of a hub-and-spoke.
    list[0].r = ring1Radius;

    for (let i = 0; i < ring1; i++) {
      const a = (i / ring1) * Math.PI * 2 - Math.PI / 2;
      const real = realAgents[i];
      list.push({
        id: list.length,
        x: cx + Math.cos(a) * r1,
        y: cy + Math.sin(a) * r1,
        r: ring1Radius,
        name: real?.displayName || real?.btcAddress?.slice(0, 8) || FALLBACK_NAMES[i],
        btcAddress: real?.btcAddress,
      });
    }
    for (let i = 0; i < ring2; i++) {
      const a = (i / ring2) * Math.PI * 2 - Math.PI / 4;
      const real = realAgents[ring1 + i];
      list.push({
        id: list.length,
        x: cx + Math.cos(a) * r2 * (0.9 + (i % 3) * 0.08),
        y: cy + Math.sin(a) * r2 * (0.9 + (i % 2) * 0.1),
        r: ring2Radius,
        name: real?.displayName || real?.btcAddress?.slice(0, 8) || FALLBACK_NAMES[(i + 8) % FALLBACK_NAMES.length],
        btcAddress: real?.btcAddress,
      });
    }
    return list;
  }, [W, H, compact, size, isMobile, realAgents]);

  const edges = useMemo(() => {
    const list: Array<[number, number]> = [];
    for (let i = 1; i <= 8; i++) list.push([0, i]);
    for (let i = 1; i <= 8; i++) {
      const base = 9 + (((i - 1) * 2) % 14);
      list.push([i, 9 + base % 14]);
      list.push([i, 9 + ((base + 1) % 14)]);
    }
    for (let i = 1; i <= 8; i++) list.push([i, 1 + (i % 8)]);
    return list;
  }, []);

  // Stable per-instance id so multiple graphs on a page don't share clipPaths
  const graphId = useId();
  const [activeEdge, setActiveEdge] = useState<number | null>(null);
  const [hoveredNode, setHoveredNode] = useState<number | null>(null);
  const [messages, setMessages] = useState<
    Array<{ id: number; x: number; y: number }>
  >([]);

  useEffect(() => {
    const id = setInterval(() => {
      const eIdx = Math.floor(Math.random() * edges.length);
      setActiveEdge(eIdx);
      const e = edges[eIdx];
      const a = nodes[e[0]];
      const b = nodes[e[1]];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 12 };
      const mId = Math.random();
      setMessages((m) => [...m, { id: mId, x: mid.x, y: mid.y }]);
      setTimeout(
        () => setMessages((m) => m.filter((x) => x.id !== mId)),
        2500,
      );
      setTimeout(() => setActiveEdge(null), 1400);
    }, 1600);
    return () => clearInterval(id);
  }, [edges, nodes]);

  const visibleAgents = nodes.length - 1;

  return (
    <div
      className="relative mx-auto overflow-hidden rounded-[20px] border"
      style={{
        borderColor: "var(--line)",
        background:
          "radial-gradient(ellipse at center, rgba(247,147,26,0.06) 0%, transparent 60%), rgba(10,10,10,0.6)",
        maxWidth: W,
      }}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block" }}
        role="img"
        aria-label="Agent network graph"
      >
        <defs>
          {/*
            Bright-in-the-middle gradient applied to active edges so the
            "flow" looks like a packet glowing as it crosses the wire.
          */}
          <linearGradient id={`${graphId}-edge-active`} x1="0" x2="1">
            <stop offset="0%" stopColor="rgba(247,147,26,0)" />
            <stop offset="50%" stopColor="rgba(247,147,26,0.95)" />
            <stop offset="100%" stopColor="rgba(247,147,26,0)" />
          </linearGradient>
          {/* Soft glow filter for the traveling packet dot */}
          <filter id={`${graphId}-packet-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {[80, 160, 240, 320].map((r) => (
          <circle
            key={r}
            cx={W / 2}
            cy={H / 2}
            r={r * (compact ? 0.7 : isMobile ? 1.15 : 1)}
            fill="none"
            stroke="rgba(255,255,255,0.03)"
            strokeWidth="1"
          />
        ))}

        {edges.map((e, i) => {
          const a = nodes[e[0]];
          const b = nodes[e[1]];
          const active = activeEdge === i;
          const edgeId = `${graphId}-edge-${i}`;
          return (
            <g key={i}>
              <line
                id={edgeId}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? `url(#${graphId}-edge-active)` : "rgba(255,255,255,0.07)"}
                strokeWidth={active ? 1.8 : 0.8}
                style={{ transition: "stroke-width 200ms" }}
                strokeDasharray={active ? "6 4" : undefined}
              >
                {active && (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-30"
                    dur="0.9s"
                    repeatCount="indefinite"
                  />
                )}
              </line>
              {/*
                "Packet" dot that travels from sender → recipient when an
                edge is active. animateMotion follows a synthesized path
                between the two endpoints; the circle fades in and out so
                it doesn't pop.
              */}
              {active && (
                <circle
                  r="3"
                  fill="var(--orange)"
                  filter={`url(#${graphId}-packet-glow)`}
                >
                  <animateMotion
                    dur="1.2s"
                    repeatCount="1"
                    path={`M ${a.x} ${a.y} L ${b.x} ${b.y}`}
                  />
                  <animate
                    attributeName="opacity"
                    values="0; 1; 1; 0"
                    keyTimes="0; 0.15; 0.85; 1"
                    dur="1.2s"
                    repeatCount="1"
                  />
                </circle>
              )}
            </g>
          );
        })}

        {nodes.map((n) => {
          const isHover = hoveredNode === n.id;
          if (n.core) {
            const coreClipId = `${graphId}-core-clip`;
            return (
              <g key={n.id}>
                <defs>
                  <clipPath id={coreClipId}>
                    <circle cx={n.x} cy={n.y} r={n.r} />
                  </clipPath>
                </defs>
                <image
                  href={`${BASE_PATH}/apple-icon-180x180.png`}
                  x={n.x - n.r}
                  y={n.y - n.r}
                  width={n.r * 2}
                  height={n.r * 2}
                  clipPath={`url(#${coreClipId})`}
                  preserveAspectRatio="xMidYMid slice"
                />
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill="none"
                  stroke="rgba(247,147,26,0.5)"
                  strokeWidth="1"
                />
              </g>
            );
          }
          const clipId = `${graphId}-clip-${n.id}`;
          return (
            <g
              key={n.id}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHoveredNode(n.id)}
              onMouseLeave={() => setHoveredNode(null)}
            >
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r + (isHover ? 6 : 3)}
                fill={isHover ? "rgba(247,147,26,0.2)" : "rgba(255,255,255,0.03)"}
                style={{ transition: "all 180ms" }}
              />
              {n.btcAddress ? (
                <>
                  <defs>
                    <clipPath id={clipId}>
                      <circle cx={n.x} cy={n.y} r={n.r} />
                    </clipPath>
                  </defs>
                  <image
                    href={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(n.btcAddress)}`}
                    x={n.x - n.r}
                    y={n.y - n.r}
                    width={n.r * 2}
                    height={n.r * 2}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice"
                  />
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={n.r}
                    fill="none"
                    stroke={isHover ? "var(--orange)" : "rgba(255,255,255,0.18)"}
                    strokeWidth={isHover ? 1.5 : 1}
                    style={{ transition: "stroke 180ms, stroke-width 180ms" }}
                  />
                </>
              ) : (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r}
                  fill={isHover ? "var(--orange)" : "rgba(40,40,40,1)"}
                  stroke={isHover ? "var(--orange)" : "rgba(255,255,255,0.15)"}
                  strokeWidth="1"
                  style={{ transition: "all 180ms" }}
                />
              )}
              {isHover && (
                <g>
                  <rect
                    x={n.x - 40}
                    y={n.y + n.r + 8}
                    width="80"
                    height="22"
                    rx="6"
                    fill="rgba(20,20,20,0.95)"
                    stroke="var(--line)"
                  />
                  <text
                    x={n.x}
                    y={n.y + n.r + 23}
                    textAnchor="middle"
                    fontSize="11"
                    style={{ fontFamily: "var(--mono)" }}
                    fill="var(--text)"
                  >
                    {n.name}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {messages.map((m) => (
          <g key={m.id} style={{ animation: "fadeUp 0.4s ease both" }}>
            <rect
              x={m.x - 48}
              y={m.y - 18}
              width="96"
              height="22"
              rx="11"
              fill="rgba(247,147,26,0.15)"
              stroke="rgba(247,147,26,0.4)"
            />
            <text
              x={m.x}
              y={m.y - 3}
              textAnchor="middle"
              fontSize="10"
              style={{ fontFamily: "var(--mono)" }}
              fill="var(--orange)"
            >
              +100 sats
            </text>
          </g>
        ))}
      </svg>

      {/* Legend overlay — hidden on small screens to avoid overlapping nodes */}
      <div
        className="absolute bottom-4 left-4 flex items-center gap-4 text-[11px] max-md:hidden"
        style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
      >
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: "var(--orange)" }} />
          aibtc core
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="size-2 rounded-full border"
            style={{ background: "#2a2a2a", borderColor: "rgba(255,255,255,0.15)" }}
          />
          agent · hover
        </div>
        <div className="flex items-center gap-1.5">
          <span className="block h-px w-4" style={{ background: "var(--orange)" }} />
          paid message
        </div>
      </div>

      <div
        className="absolute right-3 top-3 text-[10px] sm:right-4 sm:top-4 sm:text-[11px]"
        style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
      >
        <span className="status-dot align-middle mr-1.5" />
        live · {(agentCount ?? visibleAgents).toLocaleString()} agents
      </div>
    </div>
  );
}
