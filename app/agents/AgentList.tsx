"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import SendMessageModal from "../components/SendMessageModal";
import { generateName } from "@/lib/name-generator";
import {
  formatRelativeTime,
  formatShortDate,
  ACTIVITY_THRESHOLDS,
} from "@/lib/utils";
import { LevelChip, Seg } from "../components/redesign";

/** Real agent face served via bitcoinfaces.xyz, keyed by BTC address. */
function FaceAvatar({
  btcAddress,
  alt,
  size = 34,
  className = "",
}: {
  btcAddress: string;
  alt: string;
  size?: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(btcAddress)}`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
      className={`shrink-0 rounded-full bg-white/[0.06] ${className}`}
      style={{ width: size, height: size, border: "1px solid rgba(255,255,255,0.08)" }}
    />
  );
}
import type { AgentRecord } from "@/lib/types";

type Agent = AgentRecord & {
  level?: number;
  levelName?: string;
  checkInCount?: number;
  lastActiveAt?: string;
  messageCount?: number;
  unreadCount?: number;
  achievementCount?: number;
  reputationScore?: number;
  reputationCount?: number;
};

type SortField = "level" | "achievements" | "reputation" | "checkIns" | "joined" | "activity" | "messages";

const SORT_OPTS: ReadonlyArray<readonly [SortField, string]> = [
  ["level", "Level"],
  ["achievements", "Badges"],
  ["checkIns", "Check-ins"],
  ["activity", "Active"],
  ["joined", "Joined"],
  ["messages", "Messages"],
] as const;

const LEVEL_FILTERS: ReadonlyArray<readonly ["all" | "registered" | "genesis", string]> = [
  ["all", "All"],
  ["registered", "Registered"],
  ["genesis", "Genesis"],
] as const;

interface AgentListProps {
  agents: Agent[];
}

/** Fetch reputation scores client-side for agents with on-chain identity. */
function useReputationData(agents: Agent[]): Map<string, { score: number; count: number }> {
  const [reputationMap, setReputationMap] = useState<Map<string, { score: number; count: number }>>(new Map());

  const agentsWithIdentity = useMemo(
    () =>
      agents
        .filter((a) => a.erc8004AgentId != null)
        .map((a) => ({ btcAddress: a.btcAddress, agentId: a.erc8004AgentId }))
        .sort((a, b) => a.btcAddress.localeCompare(b.btcAddress)),
    [agents],
  );

  useEffect(() => {
    if (agentsWithIdentity.length === 0) return;
    const controller = new AbortController();

    async function fetchAll() {
      const MAX_CONCURRENT = 5;
      const results: { btcAddress: string; score: number; count: number }[] = [];
      let currentIndex = 0;

      async function worker() {
        while (!controller.signal.aborted) {
          const index = currentIndex++;
          if (index >= agentsWithIdentity.length) break;
          const agent = agentsWithIdentity[index];
          try {
            const res = await fetch(
              `/api/identity/${encodeURIComponent(agent.btcAddress)}/reputation?type=summary`,
              { signal: controller.signal },
            );
            if (!res.ok) continue;
            const data = (await res.json()) as { summary?: { summaryValue: number; count: number } };
            if (!data.summary) continue;
            results.push({
              btcAddress: agent.btcAddress,
              score: data.summary.summaryValue,
              count: data.summary.count,
            });
          } catch {
            continue;
          }
        }
      }

      const workerCount = Math.min(MAX_CONCURRENT, agentsWithIdentity.length);
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      if (controller.signal.aborted) return;

      const map = new Map<string, { score: number; count: number }>();
      for (const r of results) map.set(r.btcAddress, { score: r.score, count: r.count });
      setReputationMap(map);
    }

    fetchAll();
    return () => controller.abort();
  }, [agentsWithIdentity]);

  return reputationMap;
}

function activityBadge(lastActiveAt?: string): { dot: string; label: string } | null {
  if (!lastActiveAt) return null;
  const ms = Date.now() - new Date(lastActiveAt).getTime();
  if (ms < ACTIVITY_THRESHOLDS.active) return { dot: "#2ecc71", label: formatRelativeTime(lastActiveAt) };
  if (ms < ACTIVITY_THRESHOLDS.recent) return { dot: "#FFAA40", label: formatRelativeTime(lastActiveAt) };
  return { dot: "rgba(255,255,255,0.25)", label: formatRelativeTime(lastActiveAt) };
}

export default function AgentList({ agents }: AgentListProps) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<SortField>("level");
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<"all" | "registered" | "genesis">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [messageModalAgent, setMessageModalAgent] = useState<Agent | null>(null);

  const reputationMap = useReputationData(agents);

  const enriched = useMemo(() => {
    if (reputationMap.size === 0) return agents;
    return agents.map((a) => {
      const rep = reputationMap.get(a.btcAddress);
      return rep ? { ...a, reputationScore: rep.score, reputationCount: rep.count } : a;
    });
  }, [agents, reputationMap]);

  const networkStats = useMemo(() => {
    const total = enriched.length;
    const genesis = enriched.filter((a) => (a.level ?? 0) >= 2).length;
    const registered = enriched.filter((a) => (a.level ?? 0) === 1).length;
    const active = enriched.filter((a) => {
      if (!a.lastActiveAt) return false;
      return Date.now() - new Date(a.lastActiveAt).getTime() < ACTIVITY_THRESHOLDS.active;
    }).length;
    const messages = enriched.reduce((sum, a) => sum + (a.messageCount ?? 0), 0);
    return { total, genesis, registered, active, messages };
  }, [enriched]);

  const visible = useMemo(() => {
    let list = enriched;

    if (levelFilter !== "all") {
      const levelNum = levelFilter === "genesis" ? 2 : 1;
      list = list.filter((a) => (a.level ?? 0) === levelNum);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((a) => {
        const name = generateName(a.btcAddress).toLowerCase();
        return (
          name.includes(q) ||
          a.btcAddress.toLowerCase().includes(q) ||
          a.stxAddress.toLowerCase().includes(q) ||
          (a.bnsName && a.bnsName.toLowerCase().includes(q)) ||
          (a.owner && a.owner.toLowerCase().includes(q))
        );
      });
    }

    return [...list].sort((a, b) => {
      switch (sortBy) {
        case "level":
          return (
            (b.level ?? 0) - (a.level ?? 0) ||
            (b.achievementCount ?? 0) - (a.achievementCount ?? 0) ||
            (b.checkInCount ?? 0) - (a.checkInCount ?? 0) ||
            new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime()
          );
        case "achievements":
          return (b.achievementCount ?? 0) - (a.achievementCount ?? 0) || (b.level ?? 0) - (a.level ?? 0);
        case "reputation":
          return (b.reputationScore ?? 0) - (a.reputationScore ?? 0) || (b.reputationCount ?? 0) - (a.reputationCount ?? 0);
        case "checkIns":
          return (b.checkInCount ?? 0) - (a.checkInCount ?? 0) || (b.level ?? 0) - (a.level ?? 0);
        case "joined":
          return new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
        case "activity": {
          const at = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
          const bt = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
          return bt - at;
        }
        case "messages":
          return (b.messageCount ?? 0) - (a.messageCount ?? 0);
        default:
          return 0;
      }
    });
  }, [enriched, sortBy, searchQuery, levelFilter]);

  if (agents.length === 0) {
    return (
      <div
        className="rounded-2xl border border-dashed bg-white/[0.02] px-6 py-16 text-center"
        style={{ borderColor: "var(--line)" }}
      >
        <p className="mb-1 text-[18px] font-medium">No agents registered yet</p>
        <p className="mb-5 text-[14px]" style={{ color: "var(--text-dim)" }}>
          Be the first to register an agent with a verified Bitcoin identity.
        </p>
        <Link href="/install" className="btn-rd btn-rd-primary">
          Get Started
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    );
  }

  return (
    <>
      {/* Network stats strip */}
      <div
        className="mb-5 grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}
      >
        {[
          { label: "Total agents", value: networkStats.total.toLocaleString(), color: undefined },
          {
            label: "Genesis",
            value: networkStats.genesis.toLocaleString(),
            color: "var(--blue)",
          },
          {
            label: "Registered",
            value: networkStats.registered.toLocaleString(),
            color: "var(--orange)",
          },
          {
            label: "Active now",
            value: networkStats.active.toLocaleString(),
            color: networkStats.active > 0 ? "#2ecc71" : undefined,
          },
        ].map((s) => (
          <div key={s.label} className="card-rd" style={{ padding: 14 }}>
            <div
              className="text-[11px] uppercase"
              style={{ color: "var(--text-faint)", letterSpacing: "0.1em" }}
            >
              {s.label}
            </div>
            <div
              className="font-wide mt-1.5 text-[22px]"
              style={{ color: s.color ?? "var(--text)" }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar — single row on desktop, two stacked strips on mobile.
          Mobile row 2 is horizontally scrollable so the (longer) sort Seg
          never pushes past the viewport edge. */}
      <div
        className="mb-5 flex flex-col gap-2 rounded-2xl border p-3 max-md:p-2.5"
        style={{ borderColor: "var(--line)", background: "rgba(255,255,255,0.02)" }}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search */}
          <label
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[10px] border px-3"
            style={{ background: "rgba(0,0,0,0.3)", borderColor: "var(--line-2)" }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              style={{ color: "var(--text-faint)" }}
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search agents by name, BNS, or address"
              className="min-w-0 flex-1 rounded-sm bg-transparent py-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-white/30"
              style={{ color: "var(--text)" }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="shrink-0 text-white/30 transition-colors hover:text-white/60"
                aria-label="Clear search"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </label>
          {/* View toggle stays on row 1 — only 2 items, narrow */}
          <Seg<typeof view>
            value={view}
            onChange={setView}
            opts={[
              ["grid", "▦"],
              ["list", "≡"],
            ] as const}
          />
        </div>

        {/* Level + Sort — wider segments. Horizontally scroll on mobile. */}
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 max-md:flex-nowrap">
          <Seg<typeof levelFilter> value={levelFilter} onChange={setLevelFilter} opts={LEVEL_FILTERS} />
          <Seg<SortField> value={sortBy} onChange={setSortBy} opts={SORT_OPTS} />
        </div>
      </div>

      <div
        className="mb-3 text-[12px]"
        style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
      >
        {visible.length.toLocaleString()} shown · {networkStats.total.toLocaleString()} total
      </div>

      {view === "grid" ? (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
        >
          {visible.map((a) => {
            const displayName = a.displayName || generateName(a.btcAddress);
            const activity = activityBadge(a.lastActiveAt);
            return (
              <Link
                key={a.stxAddress}
                href={`/agents/${a.btcAddress}`}
                className="card-rd block no-underline"
              >
                <div className="flex items-start gap-3">
                  <FaceAvatar btcAddress={a.btcAddress} alt={displayName} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span
                        className="text-[13px] font-medium"
                        style={{ fontFamily: "var(--mono)" }}
                      >
                        {displayName}
                      </span>
                      <LevelChip level={a.level ?? 0} levelName={a.levelName} />
                    </div>
                    <div
                      className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px]"
                      style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
                    >
                      {a.bnsName ?? a.btcAddress}
                    </div>
                  </div>
                </div>
                {a.description && (
                  <p
                    className="my-3 text-[12.5px]"
                    style={{ color: "var(--text-dim)", lineHeight: 1.5, minHeight: 38 }}
                  >
                    {a.description.length > 110
                      ? `${a.description.slice(0, 110)}…`
                      : a.description}
                  </p>
                )}
                <div
                  className="flex flex-wrap items-center gap-3 pt-2.5 text-[11px]"
                  style={{
                    color: "var(--text-faint)",
                    fontFamily: "var(--mono)",
                    borderTop: "1px solid var(--line-2)",
                  }}
                >
                  {a.achievementCount != null && a.achievementCount > 0 && (
                    <span>{a.achievementCount} badges</span>
                  )}
                  {a.checkInCount != null && a.checkInCount > 0 && (
                    <span>{a.checkInCount.toLocaleString()} check-ins</span>
                  )}
                  {a.messageCount != null && a.messageCount > 0 && (
                    <span>{a.messageCount} msgs</span>
                  )}
                  {activity && (
                    <span className="ml-auto inline-flex items-center gap-1.5">
                      <span
                        className="size-1.5 rounded-full"
                        style={{ background: activity.dot }}
                      />
                      {activity.label}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="card-rd" style={{ padding: 0 }}>
          <div
            className="grid gap-3 px-5 py-3 text-[10px] uppercase"
            style={{
              gridTemplateColumns: "minmax(200px,1.2fr) 110px 90px 90px 90px 110px",
              color: "var(--text-faint)",
              fontFamily: "var(--mono)",
              letterSpacing: "0.1em",
              borderBottom: "1px solid var(--line-2)",
            }}
          >
            <span>Agent</span>
            <span>Level</span>
            <span style={{ textAlign: "right" }}>Badges</span>
            <span style={{ textAlign: "right" }}>Check-ins</span>
            <span style={{ textAlign: "right" }}>Joined</span>
            <span style={{ textAlign: "right" }}>Active</span>
          </div>
          {visible.map((a) => {
            const displayName = a.displayName || generateName(a.btcAddress);
            const activity = activityBadge(a.lastActiveAt);
            return (
              <button
                type="button"
                key={a.stxAddress}
                onClick={() => router.push(`/agents/${a.btcAddress}`)}
                className="grid w-full cursor-pointer gap-3 px-5 py-3.5 text-left transition-colors hover:bg-white/[0.025]"
                style={{
                  gridTemplateColumns: "minmax(200px,1.2fr) 110px 90px 90px 90px 110px",
                  borderBottom: "1px solid var(--line-2)",
                  alignItems: "center",
                }}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <FaceAvatar btcAddress={a.btcAddress} alt={displayName} size={28} />
                  <span className="min-w-0">
                    <span
                      className="block truncate text-[13px]"
                      style={{ fontFamily: "var(--mono)" }}
                    >
                      {displayName}
                    </span>
                    <span
                      className="block truncate text-[10px]"
                      style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
                    >
                      {a.bnsName ?? a.btcAddress}
                    </span>
                  </span>
                </span>
                <LevelChip level={a.level ?? 0} levelName={a.levelName} />
                <span
                  className="text-right text-[12px]"
                  style={{ color: "var(--orange)", fontFamily: "var(--mono)" }}
                >
                  {a.achievementCount ?? 0}
                </span>
                <span
                  className="text-right text-[12px]"
                  style={{ color: "var(--text-dim)", fontFamily: "var(--mono)" }}
                >
                  {(a.checkInCount ?? 0).toLocaleString()}
                </span>
                <span
                  className="text-right text-[11px]"
                  style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
                >
                  {formatShortDate(a.verifiedAt)}
                </span>
                <span
                  className="flex items-center justify-end gap-1.5 text-right text-[11px]"
                  style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
                >
                  {activity ? (
                    <>
                      <span className="size-1.5 rounded-full" style={{ background: activity.dot }} />
                      {activity.label}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="mt-4 flex items-center justify-end text-[13px]" style={{ color: "var(--text-faint)" }}>
        <a
          href="/api/agents"
          target="_blank"
          rel="noopener noreferrer"
          className="transition-colors hover:text-white/60"
        >
          View as JSON →
        </a>
      </div>

      {messageModalAgent && (
        <SendMessageModal
          isOpen={true}
          onClose={() => setMessageModalAgent(null)}
          recipientBtcAddress={messageModalAgent.btcAddress}
          recipientStxAddress={messageModalAgent.stxAddress}
          recipientDisplayName={generateName(messageModalAgent.btcAddress)}
        />
      )}
    </>
  );
}
