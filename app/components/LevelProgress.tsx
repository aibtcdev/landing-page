import { LEVELS } from "@/lib/levels";
import type { NextLevelInfo } from "@/lib/levels";

interface LevelProgressProps {
  level: number;
  nextLevel?: NextLevelInfo | null;
  className?: string;
}

/**
 * Compact horizontal progress bar showing current level and next unlock.
 * Designed for profile pages and cards.
 */
export default function LevelProgress({
  level,
  nextLevel,
  className = "",
}: LevelProgressProps) {
  const def = LEVELS[Math.min(Math.max(level, 0), 2)];

  const segmentColors = [
    "rgba(255,255,255,0.15)", // segment 0→1
    "#F7931A", // segment 1 (Registered)
    "#7DA2FF", // segment 2 (Genesis)
  ];

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {/* Level label */}
      <div className="flex items-center justify-between">
        <span
          className="text-xs font-medium"
          style={{ color: def.color }}
        >
          {level === 0 ? "Unverified" : `Level ${level}: ${def.name}`}
        </span>
        {nextLevel && (
          <span className="text-[11px] text-white/40">
            Next: {nextLevel.name}
          </span>
        )}
      </div>

      {/* Progress bar — 2 segments */}
      <div className="flex gap-1">
        {[1, 2].map((seg) => (
          <div
            key={seg}
            className="h-1 flex-1 rounded-full transition-all duration-500"
            style={{
              backgroundColor:
                level >= seg
                  ? segmentColors[seg]
                  : "rgba(255,255,255,0.06)",
            }}
          />
        ))}
      </div>

      {/* Next action hint */}
      {nextLevel && (
        <p className="text-[11px] leading-tight text-white/30">
          {nextLevel.action}
        </p>
      )}
    </div>
  );
}
