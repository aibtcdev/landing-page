"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import {
  type ActivityEvent,
  type ActivityResponse,
  type NetworkStats,
  EVENT_CONFIG,
  CompactEventRow,
} from "./activity-shared";

/**
 * Activity feed component for homepage.
 *
 * Accepts optional `initialData` from the server-rendered page for
 * zero-skeleton first paint. SWR uses it as fallbackData and revalidates
 * in the background every 30s.
 *
 * Displays:
 * - Recent event feed (messages, achievements, registrations)
 * - Paid messages stat bar that counts up to the real total
 *
 * The feed starts ~40 events behind the present and drips them in
 * chronologically. Once caught up, it waits for real new events via
 * SWR polling (30s). Stats count up from a starting point and converge
 * on the real API totals when the queue is exhausted.
 */
export default function ActivityFeed({ initialData }: { initialData?: ActivityResponse }) {
  const { data, error, isLoading: loading } = useSWR<ActivityResponse>(
    "/api/activity",
    fetcher,
    { refreshInterval: 30_000, fallbackData: initialData }
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
        {/* Events skeleton */}
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="mb-4 h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-2"
              >
                <div className="size-8 animate-pulse rounded-full bg-white/[0.06]" />
                <div className="h-4 flex-1 animate-pulse rounded bg-white/[0.06]" />
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

/** Composite key for deduplicating events */
function makeEventKey(e: ActivityEvent): string {
  return `${e.type}:${e.timestamp}:${e.agent.btcAddress}`;
}

/** Count messages, sats, and registrations in a list of events */
function countQueuedStats(events: ActivityEvent[]): { messages: number; sats: number; registrations: number } {
  let messages = 0;
  let sats = 0;
  let registrations = 0;
  for (const e of events) {
    if (e.type === "message") {
      messages++;
      sats += e.paymentSatoshis ?? 0;
    } else if (e.type === "registration") {
      registrations++;
    }
  }
  return { messages, sats, registrations };
}

/**
 * Queue-based live feed — starts far behind the present and drips events
 * in chronologically. Stats count up from a starting point and converge
 * on the real API totals when the queue empties. After catching up,
 * waits for genuinely new events via SWR polling.
 */
function LiveFeed({ events, visibleCount, stats }: { events: ActivityEvent[]; visibleCount: number; stats: NetworkStats }) {
  const uidRef = useRef(0);
  const queueRef = useRef<ActivityEvent[]>([]);
  const knownKeysRef = useRef<Set<string>>(new Set());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [enteringUid, setEnteringUid] = useState<number | null>(null);

  // Compute initial queue once. Recompute on every render is fine (cheap)
  // and avoids the strict-mode double-init pitfall where `useState`
  // initializers run twice — leaving a "consumed" ref state that crashes.
  const initialChrono = [...events].reverse(); // oldest → newest
  const initialQueue = initialChrono.slice(visibleCount);

  // Track how many messages/sats/registrations are still in the queue (for counting up)
  const [queuedStats, setQueuedStats] = useState(() => countQueuedStats(initialQueue));

  // Initialize: fill visible rows from the oldest events, queue the rest
  const [items, setItems] = useState(() => {
    queueRef.current = initialQueue.slice();
    knownKeysRef.current = new Set(events.map(makeEventKey));
    const initial = initialChrono.slice(0, visibleCount);
    // Display newest-on-top within the initial batch
    return initial.reverse().map((event) => ({
      uid: uidRef.current++,
      event,
    }));
  });

  // Drip one event from the queue into the feed
  const drip = useCallback(() => {
    const next = queueRef.current.shift();
    if (!next) return;

    // Update queued stats (decrement)
    if (next.type === "message") {
      setQueuedStats((prev) => ({
        ...prev,
        messages: prev.messages - 1,
        sats: prev.sats - (next.paymentSatoshis ?? 0),
      }));
    } else if (next.type === "registration") {
      setQueuedStats((prev) => ({
        ...prev,
        registrations: prev.registrations - 1,
      }));
    }

    const newUid = uidRef.current++;
    setEnteringUid(newUid);
    setItems((prev) => [
      { uid: newUid, event: next },
      ...prev.slice(0, visibleCount),
    ]);
  }, [visibleCount]);

  // Start/restart the drip interval when there are queued items
  const ensureInterval = useCallback(() => {
    if (intervalRef.current) return;
    if (!queueRef.current || queueRef.current.length === 0) return;

    intervalRef.current = setInterval(() => {
      if (!queueRef.current || queueRef.current.length === 0) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
        return;
      }
      drip();
    }, 2400);
  }, [drip]);

  // Start dripping on mount
  useEffect(() => {
    ensureInterval();
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [ensureInterval]);

  // When SWR revalidates with new events, queue any we haven't seen
  useEffect(() => {
    if (!queueRef.current) queueRef.current = [];
    let addedMessages = 0;
    let addedSats = 0;
    let addedRegistrations = 0;
    for (const event of events) {
      const key = makeEventKey(event);
      if (!knownKeysRef.current.has(key)) {
        knownKeysRef.current.add(key);
        queueRef.current.push(event);
        if (event.type === "message") {
          addedMessages++;
          addedSats += event.paymentSatoshis ?? 0;
        } else if (event.type === "registration") {
          addedRegistrations++;
        }
      }
    }
    if (addedMessages > 0 || addedRegistrations > 0) {
      setQueuedStats((prev) => ({
        messages: prev.messages + addedMessages,
        sats: prev.sats + addedSats,
        registrations: prev.registrations + addedRegistrations,
      }));
    }
    if (addedMessages > 0 || addedRegistrations > 0 || queueRef.current.length > 0) ensureInterval();
  }, [events, ensureInterval]);

  // Also kick the interval on initial mount (the items state initializer
  // populated queueRef but no [events] change has fired yet on first render).
  useEffect(() => {
    ensureInterval();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Clear entering animation after transition
  useEffect(() => {
    if (enteringUid !== null) {
      const t = setTimeout(() => setEnteringUid(null), 2300);
      return () => clearTimeout(t);
    }
  }, [enteringUid]);

  // Stats count up: real total minus what's still queued
  const displayMessages = stats.totalMessages - queuedStats.messages;
  const displaySats = stats.totalSatsTransacted - queuedStats.sats;

  return (
    <div
      className="overflow-hidden rounded-2xl border transition-colors duration-200 hover:border-white/15"
      style={{
        borderColor: "var(--line)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      {/* Header — slim mono strip with type-dots + "View all" */}
      <div
        className="flex items-center justify-between px-4 py-2.5 text-[11.5px]"
        style={{
          borderBottom: "1px solid var(--line-2)",
          fontFamily: "var(--mono)",
          color: "var(--text-dim)",
        }}
      >
        <span className="inline-flex items-center gap-2">
          <span className="status-dot" />
          Recent activity
        </span>
        <span className="inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            {(["message", "achievement", "registration"] as const).map((type) => {
              const dot =
                type === "message"
                  ? "var(--orange)"
                  : type === "achievement"
                    ? "var(--blue)"
                    : "#2ecc71";
              return (
                <span
                  key={type}
                  className="size-1.5 rounded-full"
                  style={{ background: dot }}
                />
              );
            })}
          </span>
          <Link
            href="/activity"
            className="text-[10.5px] transition-colors hover:text-[#F7931A]"
            style={{ color: "rgba(247,147,26,0.7)" }}
          >
            View all →
          </Link>
        </span>
      </div>

      {/* Event list — absolute positioned for smooth transitions */}
      <div
        className="feed-container max-md:[--feed-row-h:42px]"
        style={
          {
            "--feed-row-h": "46px",
            height: `calc(var(--feed-row-h) * ${visibleCount})`,
          } as React.CSSProperties
        }
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
            <CompactEventRow event={item.event} />
          </div>
        ))}
      </div>

      {/* Footer counter — converged on the real totals as events drip in */}
      {displayMessages > 0 && (
        <div
          className="flex items-center justify-between px-4 py-2.5 text-[11px]"
          style={{
            borderTop: "1px solid var(--line-2)",
            fontFamily: "var(--mono)",
            color: "var(--text-faint)",
          }}
        >
          <span>
            <span style={{ color: "var(--text)" }}>
              {displayMessages.toLocaleString()}
            </span>{" "}
            paid messages
          </span>
          <span style={{ color: "var(--orange)" }}>
            {displaySats.toLocaleString()} sats
          </span>
        </div>
      )}
    </div>
  );
}
