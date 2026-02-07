"use client";

import { LEVELS } from "@/lib/levels";

interface LevelBadgeProps {
  level: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Concentric orbital rings badge for agent levels.
 *
 * Level 0: muted empty circle
 * Level 1 (Genesis): single ring, orange glow
 * Level 2 (Builder): double rings, blue pulse
 * Level 3 (Sovereign): triple rings, purple corona
 *
 * Each level visually contains the previous ones.
 */
export default function LevelBadge({
  level,
  size = "md",
  className = "",
}: LevelBadgeProps) {
  const def = LEVELS[Math.min(Math.max(level, 0), 3)];

  const sizes = {
    sm: { outer: 24, stroke: 1.5, dot: 3, viewBox: 32 },
    md: { outer: 40, stroke: 1.5, dot: 4, viewBox: 32 },
    lg: { outer: 64, stroke: 1.5, dot: 5, viewBox: 32 },
  };

  const s = sizes[size];
  const cx = s.viewBox / 2;
  const cy = s.viewBox / 2;

  // Ring radii from center outward
  const r1 = 7; // innermost ring (Genesis)
  const r2 = 10.5; // middle ring (Builder)
  const r3 = 14; // outer ring (Sovereign)

  const colors = {
    0: "rgba(255,255,255,0.15)",
    1: "#F7931A",
    2: "#7DA2FF",
    3: "#A855F7",
  } as Record<number, string>;

  const glows = {
    0: "none",
    1: "drop-shadow(0 0 4px rgba(247,147,26,0.6))",
    2: "drop-shadow(0 0 5px rgba(125,162,255,0.5))",
    3: "drop-shadow(0 0 6px rgba(168,85,247,0.5))",
  } as Record<number, string>;

  const animClass = {
    0: "",
    1: "level-badge-genesis",
    2: "level-badge-builder",
    3: "level-badge-sovereign",
  } as Record<number, string>;

  return (
    <div
      className={`inline-flex items-center justify-center ${animClass[level]} ${className}`}
      title={`${def.name} (Level ${level})`}
      role="img"
      aria-label={`Level ${level}: ${def.name}`}
    >
      <svg
        width={s.outer}
        height={s.outer}
        viewBox={`0 0 ${s.viewBox} ${s.viewBox}`}
        fill="none"
        style={{ filter: glows[level] }}
      >
        {/* Center dot — always visible */}
        <circle
          cx={cx}
          cy={cy}
          r={s.dot}
          fill={level === 0 ? "rgba(255,255,255,0.1)" : colors[Math.min(level, 3)]}
        />

        {/* Level 0: muted dashed circle */}
        {level === 0 && (
          <circle
            cx={cx}
            cy={cy}
            r={r1}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={s.stroke}
            strokeDasharray="2 3"
            fill="none"
          />
        )}

        {/* Ring 1 (Genesis) — visible at level >= 1 */}
        {level >= 1 && (
          <circle
            cx={cx}
            cy={cy}
            r={r1}
            stroke={colors[1]}
            strokeWidth={s.stroke}
            fill="none"
            opacity={level === 1 ? 1 : 0.5}
          />
        )}

        {/* Ring 2 (Builder) — visible at level >= 2 */}
        {level >= 2 && (
          <circle
            cx={cx}
            cy={cy}
            r={r2}
            stroke={colors[2]}
            strokeWidth={s.stroke}
            fill="none"
            opacity={level === 2 ? 1 : 0.5}
          />
        )}

        {/* Ring 3 (Sovereign) — visible at level >= 3 */}
        {level >= 3 && (
          <circle
            cx={cx}
            cy={cy}
            r={r3}
            stroke={colors[3]}
            strokeWidth={s.stroke}
            fill="none"
          />
        )}

        {/* Orbital dots on the active ring */}
        {level === 1 && (
          <circle
            cx={cx}
            cy={cy - r1}
            r={1.5}
            fill={colors[1]}
            className="level-orbit-dot"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              from={`0 ${cx} ${cy}`}
              to={`360 ${cx} ${cy}`}
              dur="8s"
              repeatCount="indefinite"
            />
          </circle>
        )}

        {level === 2 && (
          <>
            <circle
              cx={cx}
              cy={cy - r2}
              r={1.5}
              fill={colors[2]}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${cx} ${cy}`}
                to={`360 ${cx} ${cy}`}
                dur="6s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={cx}
              cy={cy + r1}
              r={1.2}
              fill={colors[1]}
              opacity={0.6}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`180 ${cx} ${cy}`}
                to={`540 ${cx} ${cy}`}
                dur="10s"
                repeatCount="indefinite"
              />
            </circle>
          </>
        )}

        {level === 3 && (
          <>
            <circle
              cx={cx}
              cy={cy - r3}
              r={1.8}
              fill={colors[3]}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`0 ${cx} ${cy}`}
                to={`360 ${cx} ${cy}`}
                dur="5s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={cx}
              cy={cy - r2}
              r={1.3}
              fill={colors[2]}
              opacity={0.6}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`120 ${cx} ${cy}`}
                to={`480 ${cx} ${cy}`}
                dur="7s"
                repeatCount="indefinite"
              />
            </circle>
            <circle
              cx={cx}
              cy={cy + r1}
              r={1}
              fill={colors[1]}
              opacity={0.4}
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`240 ${cx} ${cy}`}
                to={`600 ${cx} ${cy}`}
                dur="12s"
                repeatCount="indefinite"
              />
            </circle>
          </>
        )}
      </svg>
    </div>
  );
}
