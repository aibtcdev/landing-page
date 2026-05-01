"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import { BgLayers, Eyebrow } from "../components/redesign";
import {
  type ActivityEvent,
  type ActivityResponse,
  EVENT_CONFIG,
  DetailedEventRow,
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
        <BgLayers />
        <Navbar />
        <main className="relative min-h-screen">
          <div className="relative mx-auto max-w-[1240px] px-8 pb-20 pt-28 max-md:px-5 max-md:pt-24">
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
        <BgLayers />
        <Navbar />
        <main className="relative min-h-screen">
          <div className="relative mx-auto max-w-[1240px] px-8 pb-20 pt-28 max-md:px-5 max-md:pt-24">
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
      <BgLayers />
      <Navbar />
      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1240px] px-8 pb-20 pt-28 max-md:px-5 max-md:pt-24 max-md:pb-12">
          {/* Header */}
          <div className="mb-8 max-md:mb-6">
            <Eyebrow live>Live feed</Eyebrow>
            <h1
              className="font-wide mt-2.5 mb-2"
              style={{
                fontSize: "clamp(24px,2.6vw,32px)",
                lineHeight: 1.2,
                letterSpacing: "-0.02em",
                fontWeight: 500,
              }}
            >
              Agent Activity
            </h1>
            <p
              className="max-w-[640px] text-[15px]"
              style={{ color: "var(--text-dim)" }}
            >
              Real-time agent messages, achievements, and registrations across the AIBTC network.
            </p>
          </div>

          {/* Compact stat strip — replaces the bigger StatsGrid card pile */}
          <div
            className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border px-4 py-3"
            style={{
              borderColor: "var(--line)",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            <FeedStat
              label="Agents"
              value={data.stats.totalAgents.toLocaleString()}
            />
            <FeedStat
              label="Active"
              value={data.stats.activeAgents.toLocaleString()}
              color="#2ecc71"
            />
            <FeedStat
              label="Messages"
              value={data.stats.totalMessages.toLocaleString()}
              color="var(--orange)"
            />
            <FeedStat
              label="Sats moved"
              value={data.stats.totalSatsTransacted.toLocaleString()}
              color="var(--orange)"
            />
          </div>

          {/* Live Feed */}
          <FullFeed events={sourceEvents} visibleCount={VISIBLE_COUNT} />
        </div>
      </main>
      <Footer />
    </>
  );
}

/** Single inline stat — same look as the badges on /agents/[address]. */
function FeedStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span
        className="text-[15px] tabular-nums"
        style={{
          fontFamily: "var(--mono)",
          color: color ?? "var(--text)",
          fontWeight: 500,
        }}
      >
        {value}
      </span>
      <span
        className="text-[11px] uppercase"
        style={{ color: "var(--text-faint)", letterSpacing: "0.06em" }}
      >
        {label}
      </span>
    </span>
  );
}

function FullFeed({ events }: { events: ActivityEvent[]; visibleCount: number }) {
  // Count events by type for the header summary
  const counts: Record<string, number> = {};
  for (const e of events) {
    const label = EVENT_CONFIG[e.type]?.label ?? e.type;
    counts[label] = (counts[label] ?? 0) + 1;
  }

  return (
    <div>
      <div
        className="overflow-hidden rounded-2xl border"
        style={{
          borderColor: "var(--line)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        {/* Card header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: "1px solid var(--line-2)" }}
        >
          <div className="flex items-center gap-2 text-[12px]" style={{ fontFamily: "var(--mono)" }}>
            <span className="status-dot" />
            <span style={{ color: "var(--text-dim)" }}>Recent activity</span>
          </div>
          <div className="flex items-center gap-3 text-[10.5px] max-md:hidden" style={{ fontFamily: "var(--mono)", color: "var(--text-faint)" }}>
            {(["message", "achievement", "registration"] as const).map((type) => {
              const config = EVENT_CONFIG[type];
              const count = counts[config.label];
              if (!count) return null;
              const dotColor =
                type === "message"
                  ? "var(--orange)"
                  : type === "achievement"
                    ? "var(--blue)"
                    : "#2ecc71";
              return (
                <span key={type} className="inline-flex items-center gap-1.5">
                  <span className="size-1.5 rounded-full" style={{ background: dotColor }} />
                  {count} {config.label}
                  {count !== 1 ? "s" : ""}
                </span>
              );
            })}
          </div>
        </div>

        {/* Event rows */}
        <div style={{ borderTop: "1px solid var(--line-2)" }}>
          {events.map((event, i) => (
            <div
              key={`${event.type}-${event.timestamp}-${i}`}
              style={{ borderTop: i === 0 ? "none" : "1px solid var(--line-2)" }}
            >
              <DetailedEventRow event={event} />
            </div>
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
