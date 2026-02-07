"use client";

import { useState, useRef, useEffect } from "react";
import { LEVELS, getNextLevel } from "@/lib/levels";

interface LevelTooltipProps {
  level: number;
  children: React.ReactNode;
  className?: string;
}

/**
 * Hover/tap tooltip explaining the current level and how to reach the next one.
 * Wraps any child element (typically a LevelBadge).
 */
export default function LevelTooltip({
  level,
  children,
  className = "",
}: LevelTooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState<"top" | "bottom">("top");
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const def = LEVELS[Math.min(Math.max(level, 0), 3)];
  const next = getNextLevel(level);

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      // If too close to top, show below
      setPosition(rect.top < 120 ? "bottom" : "top");
    }
  }, [isVisible]);

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => setIsVisible(true)}
      onBlur={() => setIsVisible(false)}
      tabIndex={0}
      role="button"
      aria-describedby={isVisible ? "level-tooltip" : undefined}
    >
      {children}

      {isVisible && (
        <div
          ref={tooltipRef}
          id="level-tooltip"
          role="tooltip"
          className={`absolute left-1/2 z-50 w-56 -translate-x-1/2 rounded-lg border border-white/10 bg-[rgba(15,15,15,0.95)] px-3.5 py-3 shadow-xl backdrop-blur-xl ${
            position === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {/* Level name */}
          <div className="mb-1.5 flex items-center gap-2">
            <div
              className="size-2 rounded-full"
              style={{ backgroundColor: def.color }}
            />
            <span className="text-xs font-medium text-white">
              {level === 0 ? "Unverified" : `Level ${level}: ${def.name}`}
            </span>
          </div>

          {/* Description */}
          <p className="mb-2 text-[11px] leading-relaxed text-white/50">
            {def.description}
          </p>

          {/* Next level action */}
          {next && (
            <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                Next: {next.name}
              </span>
              <p className="mt-0.5 text-[11px] leading-snug text-white/60">
                {next.action}
              </p>
              <p className="mt-1 text-[10px] text-white/30">
                Reward: {next.reward}
              </p>
            </div>
          )}

          {level === 3 && (
            <div className="rounded-md border border-purple-500/20 bg-purple-500/5 px-2.5 py-2">
              <span className="text-[11px] font-medium text-purple-400">
                Max level reached
              </span>
            </div>
          )}

          {/* Arrow */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 border-[6px] border-transparent ${
              position === "top"
                ? "top-full border-t-[rgba(15,15,15,0.95)]"
                : "bottom-full border-b-[rgba(15,15,15,0.95)]"
            }`}
          />
        </div>
      )}
    </div>
  );
}
