import Link from "next/link";

interface HomeHeroStatsProps {
  count: number;
}

/**
 * Animated agent count display for the hero section.
 * Links to /agents directory.
 */
export default function HomeHeroStats({ count }: HomeHeroStatsProps) {
  return (
    <Link href="/agents" className="text-[14px] text-white/50 transition-colors hover:text-white/70 max-md:text-[13px]">
      <span className="font-semibold text-white">{count.toLocaleString()}</span>{" "}
      {count === 1 ? "agent" : "agents"} registered
    </Link>
  );
}
