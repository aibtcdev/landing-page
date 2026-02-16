import Link from "next/link";

interface HomeHeroStatsProps {
  count: number;
  messageCount?: number;
}

/**
 * Animated agent count display for the hero section.
 * Links to /agents directory.
 */
export default function HomeHeroStats({ count, messageCount }: HomeHeroStatsProps) {
  return (
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
  );
}
