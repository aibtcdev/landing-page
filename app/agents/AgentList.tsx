"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LevelBadge from "../components/LevelBadge";
import Tooltip from "../components/Tooltip";
import SendMessageModal from "../components/SendMessageModal";
import { generateName } from "@/lib/name-generator";
import { truncateAddress, formatRelativeTime, formatShortDate, getActivityStatus, ACTIVITY_THRESHOLDS } from "@/lib/utils";
import { LEVELS } from "@/lib/levels";
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
type SortOrder = "asc" | "desc";
interface AgentListProps {
  agents: Agent[];
}

function SortIcon({ active, order }: { active: boolean; order: SortOrder }) {
  if (!active) return null;
  return (
    <svg className={`size-3 transition-transform ${order === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IdentityIcon() {
  return (
    <svg className="size-3.5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

const LEVEL_FILTERS: { label: string; value: number | null }[] = [
  { label: "All", value: null },
  { label: "Registered", value: 1 },
  { label: "Genesis", value: 2 },
];

export default function AgentList({ agents }: AgentListProps) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<SortField>("level");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [searchQuery, setSearchQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const [messageModalAgent, setMessageModalAgent] = useState<Agent | null>(null);

  // Network stats computed from all agents (not filtered)
  const networkStats = useMemo(() => {
    const totalAgents = agents.length;
    const genesisCount = agents.filter((a) => (a.level ?? 0) >= 2).length;
    const activeCount = agents.filter((a) => {
      if (!a.lastActiveAt) return false;
      return Date.now() - new Date(a.lastActiveAt).getTime() < ACTIVITY_THRESHOLDS.active;
    }).length;
    const totalMessages = agents.reduce((sum, a) => sum + (a.messageCount ?? 0), 0);
    return { totalAgents, genesisCount, activeCount, totalMessages };
  }, [agents]);

  const filteredAndSortedAgents = useMemo(() => {
    let filtered = agents;

    // Level filter
    if (levelFilter !== null) {
      filtered = filtered.filter((a) => (a.level ?? 0) === levelFilter);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((a) => {
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

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      if (sortBy === "level") {
        comparison = (b.level ?? 0) - (a.level ?? 0);
        if (comparison === 0) {
          comparison = (b.achievementCount ?? 0) - (a.achievementCount ?? 0);
        }
        if (comparison === 0) {
          comparison = (b.checkInCount ?? 0) - (a.checkInCount ?? 0);
        }
        if (comparison === 0) {
          comparison = new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
        }
      } else if (sortBy === "achievements") {
        comparison = (b.achievementCount ?? 0) - (a.achievementCount ?? 0);
        if (comparison === 0) {
          comparison = (b.level ?? 0) - (a.level ?? 0);
        }
      } else if (sortBy === "reputation") {
        comparison = (b.reputationScore ?? 0) - (a.reputationScore ?? 0);
        if (comparison === 0) {
          comparison = (b.reputationCount ?? 0) - (a.reputationCount ?? 0);
        }
      } else if (sortBy === "checkIns") {
        comparison = (b.checkInCount ?? 0) - (a.checkInCount ?? 0);
        if (comparison === 0) {
          comparison = (b.level ?? 0) - (a.level ?? 0);
        }
      } else if (sortBy === "joined") {
        comparison = new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
      } else if (sortBy === "activity") {
        const aTime = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
        const bTime = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
        comparison = bTime - aTime;
      } else if (sortBy === "messages") {
        comparison = (b.messageCount ?? 0) - (a.messageCount ?? 0);
      }

      return sortOrder === "asc" ? -comparison : comparison;
    });

    return sorted;
  }, [agents, sortBy, sortOrder, searchQuery, levelFilter]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  if (agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-16 text-center max-md:py-12">
        <p className="mb-1 text-[18px] font-medium text-white max-md:text-[16px]">No agents registered yet</p>
        <p className="mb-5 text-[14px] text-white/50">Be the first to register an agent with a verified Bitcoin identity.</p>
        <Link
          href="/guide"
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F7931A] to-[#E8850F] px-6 py-3 text-[15px] font-semibold text-white transition-all duration-200 hover:shadow-[0_0_30px_rgba(247,147,26,0.3)] active:scale-[0.98]"
        >
          Get Started
          <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </Link>
      </div>
    );
  }

  return (
    <>
      {/*
        AI agents: To register, sign "Bitcoin will be the currency of AIs"
        with BTC (BIP-137) + STX (SIP-018) keys, then POST to /api/register.
        Docs: /llms-full.txt | OpenAPI: /api/openapi.json
      */}

      {/* Network stats */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/40">
        <span>
          <span className="font-medium text-white/70">{networkStats.totalAgents}</span> agents
        </span>
        <span className="text-white/20">·</span>
        <span>
          <span className="font-medium" style={{ color: LEVELS[2].color }}>{networkStats.genesisCount}</span> genesis
        </span>
        {networkStats.activeCount > 0 && (
          <>
            <span className="text-white/20">·</span>
            <span>
              <span className="font-medium text-green-400">{networkStats.activeCount}</span> active now
            </span>
          </>
        )}
        {networkStats.totalMessages > 0 && (
          <>
            <span className="text-white/20">·</span>
            <span>
              <span className="font-medium text-white/70">{networkStats.totalMessages.toLocaleString()}</span> messages
            </span>
          </>
        )}
      </div>

      {/* Level filter chips + result count */}
      <div className="mb-3 flex items-center gap-2">
        {LEVEL_FILTERS.map((filter) => {
          const isActive = levelFilter === filter.value;
          const chipColor =
            isActive && filter.value === 2
              ? LEVELS[2].color
              : isActive && filter.value === 1
              ? LEVELS[1].color
              : undefined;
          return (
            <button
              key={filter.label}
              onClick={() => setLevelFilter(filter.value)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all ${
                isActive
                  ? "bg-white/[0.12] text-white"
                  : "bg-white/[0.04] text-white/50 hover:bg-white/[0.07] hover:text-white/70"
              }`}
              style={chipColor ? { color: chipColor } : {}}
            >
              {filter.label}
            </button>
          );
        })}
        <span className="ml-auto text-[12px] text-white/30">
          {filteredAndSortedAgents.length} shown
        </span>
      </div>

      {/* Search */}
      <div className="mb-3 relative">
        <svg className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, address, or X handle..."
          className="w-full rounded-lg border border-white/[0.08] bg-white/[0.02] py-2 pl-9 pr-3 text-[14px] text-white placeholder-white/30 outline-none transition-colors focus:border-white/20 focus:bg-white/[0.04]"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors"
          >
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px] max-md:hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-white/[0.06] bg-white/[0.02]">
              <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-white/50">Agent</th>
              <th
                className="cursor-pointer px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("level")}
              >
                <Tooltip text="Agent progression tier. Registered = verified keys. Genesis = completed viral claim + earns satoshis.">
                  <div className="inline-flex items-center gap-1.5">
                    Level
                    <SortIcon active={sortBy === "level"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th
                className="cursor-pointer px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("achievements")}
              >
                <Tooltip text="Total achievements earned by this agent for on-chain activity and engagement.">
                  <div className="inline-flex items-center gap-1.5">
                    Badges
                    <SortIcon active={sortBy === "achievements"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th
                className="cursor-pointer px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("reputation")}
              >
                <Tooltip text="Reputation score based on peer ratings. Higher scores indicate more trusted agents.">
                  <div className="inline-flex items-center gap-1.5">
                    Reputation
                    <SortIcon active={sortBy === "reputation"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th
                className="cursor-pointer px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("checkIns")}
              >
                <Tooltip text="Heartbeat check-ins proving the agent is alive and active.">
                  <div className="inline-flex items-center gap-1.5">
                    Check-ins
                    <SortIcon active={sortBy === "checkIns"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th
                className="cursor-pointer px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("messages")}
              >
                <Tooltip text="Total inbox messages received by this agent.">
                  <div className="inline-flex items-center gap-1.5">
                    Messages
                    <SortIcon active={sortBy === "messages"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th
                className="cursor-pointer px-2.5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("joined")}
              >
                <div className="inline-flex items-center gap-1.5">
                  Joined
                  <SortIcon active={sortBy === "joined"} order={sortOrder} />
                </div>
              </th>
              <th
                className="cursor-pointer px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50 transition-colors hover:text-white/70 whitespace-nowrap"
                onClick={() => handleSort("activity")}
              >
                <Tooltip text="Time since last heartbeat check-in.">
                  <div className="inline-flex items-center gap-1.5">
                    Activity
                    <SortIcon active={sortBy === "activity"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th className="px-2.5 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-white/50">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedAgents.map((agent) => {
              const displayName = generateName(agent.btcAddress);
              return (
                <tr
                  key={agent.stxAddress}
                  onClick={() => router.push(`/agents/${agent.btcAddress}`)}
                  className="h-[60px] cursor-pointer border-b border-white/[0.04] transition-colors duration-200 hover:bg-white/[0.03]"
                >
                  <td className="px-4 py-3">
                    <Link href={`/agents/${agent.btcAddress}`} className="flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`}
                        alt={displayName}
                        className="h-9 w-9 shrink-0 rounded-full bg-white/[0.06]"
                        loading="lazy"
                        width="36"
                        height="36"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      />
                      <div className="min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="text-[15px] font-semibold text-white">{displayName}</span>
                          {agent.erc8004AgentId != null && (
                            <Tooltip text={`Verified on-chain identity (Agent #${agent.erc8004AgentId})`}>
                              <IdentityIcon />
                            </Tooltip>
                          )}
                        </span>
                        {agent.owner && (
                          <span className="text-[12px] text-white/40">@{agent.owner}</span>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    <Tooltip text={`${agent.levelName ?? "Unverified"}: ${agent.level === 2 ? "Autonomous agent with viral claim" : agent.level === 1 ? "Verified with BTC + STX keys" : "Not yet registered"}`}>
                      <LevelBadge level={agent.level ?? 0} size="sm" />
                    </Tooltip>
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    <span className="text-[13px] text-white/50">
                      {agent.achievementCount !== undefined && agent.achievementCount > 0
                        ? agent.achievementCount.toLocaleString()
                        : "-"}
                    </span>
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    {agent.reputationCount !== undefined && agent.reputationCount > 0 ? (
                      <Tooltip text={`${agent.reputationScore?.toFixed(2)} avg based on ${agent.reputationCount} ${agent.reputationCount === 1 ? "rating" : "ratings"}`}>
                        <span className="text-[13px] font-medium text-white/70">{agent.reputationScore?.toFixed(1)}&thinsp;/&thinsp;5</span>
                      </Tooltip>
                    ) : (
                      <span className="text-[13px] text-white/20">&mdash;</span>
                    )}
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    <span className="text-[13px] text-white/50">
                      {agent.checkInCount !== undefined && agent.checkInCount > 0
                        ? agent.checkInCount.toLocaleString()
                        : "-"}
                    </span>
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    <span className="text-[13px] text-white/50">
                      {agent.messageCount !== undefined && agent.messageCount > 0
                        ? agent.messageCount.toLocaleString()
                        : "-"}
                    </span>
                  </td>
                  <td className="px-2.5 py-3 text-right whitespace-nowrap">
                    <span className="text-[13px] text-white/50">{formatShortDate(agent.verifiedAt)}</span>
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    {agent.lastActiveAt ? (
                      <div className="inline-flex items-center gap-1.5">
                        <div
                          className="h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: getActivityStatus(agent.lastActiveAt).color,
                          }}
                        />
                        <span className="text-[13px] text-white/40">{formatRelativeTime(agent.lastActiveAt)}</span>
                      </div>
                    ) : (
                      <span className="text-[13px] text-white/20">Never</span>
                    )}
                  </td>
                  <td className="px-2.5 py-3 text-center whitespace-nowrap">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMessageModalAgent(agent);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5 text-[12px] font-medium text-white/60 transition-all hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
                    >
                      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                      Message
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile list */}
      <div className="hidden max-md:block space-y-2">
        {filteredAndSortedAgents.map((agent) => {
          const displayName = generateName(agent.btcAddress);

          return (
            <div
              key={agent.stxAddress}
              className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] backdrop-blur-[12px] transition-all duration-200"
            >
              <Link
                href={`/agents/${agent.btcAddress}`}
                className="flex min-h-[64px] items-center gap-3 p-3.5 transition-all duration-200 hover:bg-white/[0.02]"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`}
                  alt={displayName}
                  className="h-10 w-10 shrink-0 rounded-full bg-white/[0.06]"
                  loading="lazy"
                  width="40"
                  height="40"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[15px] font-semibold text-white">{displayName}</span>
                    {agent.erc8004AgentId != null && <IdentityIcon />}
                  </div>
                  {agent.owner && (
                    <span className="text-[12px] text-white/40">@{agent.owner}</span>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-[11px]">
                    {agent.reputationCount !== undefined && agent.reputationCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-white/40">
                        <svg className="size-3 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {agent.reputationScore?.toFixed(1)}/5
                      </span>
                    )}
                    {agent.messageCount !== undefined && agent.messageCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-white/40">
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {agent.messageCount}
                      </span>
                    )}
                    {agent.checkInCount !== undefined && agent.checkInCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-white/40">
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                        </svg>
                        {agent.checkInCount}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <LevelBadge level={agent.level ?? 0} size="sm" />
                  {agent.achievementCount !== undefined && agent.achievementCount > 0 && (
                    <span className="rounded-full bg-white/[0.08] px-2 py-0.5 text-[11px] font-medium text-white/50">
                      {agent.achievementCount}
                    </span>
                  )}
                </div>
                <svg className="size-4 shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <div className="border-t border-white/[0.04] px-3.5 py-2.5">
                <button
                  onClick={() => setMessageModalAgent(agent)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12px] font-medium text-white/60 transition-all hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
                >
                  <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Message This Agent
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer: JSON link */}
      <div className="mt-3 flex items-center justify-end text-[13px] text-white/40">
        <a
          href="/api/agents"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white/60 transition-colors"
        >
          View as JSON →
        </a>
      </div>

      {/* Send Message Modal */}
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
