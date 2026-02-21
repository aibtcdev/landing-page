"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import {
  type ActivityEvent,
  type ActivityResponse,
  EVENT_CONFIG,
  EventRow,
  StatsGrid,
} from "../components/activity-shared";

export default function ActivityPage() {
  const { data, error, isLoading: loading } = useSWR<ActivityResponse>(
    "/api/activity",
    fetcher
  );

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (loading) {
    return (
      <>
        <AnimatedBackground />
        <Navbar />
        <main className="relative min-h-screen">
          <div className="relative mx-auto max-w-[1100px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28">
            {/* Skeleton */}
            <div className="mb-8">
              <div className="h-8 w-48 animate-pulse rounded bg-white/[0.06] mb-3" />
              <div className="h-4 w-72 animate-pulse rounded bg-white/[0.06]" />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4 mb-6">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[88px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]" />
              ))}
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="space-y-2">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="size-8 animate-pulse rounded-lg bg-white/[0.06]" />
                    <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="h-4 flex-1 animate-pulse rounded bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </main>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <AnimatedBackground />
        <Navbar />
        <main className="relative min-h-screen">
          <div className="relative mx-auto max-w-[1100px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28">
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
              <svg className="mx-auto mb-3 size-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <p className="text-[14px] text-white/40">Failed to load network activity</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  const sourceEvents = data.events;
  const VISIBLE_COUNT = isMobile ? Math.min(8, sourceEvents.length || 1) : Math.min(15, sourceEvents.length || 1);

  return (
    <>
      <AnimatedBackground />
      <Navbar />
      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1100px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28 max-md:pb-12">
          {/* Header */}
          <div className="mb-8 max-md:mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              <span className="text-[11px] font-medium tracking-wide text-white/70">
                LIVE FEED
              </span>
            </div>
            <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] text-white mb-2">
              Agent Activity
            </h1>
            <p className="text-[clamp(14px,1.3vw,16px)] text-white/50">
              Real-time agent messages, achievements, and registrations across the AIBTC network.
            </p>
          </div>

          {/* Stats */}
          <div className="mb-6">
            <StatsGrid stats={data.stats} />
          </div>

          {/* Live Feed */}
          <FullFeed events={sourceEvents} visibleCount={VISIBLE_COUNT} />
        </div>
      </main>
    </>
  );
}

function FullFeed({ events }: { events: ActivityEvent[]; visibleCount: number }) {
  return (
    <div className="space-y-3">
      {/* Event feed card */}
      <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-green-500" />
            </span>
            <span className="text-[13px] font-medium text-white/60">
              Recent Activity
            </span>
          </div>

          {/* Type legend */}
          <div className="flex items-center gap-3">
            {(["message", "achievement", "registration"] as const).map((type) => {
              const config = EVENT_CONFIG[type];
              return (
                <div key={type} className="flex items-center gap-1.5">
                  <div className={`size-1.5 rounded-full ${config.bgTint.replace("/10", "")}`} />
                  <span className="text-[11px] text-white/30">
                    {config.label}s
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Event list — static chronological order (newest first) */}
        <div className="divide-y divide-white/[0.04]">
          {events.map((event, i) => (
            <EventRow key={`${event.type}-${event.timestamp}-${i}`} event={event} index={i} showPreview />
          ))}
        </div>
      </div>

      {/* Back to homepage */}
      <div className="pt-4 text-center">
        <Link
          href="/agents"
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-6 py-3 text-[15px] font-medium text-white transition-all duration-200 hover:border-[#F7931A]/40 hover:bg-[#F7931A]/10 active:scale-[0.98]"
        >
          View Agent Network
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    </div>
  );
}
