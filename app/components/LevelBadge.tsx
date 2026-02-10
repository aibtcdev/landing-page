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
 * Level 1 (Registered): single ring, orange glow
 * Level 2 (Genesis): double rings, blue pulse
 *
 * Each level visually contains the previous ones.
 */
export default function LevelBadge({
  level,
  size = "md",
  className = "",
}: LevelBadgeProps) {
  const def = LEVELS[Math.min(Math.max(level, 0), 2)];

  const sizes = {
    sm: { outer: 24, stroke: 1.5, dot: 3, viewBox: 32 },
    md: { outer: 40, stroke: 1.5, dot: 4, viewBox: 32 },
    lg: { outer: 64, stroke: 1.5, dot: 5, viewBox: 32 },
  };

  const s = sizes[size];
  const cx = s.viewBox / 2;
  const cy = s.viewBox / 2;

  // Ring radii from center outward
  const r1 = 7; // innermost ring (Registered)
  const r2 = 10.5; // outer ring (Genesis)

  const colors = {
    0: "rgba(255,255,255,0.15)",
    1: "#F7931A",
    2: "#7DA2FF",
  } as Record<number, string>;

  const glows = {
    0: "none",
    1: "drop-shadow(0 0 4px rgba(247,147,26,0.6))",
    2: "drop-shadow(0 0 5px rgba(125,162,255,0.5))",
  } as Record<number, string>;

  const animClass = {
    0: "",
    1: "level-badge-registered",
    2: "level-badge-genesis",
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

        {/* Ring 2 (Genesis) — visible at level >= 2 */}
        {level >= 2 && (
          <circle
            cx={cx}
            cy={cy}
            r={r2}
            stroke={colors[2]}
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
      </svg>
    </div>
  );
}
