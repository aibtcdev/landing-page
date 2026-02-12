"use client";

import useSWR from "swr";
import AchievementBadge from "./AchievementBadge";
import { fetcher } from "@/lib/fetcher";
import type { AchievementDefinition } from "@/lib/achievements";

interface AchievementResponse {
  btcAddress: string;
  achievements: {
    id: string;
    name: string;
    unlockedAt: string;
    category: "onchain" | "engagement";
    description: string;
  }[];
  available: AchievementDefinition[];
}

interface AchievementListProps {
  btcAddress: string;
  className?: string;
}

/**
 * Grid layout of achievement badges.
 *
 * Fetches from /api/achievements?btcAddress=... and displays
 * earned achievements first, then available ones dimmed.
 */
export default function AchievementList({
  btcAddress,
  className = "",
}: AchievementListProps) {
  const { data, error, isLoading: loading } = useSWR<AchievementResponse>(
    `/api/achievements?btcAddress=${encodeURIComponent(btcAddress)}`,
    fetcher
  );

  if (loading) {
    return (
      <div className={`space-y-2 ${className}`}>
        <div className="flex items-center gap-2">
          <div className="h-4 w-24 animate-pulse rounded bg-white/[0.06]" />
        </div>
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-8 w-24 animate-pulse rounded-full bg-white/[0.06]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || (!loading && !data)) {
    return (
      <div className={`text-[12px] text-red-400/60 ${className}`}>
        Failed to load achievements
      </div>
    );
  }

  if (!data) return null;

  const hasEarnedAchievements = data.achievements.length > 0;

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-medium text-white">Achievements</h3>
        {hasEarnedAchievements && (
          <span className="text-[12px] text-white/40">
            {data.achievements.length} / {data.achievements.length + data.available.length}
          </span>
        )}
      </div>

      {/* Empty state */}
      {!hasEarnedAchievements && data.available.length === 0 && (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center">
          <p className="text-[13px] text-white/40">
            No achievements available yet
          </p>
        </div>
      )}

      {/* Achievement grid */}
      {(hasEarnedAchievements || data.available.length > 0) && (
        <>
          {/* Earned achievements first */}
          {hasEarnedAchievements && (
            <div className="mb-3 flex flex-wrap gap-2">
              {data.achievements.map((achievement) => (
                <AchievementBadge
                  key={achievement.id}
                  achievement={achievement}
                  earned={true}
                  unlockedAt={achievement.unlockedAt}
                />
              ))}
            </div>
          )}

          {/* Available achievements (dimmed) */}
          {data.available.length > 0 && (
            <>
              {hasEarnedAchievements && (
                <div className="mb-2 mt-4 text-[11px] font-medium uppercase tracking-wider text-white/30">
                  Available
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {data.available.map((achievement) => (
                  <AchievementBadge
                    key={achievement.id}
                    achievement={achievement}
                    earned={false}
                  />
                ))}
              </div>
            </>
          )}

          {/* Empty state for no achievements earned yet */}
          {!hasEarnedAchievements && data.available.length > 0 && (
            <p className="mt-3 text-[12px] text-white/40">
              No achievements earned yet — stay active via{" "}
              <a
                href="/paid-attention"
                className="text-[#7DA2FF]/70 hover:text-[#7DA2FF] transition-colors"
              >
                paid-attention
              </a>
              !
            </p>
          )}
        </>
      )}
    </div>
  );
}
