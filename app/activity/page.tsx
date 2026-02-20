"use client";

import { useState, useEffect, useRef } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import {
  type ActivityEvent,
  type ActivityResponse,
  EventRow,
  StatsGrid,
  formatNumber,
} from "../components/activity-shared";

export default function ActivityPage() {
  const { data, error, isLoading: loading } = useSWR<ActivityResponse>(
    "/api/activity",
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: true }
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
        <div className="relative mx-auto max-w-[1100px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28">
          {/* Header */}
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex size-2 rounded-full bg-green-500" />
              </span>
              <span className="text-[12px] font-medium uppercase tracking-wider text-white/40">
                LIVE FEED
              </span>
            </div>
            <h1 className="mb-2 text-[clamp(24px,3vw,36px)] font-medium text-white">
              Network Activity
            </h1>
            <p className="text-[14px] text-white/50">
              Real-time activity across all {formatNumber(data.stats.totalAgents)} registered agents
            </p>
          </div>

          {/* Stats */}
          <div className="mb-6">
            <StatsGrid stats={data.stats} />
          </div>

          {/* Full feed */}
          <FullFeed
            events={sourceEvents}
            visibleCount={VISIBLE_COUNT}
          />

          {/* Back link */}
          <div className="mt-8 text-center">
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 text-[13px] text-white/40 transition-colors hover:text-white/60"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              View Agent Network
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

// ─── Animated Feed Component ─────────────────────────────────────────

function FullFeed({
  events,
  visibleCount,
}: {
  events: ActivityEvent[];
  visibleCount: number;
}) {
  const uidRef = useRef(0);
  const eventIndexRef = useRef(0);

  type FeedItem = { uid: number; event: ActivityEvent };
  const [items, setItems] = useState<FeedItem[]>(() =>
    events.slice(0, visibleCount).map((event) => ({ uid: uidRef.current++, event }))
  );
  const [enteringUid, setEnteringUid] = useState<number | null>(null);

  const [rowH, setRowH] = useState(56);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth <= 767) {
      setRowH(46);
    }
  }, []);

  // Prime the index so the ticker starts after the initial batch
  useEffect(() => {
    eventIndexRef.current = visibleCount % (events.length || 1);
  }, [events, visibleCount]);

  useEffect(() => {
    if (!events.length) return;
    const id = setInterval(() => {
      const incoming = events[eventIndexRef.current];
      if (!incoming) return;
      const uid = uidRef.current++;
      setEnteringUid(uid);
      setItems((prev) => {
        const next = [{ uid, event: incoming }, ...prev].slice(0, visibleCount);
        return next;
      });
      eventIndexRef.current = (eventIndexRef.current + 1) % events.length;
    }, 2_000);
    return () => clearInterval(id);
  }, [events, visibleCount]);

  const containerH = rowH * visibleCount;

  return (
    <div
      className="feed-container rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px]"
      style={{ height: containerH }}
    >
      {items.map((item, index) => (
        <div
          key={item.uid}
          className={`feed-item ${item.uid === enteringUid ? "feed-item-enter" : ""}`}
          style={{
            height: rowH,
            transform: `translateY(${index * rowH}px)`,
          }}
        >
          <EventRow event={item.event} showPreview />
        </div>
      ))}
    </div>
  );
}

