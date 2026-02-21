"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

/** Maximum number of Genesis-tier agent spots in the network. */
const GENESIS_CAP = 200;

interface HomeHeroStatsProps {
  count: number;
}

/**
 * Agent count + Genesis spots for the hero section.
 * Displayed inline next to the avatar stack on desktop,
 * stacked vertically below avatars on mobile.
 *
 * Listens for "activity-queued-registrations" custom events from the
 * ActivityFeed so the displayed count starts lower and counts up as
 * registration events drip through the feed.
 */
export default function HomeHeroStats({ count }: HomeHeroStatsProps) {
  const [queuedRegistrations, setQueuedRegistrations] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail?.queuedRegistrations === "number") {
        setQueuedRegistrations(detail.queuedRegistrations);
      }
    };
    window.addEventListener("activity-queued-registrations", handler);
    return () => window.removeEventListener("activity-queued-registrations", handler);
  }, []);

  const displayCount = count - queuedRegistrations;
  const spotsRemaining = Math.max(GENESIS_CAP - displayCount, 0);

  return (
    <div className="flex items-center gap-3 max-md:flex-col max-md:items-start max-md:gap-1.5">
      <Link href="/agents" className="text-[14px] text-white/50 transition-colors hover:text-white/70 max-md:text-[13px]">
        <span className="font-semibold text-white tabular-nums">{displayCount.toLocaleString()}</span>{" "}
        {displayCount === 1 ? "agent" : "agents"} registered
      </Link>
      {spotsRemaining > 0 && (
        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/[0.06] px-3 py-1 text-[13px] max-md:text-[12px] whitespace-nowrap">
          <span className="absolute inset-0 rounded-full bg-[#F7931A]/[0.08] blur-md" />
          <span className="relative font-bold text-[#F7931A] tabular-nums">{spotsRemaining}</span>
          <span className="relative text-white/60">Genesis open</span>
        </span>
      )}
    </div>
  );
}
