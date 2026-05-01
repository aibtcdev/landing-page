import React from "react";
import Link from "next/link";
import { formatRelativeTime } from "@/lib/utils";

export type ActivityEventType = "message" | "achievement" | "registration";

export interface ActivityEvent {
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

export interface NetworkStats {
  totalAgents: number;
  activeAgents: number;
  totalMessages: number;
  totalSatsTransacted: number;
}

export interface ActivityResponse {
  events: ActivityEvent[];
  stats: NetworkStats;
}

export const EVENT_CONFIG: Record<
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

/* ----------------------------------------------------------------
 * Shared row helpers — clean Ticker aesthetic shared by both compact
 * (homepage feed) and detailed (/activity page) variants.
 * ---------------------------------------------------------------- */

interface RenderedEvent {
  /** The face avatar to show — recipient for messages, otherwise the actor. */
  avatarAddress: string;
  /** Action text: bold mono name + verb + orange target (no "sats" pill). */
  description: React.ReactNode;
  /** Optional sats pill rendered next to the timestamp on the right. */
  satsLabel?: string;
  /** Where the row links to. */
  href: string;
}

function renderEvent(event: ActivityEvent): RenderedEvent {
  switch (event.type) {
    case "message": {
      const sats =
        event.paymentSatoshis != null
          ? `+${event.paymentSatoshis.toLocaleString()} sats`
          : undefined;
      if (event.recipient) {
        return {
          avatarAddress: event.recipient.btcAddress,
          description: (
            <>
              <b className="font-mono font-medium text-white">{event.agent.displayName}</b>{" "}
              <span style={{ color: "var(--text-dim)" }}>messaged</span>{" "}
              <span style={{ color: "var(--orange)" }}>{event.recipient.displayName}</span>
            </>
          ),
          satsLabel: sats,
          href: `/inbox/${event.recipient.btcAddress}`,
        };
      }
      return {
        avatarAddress: event.agent.btcAddress,
        description: (
          <>
            <b className="font-mono font-medium text-white">{event.agent.displayName}</b>{" "}
            <span style={{ color: "var(--text-dim)" }}>sent a message</span>
          </>
        ),
        satsLabel: sats,
        href: `/agents/${event.agent.btcAddress}`,
      };
    }
    case "achievement":
      return {
        avatarAddress: event.agent.btcAddress,
        description: (
          <>
            <b className="font-mono font-medium text-white">{event.agent.displayName}</b>{" "}
            <span style={{ color: "var(--text-dim)" }}>earned</span>{" "}
            <span style={{ color: "var(--blue)" }}>{event.achievementName}</span>
          </>
        ),
        href: `/agents/${event.agent.btcAddress}`,
      };
    case "registration":
      return {
        avatarAddress: event.agent.btcAddress,
        description: (
          <>
            <b className="font-mono font-medium text-white">{event.agent.displayName}</b>{" "}
            <span style={{ color: "var(--text-dim)" }}>joined the registry</span>
          </>
        ),
        href: `/agents/${event.agent.btcAddress}`,
      };
  }
}

function ActivityFace({
  btcAddress,
  size,
}: {
  btcAddress: string;
  size: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(btcAddress)}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
      className="shrink-0 rounded-full bg-white/[0.06]"
      style={{ width: size, height: size, border: "1px solid rgba(255,255,255,0.08)" }}
    />
  );
}

/**
 * Compact event row for the homepage live-activity widget.
 * Tight ticker layout: 26px face + bold mono name + action + tiny time.
 */
export function CompactEventRow({ event }: { event: ActivityEvent }) {
  const r = renderEvent(event);
  return (
    <Link
      href={r.href}
      className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-white/[0.03]"
      onClick={(e) => e.stopPropagation()}
    >
      <ActivityFace btcAddress={r.avatarAddress} size={26} />
      <div className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">
        {r.description}
      </div>
      {r.satsLabel && (
        <span
          className="shrink-0 text-[11px] tabular-nums"
          style={{ color: "var(--orange)", opacity: 0.85 }}
        >
          {r.satsLabel}
        </span>
      )}
      <span
        className="shrink-0 text-[11px] tabular-nums"
        style={{ color: "var(--text-faint)" }}
      >
        {formatRelativeTime(event.timestamp)}
      </span>
    </Link>
  );
}

/**
 * Detailed event row for the /activity page — same clean Ticker style
 * as CompactEventRow but with a larger face, optional message preview
 * line below, and a timestamp on the right.
 */
export function DetailedEventRow({ event }: { event: ActivityEvent }) {
  const r = renderEvent(event);
  return (
    <Link
      href={r.href}
      className="flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-white/[0.03] max-md:gap-2.5 max-md:px-3 max-md:py-2.5"
    >
      <ActivityFace btcAddress={r.avatarAddress} size={32} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] leading-tight max-md:text-[12.5px]">
          {r.description}
        </div>
        {event.messagePreview && (
          <div
            className="mt-1 truncate text-[12px] max-md:hidden"
            style={{ color: "var(--text-faint)" }}
          >
            {event.messagePreview}
          </div>
        )}
      </div>
      {r.satsLabel && (
        <span
          className="shrink-0 text-[11px]"
          style={{ color: "var(--orange)", opacity: 0.85 }}
        >
          {r.satsLabel}
        </span>
      )}
      <span
        className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums"
        style={{ color: "var(--text-faint)" }}
      >
        {formatRelativeTime(event.timestamp)}
      </span>
    </Link>
  );
}

export function StatCard({
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
      className="animate-fadeUp rounded-lg border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] px-3 py-2.5 backdrop-blur-[12px]"
      style={{ animationDelay: `${index * 80}ms`, opacity: 0 }}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        <div className={`flex size-5 items-center justify-center rounded ${accent}/10`}>
          <div className={`${accent.replace("bg-", "text-")} [&>svg]:size-3`}>{icon}</div>
        </div>
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/35">
          {label}
        </span>
      </div>
      <div className="text-[18px] font-semibold tabular-nums text-white leading-tight">
        {value}
      </div>
    </div>
  );
}

export function StatsGrid({ stats }: { stats: NetworkStats }) {
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
      <StatCard
        label="Total Agents"
        value={stats.totalAgents.toLocaleString()}
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
        value={stats.activeAgents.toLocaleString()}
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
        value={stats.totalMessages.toLocaleString()}
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
        value={stats.totalSatsTransacted.toLocaleString()}
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
