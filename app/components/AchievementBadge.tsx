"use client";

import { useState, useRef, useEffect } from "react";
import type { AchievementDefinition } from "@/lib/achievements";

interface AchievementBadgeProps {
  achievement: AchievementDefinition;
  earned: boolean;
  unlockedAt?: string;
  className?: string;
}

/**
 * Pill/badge component for a single achievement.
 *
 * Earned state: colored pill with name (onchain=orange, engagement=blue)
 * Unearned state: muted/ghosted pill with lock icon
 * Hover shows description and unlock date if earned
 */
export default function AchievementBadge({
  achievement,
  earned,
  unlockedAt,
  className = "",
}: AchievementBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [position, setPosition] = useState<"top" | "bottom">("top");
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (showTooltip && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition(rect.top < 100 ? "bottom" : "top");
    }
  }, [showTooltip]);

  const categoryColors = {
    onchain: "#F7931A", // orange
    engagement: "#7DA2FF", // blue
  };

  const color = categoryColors[achievement.category];

  const unlockDate = unlockedAt
    ? new Date(unlockedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onFocus={() => setShowTooltip(true)}
      onBlur={() => setShowTooltip(false)}
      tabIndex={0}
      role="img"
      aria-label={`${achievement.name}: ${achievement.description}${earned ? ` (unlocked ${unlockDate})` : " (locked)"}`}
    >
      {/* Badge pill */}
      <div
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-all ${
          earned
            ? "border border-white/10 shadow-sm"
            : "border border-white/[0.08] opacity-60"
        }`}
        style={{
          backgroundColor: earned
            ? `${color}15`
            : "rgba(255,255,255,0.04)",
          color: earned ? color : "rgba(255,255,255,0.4)",
        }}
      >
        {/* Icon */}
        {earned ? (
          <svg
            className="size-3.5 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
        ) : (
          <svg
            className="size-3 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        )}
        <span className="truncate">{achievement.name}</span>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div
          role="tooltip"
          className={`absolute left-1/2 z-50 w-48 -translate-x-1/2 rounded-lg border border-white/10 bg-[rgba(15,15,15,0.95)] px-3.5 py-3 shadow-xl backdrop-blur-xl ${
            position === "top" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {/* Achievement name */}
          <div className="mb-1.5 flex items-center gap-2">
            <div
              className="size-2 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs font-medium text-white">
              {achievement.name}
            </span>
          </div>

          {/* Description */}
          <p className="mb-2 text-[11px] leading-relaxed text-white/50">
            {achievement.description}
          </p>

          {/* Unlock date or locked status */}
          {earned && unlockDate && (
            <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-white/30">
                Unlocked
              </span>
              <p className="mt-0.5 text-[11px] text-white/60">{unlockDate}</p>
            </div>
          )}

          {!earned && (
            <div className="rounded-md border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
              <span className="text-[11px] text-white/40">
                {achievement.category === "onchain"
                  ? "Verify on-chain activity via /api/achievements/verify"
                  : "Earned via paid-attention responses"}
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
