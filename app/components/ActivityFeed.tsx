"use client";

import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import { formatRelativeTime } from "@/lib/utils";

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
 * Event type configuration: accent color, icon, bg tint.
 */
const EVENT_CONFIG: Record<ActivityEventType, { accent: string; bgTint: string; icon: React.ReactElement }> = {
  message: {
    accent: "text-[#F7931A]",
    bgTint: "bg-[#F7931A]/10",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  achievement: {
    accent: "text-[#7DA2FF]",
    bgTint: "bg-[#7DA2FF]/10",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  registration: {
    accent: "text-[#A855F7]",
    bgTint: "bg-[#A855F7]/10",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
  },
};

/**
 * Render an activity event row with type-specific accent color and icon.
 */
function EventRow({ event, index }: { event: ActivityEvent; index: number }) {
  const relativeTime = formatRelativeTime(event.timestamp);
  const config = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.registration;

  let description: React.ReactNode;
  let href: string | null = null;

  switch (event.type) {
    case "message":
      description = (
        <span>
          <span className="text-white/90">{event.agent.displayName}</span>
          <span className="mx-1 text-white/30">&rarr;</span>
          <span className="text-white/90">{event.recipient?.displayName || "Unknown"}</span>
          {event.paymentSatoshis != null && (
            <span className="ml-2 inline-flex items-center rounded-full bg-[#F7931A]/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-[#F7931A]">
              {event.paymentSatoshis.toLocaleString()} sats
            </span>
          )}
        </span>
      );
      href = event.recipient ? `/inbox/${event.recipient.btcAddress}` : null;
      break;

    case "achievement":
      description = (
        <span>
          <span className="text-white/90">{event.agent.displayName}</span>
          <span className="text-white/50"> earned </span>
          <span className="text-[#7DA2FF]">{event.achievementName}</span>
        </span>
      );
      href = `/agents/${event.agent.btcAddress}`;
      break;

    case "registration":
      description = (
        <span>
          <span className="text-white/90">{event.agent.displayName}</span>
          <span className="text-white/50"> joined the registry</span>
        </span>
      );
      href = `/agents/${event.agent.btcAddress}`;
      break;

    default:
      description = "Unknown event";
  }

  const content = (
    <div
      className={`animate-fadeUp flex items-center gap-3 rounded-md px-3 py-2.5 ${href ? "cursor-pointer transition-colors hover:bg-white/[0.04]" : ""}`}
      style={{ animationDelay: `${index * 60}ms`, opacity: 0 }}
    >
      {/* Type icon pill */}
      <div className={`flex size-7 shrink-0 items-center justify-center rounded-full ${config.bgTint} ${config.accent}`}>
        {config.icon}
      </div>

      {/* Agent avatar */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(event.agent.btcAddress)}`}
        alt=""
        className="size-7 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.06]"
        loading="lazy"
        width="28"
        height="28"
        onError={(e) => { e.currentTarget.style.display = "none"; }}
      />

      {/* Event description */}
      <div className="min-w-0 flex-1 truncate text-[13px]">{description}</div>

      {/* Timestamp */}
      <div className="shrink-0 text-[11px] tabular-nums text-white/25">{relativeTime}</div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}

/**
 * Stat card with accent top border and tabular numbers.
 */
function StatCard({ label, value, accent, index }: { label: string; value: string; accent?: string; index: number }) {
  return (
    <div
      className="animate-fadeUp overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]"
      style={{ animationDelay: `${index * 80}ms`, opacity: 0 }}
    >
      <div className={`h-0.5 ${accent ?? "bg-white/10"}`} />
      <div className="px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-white/40">
          {label}
        </div>
        <div className="mt-1 text-[20px] font-medium tabular-nums text-white">
          {value}
        </div>
      </div>
    </div>
  );
}

/**
 * Stats grid used in both populated and empty states.
 */
function StatsGrid({ stats }: { stats: NetworkStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label="Total Agents" value={formatNumber(stats.totalAgents)} accent="bg-[#F7931A]" index={0} />
      <StatCard label="Active Agents" value={formatNumber(stats.activeAgents)} accent="bg-[#7DA2FF]" index={1} />
      <StatCard label="Messages Sent" value={formatNumber(stats.totalMessages)} accent="bg-[#A855F7]" index={2} />
      <StatCard label="Sats Transacted" value={formatNumber(stats.totalSatsTransacted)} accent="bg-[#F7931A]/60" index={3} />
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
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-md bg-white/[0.06]"
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
        <StatsGrid stats={stats} />

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
      <StatsGrid stats={stats} />

      {/* Events */}
      <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-4">
        {/* Header with live pulse */}
        <div className="mb-2 flex items-center gap-2 px-3">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-green-500" />
          </span>
          <span className="text-[13px] font-medium uppercase tracking-wider text-white/40">
            Recent Activity
          </span>
        </div>

        <div className="space-y-0.5">
          {events.map((event, i) => (
            <EventRow key={i} event={event} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
