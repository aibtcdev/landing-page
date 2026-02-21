"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import {
  type ActivityEvent,
  type ActivityResponse,
  type NetworkStats,
  EVENT_CONFIG,
  EventRow,
  StatsGrid,
  formatNumber,
} from "./activity-shared";

/**
 * Activity feed component for homepage.
 *
 * Fetches from GET /api/activity and displays:
 * - Recent event feed (messages, achievements, registrations)
 * - Paid messages stat bar
 *
 * Follows pattern from InboxActivity.tsx (SWR fetch, loading skeleton).
 */
export default function ActivityFeed() {
  const { data, error, isLoading: loading } = useSWR<ActivityResponse>(
    "/api/activity",
    fetcher
  );

  // Show fewer rows on mobile — hooks must be before early returns
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
      <div className="space-y-3">
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[88px] animate-pulse rounded-xl border border-white/[0.06] bg-white/[0.03]"
            />
          ))}
        </div>

        {/* Events skeleton */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="mb-4 h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2.5"
              >
                <div className="size-8 animate-pulse rounded-lg bg-white/[0.06]" />
                <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/[0.06]" />
                <div className="h-3 w-12 animate-pulse rounded bg-white/[0.06]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
        <svg className="mx-auto mb-3 size-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        <p className="text-[13px] text-white/40">Failed to load network activity</p>
      </div>
    );
  }

  const sourceEvents = data.events;

  if (sourceEvents.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
        <p className="text-[13px] text-white/40">No activity yet — be the first to register and send a message.</p>
      </div>
    );
  }

  const VISIBLE_COUNT = isMobile ? 4 : Math.min(6, sourceEvents.length);

  return (
    <LiveFeed events={sourceEvents} visibleCount={VISIBLE_COUNT} stats={data.stats} />
  );
}

/**
 * Animated live feed — absolute-positioned items slide smoothly via CSS transitions.
 * New items enter with a slide+glow animation; existing items transition down.
 */
function LiveFeed({ events, visibleCount, stats }: { events: ActivityEvent[]; visibleCount: number; stats: NetworkStats }) {
  const uidRef = useRef(0);
  const eventIndexRef = useRef(visibleCount - 1);
  const [enteringUid, setEnteringUid] = useState<number | null>(null);
  const [bonusMessages, setBonusMessages] = useState(0);
  const [bonusSats, setBonusSats] = useState(0);

  const [items, setItems] = useState(() =>
    Array.from({ length: visibleCount }, (_, i) => ({
      uid: uidRef.current++,
      event: events[i % events.length],
    }))
  );

  // Reset bonus counters when fresh API data arrives
  useEffect(() => {
    setBonusMessages(0);
    setBonusSats(0);
  }, [stats.totalMessages, stats.totalSatsTransacted]);

  useEffect(() => {
    const interval = setInterval(() => {
      eventIndexRef.current = (eventIndexRef.current + 1) % events.length;
      const newUid = uidRef.current++;
      const incoming = events[eventIndexRef.current];

      if (incoming?.type === "message" && incoming.paymentSatoshis) {
        setBonusMessages((m) => m + 1);
        setBonusSats((s) => s + incoming.paymentSatoshis!);
      }

      setEnteringUid(newUid);
      setItems((prev) => [
        { uid: newUid, event: incoming },
        ...prev.slice(0, visibleCount),
      ]);
    }, 2400);
    return () => clearInterval(interval);
  }, [events, visibleCount]);

  useEffect(() => {
    if (enteringUid !== null) {
      const t = setTimeout(() => setEnteringUid(null), 2300);
      return () => clearTimeout(t);
    }
  }, [enteringUid]);

  const displayMessages = stats.totalMessages + bonusMessages;
  const displaySats = stats.totalSatsTransacted + bonusSats;

  return (
    <Link href="/activity" className="block space-y-2 group/feed">
    <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px] overflow-hidden transition-colors duration-200 group-hover/feed:border-white/[0.12]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3 max-md:px-4">
        <div className="flex items-center gap-2.5">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
          </span>
          <span className="text-[13px] font-medium text-white/60">
            Activity
          </span>
        </div>

        {/* Type legend — dots only, no labels (compact homepage widget) */}
        <div className="flex items-center gap-2">
          {(["message", "achievement", "registration"] as const).map((type) => {
            const config = EVENT_CONFIG[type];
            return (
              <div key={type} className={`size-1.5 rounded-full ${config.bgTint.replace("/10", "")}`} />
            );
          })}
        </div>
      </div>

      {/* Event list — absolute positioned for smooth transitions */}
      <div
        className="feed-container px-2 max-md:px-0"
        style={{ "--feed-row-h": "46px", height: `calc(var(--feed-row-h) * ${visibleCount})` } as React.CSSProperties}
      >
        {items.map((item, i) => (
          <div
            key={item.uid}
            className={`feed-item ${item.uid === enteringUid ? "feed-item-enter" : ""}`}
            style={{
              transform: `translateY(calc(var(--feed-row-h) * ${i}))`,
              height: "var(--feed-row-h)",
            }}
          >
            <EventRow event={item.event} index={i} compact />
          </div>
        ))}
      </div>
    </div>

      {/* Paid messages stat */}
      {displayMessages > 0 && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-[#F7931A]/15 bg-[#F7931A]/[0.04] px-4 py-2.5">
          <svg className="size-4 text-[#F7931A]/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          <span className="text-[13px] text-white/50">
            <span className="font-semibold text-white tabular-nums">{displayMessages.toLocaleString()}</span> paid messages sent
            <span className="text-white/30"> &middot; </span>
            <span className="font-semibold text-[#F7931A]/70 tabular-nums">{displaySats.toLocaleString()}</span> <span className="text-white/40">sats</span>
          </span>
        </div>
      )}
    </Link>
  );
}
