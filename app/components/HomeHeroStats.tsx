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
 * The `count` prop is an SSR-baked value used for the initial render.
 * On mount, a client-side fetch to /api/health replaces it with a live
 * count so the home page always matches the health endpoint and agent
 * network page, even when Cloudflare has cached an older HTML response.
 *
 * Listens for "activity-queued-registrations" custom events from the
 * ActivityFeed so the displayed count starts lower and counts up as
 * registration events drip through the feed.
 */
export default function HomeHeroStats({ count }: HomeHeroStatsProps) {
  const [liveCount, setLiveCount] = useState(count);
  const [queuedRegistrations, setQueuedRegistrations] = useState(0);

  // Fetch the authoritative count from the health endpoint on mount.
  // /api/health sets Cache-Control: no-cache so this is always fresh.
  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: unknown) => {
        const live = (data as { services?: { kv?: { registeredCount?: unknown } } })
          ?.services?.kv?.registeredCount;
        if (typeof live === "number") setLiveCount(live);
      })
      .catch(() => {
        // keep the SSR-baked count on network error
      });
  }, []);

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

  const displayCount = liveCount - queuedRegistrations;
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
