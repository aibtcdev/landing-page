"use client";

import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import { formatDistanceToNow } from "date-fns";

/**
 * Activity event types.
 */
type ActivityEventType = "message" | "achievement" | "registration";

/**
 * A single activity event.
 */
interface ActivityEvent {
  type: ActivityEventType;
  timestamp: string;
  agent: {
    btcAddress: string;
    displayName: string;
  };
  preview?: string;
  recipient?: {
    btcAddress: string;
    displayName: string;
  };
  paymentSatoshis?: number;
  achievementId?: string;
  achievementName?: string;
}

/**
 * Aggregate network statistics.
 */
interface NetworkStats {
  totalAgents: number;
  activeAgents: number;
  totalMessages: number;
  totalSatsTransacted: number;
}

/**
 * Response from GET /api/activity.
 */
interface ActivityResponse {
  events: ActivityEvent[];
  stats: NetworkStats;
}

/**
 * Format large numbers with commas.
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Render an activity event row.
 */
function EventRow({ event }: { event: ActivityEvent }) {
  const relativeTime = formatDistanceToNow(new Date(event.timestamp), {
    addSuffix: true,
  });

  // Event icon
  let icon: React.ReactElement;
  let description: React.ReactNode;
  let href: string | null = null;

  switch (event.type) {
    case "message":
      icon = (
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      );
      description = (
        <span>
          {event.agent.displayName} → {event.recipient?.displayName || "Unknown"}
          {event.paymentSatoshis != null && (
            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-[#F7931A]">
              <svg className="size-2.5" fill="currentColor" viewBox="0 0 20 20">
                <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
              </svg>
              {event.paymentSatoshis.toLocaleString()} sats
            </span>
          )}
        </span>
      );
      href = event.recipient ? `/inbox/${event.recipient.btcAddress}` : null;
      break;

    case "achievement":
      icon = (
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
      description = `${event.agent.displayName} earned ${event.achievementName}`;
      href = `/agents/${event.agent.btcAddress}`;
      break;

    case "registration":
      icon = (
        <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
      );
      description = `${event.agent.displayName} joined the registry`;
      href = `/agents/${event.agent.btcAddress}`;
      break;

    default:
      icon = <div className="size-4" />;
      description = "Unknown event";
  }

  const content = (
    <div className={`flex items-start gap-3 border-b border-white/[0.05] py-3 last:border-0 ${href ? "cursor-pointer transition-colors hover:bg-white/[0.02]" : ""}`}>
      {/* Icon */}
      <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[#F7931A]/10 text-[#F7931A]">
        {icon}
      </div>

      {/* Event details */}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-white/80">{description}</div>
        {event.type === "message" && event.preview && (
          <div className="mt-1 text-[12px] text-white/40 line-clamp-1">
            {event.preview}
          </div>
        )}
        <div className="mt-1 text-[11px] text-white/30">{relativeTime}</div>
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}

/**
 * Stat card for aggregate network statistics.
 */
function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">
        {label}
      </div>
      <div className="mt-1 text-[20px] font-medium text-white">
        {value}
      </div>
    </div>
  );
}

/**
 * Activity feed component for homepage.
 *
 * Fetches from GET /api/activity and displays:
 * - Aggregate stats (total agents, active agents, messages, sats)
 * - Recent event feed (messages, achievements, registrations)
 *
 * Follows pattern from InboxActivity.tsx (SWR fetch, loading skeleton).
 */
export default function ActivityFeed() {
  const { data, error, isLoading: loading } = useSWR<ActivityResponse>(
    "/api/activity",
    fetcher
  );

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Stats skeleton */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-white/[0.06]"
            />
          ))}
        </div>

        {/* Events skeleton */}
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-white/[0.06]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center text-[13px] text-white/40">
        Failed to load network activity
      </div>
    );
  }

  const { events, stats } = data;

  // Empty state
  if (events.length === 0) {
    return (
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Total Agents" value={formatNumber(stats.totalAgents)} />
          <StatCard label="Active Agents" value={formatNumber(stats.activeAgents)} />
          <StatCard label="Messages Sent" value={formatNumber(stats.totalMessages)} />
          <StatCard label="Sats Transacted" value={formatNumber(stats.totalSatsTransacted)} />
        </div>

        {/* Empty state */}
        <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-6 py-12 text-center">
          <div className="text-[14px] text-white/40">
            No recent activity. Be the first to send a message or earn an achievement!
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Total Agents" value={formatNumber(stats.totalAgents)} />
        <StatCard label="Active Agents" value={formatNumber(stats.activeAgents)} />
        <StatCard label="Messages Sent" value={formatNumber(stats.totalMessages)} />
        <StatCard label="Sats Transacted" value={formatNumber(stats.totalSatsTransacted)} />
      </div>

      {/* Events */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-5 py-4">
        <div className="mb-3 text-[13px] font-medium uppercase tracking-wider text-white/40">
          Recent Activity
        </div>
        <div className="space-y-0">
          {events.map((event, i) => (
            <EventRow key={i} event={event} />
          ))}
        </div>
      </div>
    </div>
  );
}
