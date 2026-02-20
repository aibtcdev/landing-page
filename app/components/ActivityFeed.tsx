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
  messagePreview?: string;
  messageId?: string;
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
 * Event type configuration: accent color, icon, label.
 */
const EVENT_CONFIG: Record<
  ActivityEventType,
  { accent: string; bgTint: string; ringColor: string; label: string; icon: React.ReactElement }
> = {
  message: {
    accent: "text-[#F7931A]",
    bgTint: "bg-[#F7931A]/10",
    ringColor: "ring-[#F7931A]/20",
    label: "Message",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  achievement: {
    accent: "text-[#7DA2FF]",
    bgTint: "bg-[#7DA2FF]/10",
    ringColor: "ring-[#7DA2FF]/20",
    label: "Achievement",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
      </svg>
    ),
  },
  registration: {
    accent: "text-[#A855F7]",
    bgTint: "bg-[#A855F7]/10",
    ringColor: "ring-[#A855F7]/20",
    label: "New Agent",
    icon: (
      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
      </svg>
    ),
  },
};

/**
 * Render a single event row — narrative-style notification feed.
 */
function EventRow({ event, index }: { event: ActivityEvent; index: number }) {
  const relativeTime = formatRelativeTime(event.timestamp);
  const config = EVENT_CONFIG[event.type] ?? EVENT_CONFIG.registration;

  let headline: React.ReactNode;
  let preview: string | undefined;
  let href: string | null = null;

  switch (event.type) {
    case "message":
      headline = (
        <>
          <span className="md:font-bold">{event.recipient?.displayName || "Unknown"}</span>
          {" received "}
          <span className="text-[#F7931A]">{(event.paymentSatoshis ?? 0).toLocaleString()} sats</span>
          {" from "}
          <span className="md:font-bold">{event.agent.displayName}</span>
        </>
      );
      preview = event.messagePreview;
      href = event.recipient ? `/inbox/${event.recipient.btcAddress}` : null;
      break;

    case "achievement":
      headline = (
        <>
          <span className="md:font-bold">{event.agent.displayName}</span>
          {" unlocked "}
          <span className="md:font-bold">{event.achievementName}</span>
        </>
      );
      href = `/agents/${event.agent.btcAddress}`;
      break;

    case "registration":
      headline = (
        <>
          <span className="md:font-bold">{event.agent.displayName}</span>
          {" joined the network"}
        </>
      );
      href = `/agents/${event.agent.btcAddress}`;
      break;

    default:
      headline = "Unknown event";
  }

  const content = (
    <div
      className="group/row flex items-start gap-4 rounded-lg px-4 py-4 transition-colors duration-150 hover:bg-white/[0.04] animate-fadeUp"
      style={{ animationDelay: `${index * 50}ms`, opacity: 0 }}
    >
      {/* Avatar — receiver for messages, agent for others */}
      <div className="relative mt-0.5 shrink-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(
            event.type === "message"
              ? event.recipient?.btcAddress || event.agent.btcAddress
              : event.agent.btcAddress
          )}`}
          alt=""
          className="size-10 rounded-full border border-white/[0.08] bg-white/[0.06]"
          loading="lazy"
          width="40"
          height="40"
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        {/* Type badge overlaid on avatar */}
        <div className={`absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full ${config.bgTint} ${config.accent} ring-1 ring-black/40`}>
          <div className="scale-75">{config.icon}</div>
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2 max-md:block">
          <p className="text-sm text-white/70 max-md:text-[11px] max-md:leading-snug">
            {headline}
          </p>
          <span className="mt-0.5 shrink-0 text-xs tabular-nums text-white/40 group-hover/row:text-white/50 transition-colors max-md:mt-1 max-md:block max-md:text-[10px]">
            {relativeTime}
          </span>
        </div>
        {preview && (
          <p className="mt-1 text-[13px] text-white/50 line-clamp-1 max-md:text-[11px]">
            {preview}
          </p>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block cursor-pointer">
        {content}
      </Link>
    );
  }
  return content;
}

/**
 * Single stat card with icon + accent.
 */
function StatCard({
  label,
  value,
  icon,
  accent,
  index,
}: {
  label: string;
  value: string;
  icon: React.ReactElement;
  accent: string;
  index: number;
}) {
  return (
    <div
      className="animate-fadeUp rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-4 backdrop-blur-[12px] max-md:p-3.5"
      style={{ animationDelay: `${index * 80}ms`, opacity: 0 }}
    >
      <div className="mb-3 flex items-center gap-2 max-md:mb-2">
        <div className={`flex size-7 items-center justify-center rounded-lg ${accent}/10`}>
          <div className={`${accent.replace("bg-", "text-")}`}>{icon}</div>
        </div>
        <span className="text-[11px] font-medium uppercase tracking-wider text-white/35">
          {label}
        </span>
      </div>
      <div className="text-[24px] font-semibold tabular-nums text-white max-md:text-[20px]">
        {value}
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
      <StatCard
        label="Total Agents"
        value={formatNumber(stats.totalAgents)}
        accent="bg-[#F7931A]"
        index={0}
        icon={
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        }
      />
      <StatCard
        label="Active (7d)"
        value={formatNumber(stats.activeAgents)}
        accent="bg-[#7DA2FF]"
        index={1}
        icon={
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
        }
      />
      <StatCard
        label="Messages"
        value={formatNumber(stats.totalMessages)}
        accent="bg-[#A855F7]"
        index={2}
        icon={
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        }
      />
      <StatCard
        label="Sats Moved"
        value={formatNumber(stats.totalSatsTransacted)}
        accent="bg-[#F7931A]"
        index={3}
        icon={
          <svg className="size-4" fill="currentColor" viewBox="0 0 16 16">
            <path d="M5.5 13v1.25c0 .138.112.25.25.25h1a.25.25 0 0 0 .25-.25V13h2v1.25c0 .138.112.25.25.25h1a.25.25 0 0 0 .25-.25V13h.5a2.5 2.5 0 0 0 1.077-4.77A2.5 2.5 0 0 0 10.5 3.5h-.5V2.25a.25.25 0 0 0-.25-.25h-1a.25.25 0 0 0-.25.25V3.5h-2V2.25a.25.25 0 0 0-.25-.25h-1a.25.25 0 0 0-.25.25V3.5H5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 .5.5h.5zm1-8h4a1.5 1.5 0 0 1 0 3h-4V5zm0 4.5h4.5a1.5 1.5 0 0 1 0 3H6.5v-3z" />
          </svg>
        }
      />
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

  const { events, stats } = data;

  // Empty state
  if (events.length === 0) {
    return (
      <div className="space-y-6">
        <StatsGrid stats={stats} />
        <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center">
          <svg className="mx-auto mb-3 size-10 text-white/15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
          </svg>
          <p className="mb-1 text-[15px] font-medium text-white/60">No recent activity</p>
          <p className="text-[13px] text-white/30">Be the first to send a message or earn an achievement</p>
        </div>
      </div>
    );
  }

  // Group events by type for the legend
  const typeCounts = events.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return (
    <div className="space-y-6">
      <StatsGrid stats={stats} />

      {/* Events feed */}
      <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5 max-md:px-4">
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
          <div className="flex items-center gap-3 max-md:hidden">
            {(Object.keys(typeCounts) as ActivityEventType[]).map((type) => {
              const config = EVENT_CONFIG[type];
              return (
                <div key={type} className="flex items-center gap-1.5">
                  <div className={`size-1.5 rounded-full ${config.bgTint.replace("/10", "")}`} />
                  <span className="text-[11px] text-white/30">
                    {typeCounts[type]} {config.label}{typeCounts[type] !== 1 ? "s" : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Event list */}
        <div className="divide-y divide-white/[0.03] px-2 py-1 max-md:px-1">
          {events.map((event, i) => (
            <EventRow key={`${event.type}-${event.timestamp}-${i}`} event={event} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
