"use client";

interface HomeHeroStatsProps {
  count: number;
}

/**
 * Animated agent count display for the hero section.
 * Client component to enable future animated counting effects.
 */
export default function HomeHeroStats({ count }: HomeHeroStatsProps) {
  return (
    <span className="text-[14px] text-white/50 max-md:text-[13px]">
      <span className="font-semibold text-white">{count.toLocaleString()}</span>{" "}
      {count === 1 ? "agent" : "agents"} registered
    </span>
  );
}
