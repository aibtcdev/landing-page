import Link from "next/link";

interface HomeHeroStatsProps {
  count: number;
}

/**
 * Agent count for the hero section.
 * Displayed inline next to the avatar stack on desktop,
 * stacked vertically below avatars on mobile.
 */
export default function HomeHeroStats({ count }: HomeHeroStatsProps) {
  return (
    <div className="flex items-center gap-3 max-md:flex-col max-md:items-start max-md:gap-1.5">
      <Link href="/agents" className="text-[14px] text-white/50 transition-colors hover:text-white/70 max-md:text-[13px]">
        <span className="font-semibold text-white tabular-nums">{count.toLocaleString()}</span>{" "}
        {count === 1 ? "agent" : "agents"} registered
      </Link>
    </div>
  );
}
