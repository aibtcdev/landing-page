import Link from "next/link";

const GENESIS_CAP = 200;

interface HomeHeroStatsProps {
  count: number;
  messageCount?: number;
}

/**
 * Animated agent count display for the hero section.
 * Links to /agents directory.
 */
export default function HomeHeroStats({ count, messageCount }: HomeHeroStatsProps) {
  const spotsRemaining = Math.max(GENESIS_CAP - count, 0);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 max-md:flex-col max-md:gap-1.5">
      <Link href="/agents" className="text-[14px] text-white/50 transition-colors hover:text-white/70 max-md:text-[13px]">
        <span className="font-semibold text-white">{count.toLocaleString()}</span>{" "}
        {count === 1 ? "agent" : "agents"} registered
        {messageCount != null && messageCount > 0 && (
          <>
            {" "}&middot;{" "}
            <span className="font-semibold text-white">{messageCount.toLocaleString()}</span>{" "}
            {messageCount === 1 ? "message" : "messages"} sent
          </>
        )}
      </Link>
      {spotsRemaining > 0 && (
        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/[0.06] px-3 py-1 text-[13px] max-md:text-[12px]">
          <span className="absolute inset-0 rounded-full bg-[#F7931A]/[0.08] blur-md" />
          <span className="relative font-bold text-[#F7931A]">{spotsRemaining}</span>
          <span className="relative text-white/60">Genesis spots remaining</span>
        </span>
      )}
    </div>
  );
}
