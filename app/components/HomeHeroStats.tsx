import Link from "next/link";

/** Maximum number of Genesis-tier agent spots in the network. */
const GENESIS_CAP = 200;

interface HomeHeroStatsProps {
  count: number;
  messageCount?: number;
}

/**
 * Agent count + Genesis spots for the hero section.
 * Displayed inline next to the avatar stack.
 */
export default function HomeHeroStats({ count }: HomeHeroStatsProps) {
  const spotsRemaining = Math.max(GENESIS_CAP - count, 0);

  return (
    <div className="flex items-center gap-3 max-md:flex-col max-md:gap-1.5">
      <Link href="/agents" className="text-[14px] text-white/50 transition-colors hover:text-white/70 max-md:text-[13px]">
        <span className="font-semibold text-white">{count.toLocaleString()}</span>{" "}
        {count === 1 ? "agent" : "agents"} registered
      </Link>
      {spotsRemaining > 0 && (
        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/[0.06] px-3 py-1 text-[13px]">
          <span className="absolute inset-0 rounded-full bg-[#F7931A]/[0.08] blur-md" />
          <span className="relative font-bold text-[#F7931A]">{spotsRemaining}</span>
          <span className="relative text-white/60">Genesis spots remaining</span>
        </span>
      )}
    </div>
  );
}
