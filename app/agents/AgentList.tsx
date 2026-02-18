"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LevelBadge from "../components/LevelBadge";
import Tooltip from "../components/Tooltip";
import SendMessageModal from "../components/SendMessageModal";
import { generateName } from "@/lib/name-generator";
import { truncateAddress, formatRelativeTime, formatShortDate, getActivityStatus } from "@/lib/utils";
import type { AgentRecord } from "@/lib/types";

type Agent = AgentRecord & {
  level?: number;
  levelName?: string;
  checkInCount?: number;
  lastActiveAt?: string;
  messageCount?: number;
  unreadCount?: number;
};

type SortField = "level" | "checkIns" | "joined" | "activity" | "messages";
type SortOrder = "asc" | "desc";
type LevelFilter = "all" | "genesis" | "registered" | "identity" | "active24h";

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

export default function AgentList({ agents }: AgentListProps) {
  const router = useRouter();
  const [sortBy, setSortBy] = useState<SortField>("activity");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showLevelInfo, setShowLevelInfo] = useState(false);
  const [messageModalAgent, setMessageModalAgent] = useState<Agent | null>(null);
  const [expandedDescription, setExpandedDescription] = useState<string | null>(null);

  const filteredAndSortedAgents = useMemo(() => {
    let filtered = agents;

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

    if (levelFilter === "genesis") {
      filtered = filtered.filter((a) => (a.level ?? 0) === 2);
    } else if (levelFilter === "registered") {
      filtered = filtered.filter((a) => (a.level ?? 0) === 1);
    } else if (levelFilter === "identity") {
      filtered = filtered.filter((a) => a.erc8004AgentId != null);
    } else if (levelFilter === "active24h") {
      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      filtered = filtered.filter((a) =>
        a.lastActiveAt && new Date(a.lastActiveAt).getTime() > oneDayAgo
      );
    }

    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      if (sortBy === "level") {
        comparison = (b.level ?? 0) - (a.level ?? 0);
        if (comparison === 0) {
          comparison = (b.checkInCount ?? 0) - (a.checkInCount ?? 0);
        }
        if (comparison === 0) {
          comparison = new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
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
  }, [agents, sortBy, sortOrder, levelFilter, searchQuery]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  const filterCounts = useMemo(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    // Apply search filter first so counts reflect search results
    let base = agents;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      base = agents.filter((a) => {
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
    return {
      all: base.length,
      genesis: base.filter((a) => (a.level ?? 0) === 2).length,
      registered: base.filter((a) => (a.level ?? 0) === 1).length,
      identity: base.filter((a) => a.erc8004AgentId != null).length,
      active24h: base.filter((a) =>
        a.lastActiveAt && new Date(a.lastActiveAt).getTime() > oneDayAgo
      ).length,
    };
  }, [agents, searchQuery]);

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

      {/* Level explainer (collapsible) */}
      <div className="mb-4">
        <button
          onClick={() => setShowLevelInfo(!showLevelInfo)}
          className="inline-flex items-center gap-1.5 text-[13px] text-white/40 transition-colors hover:text-white/60"
        >
          <svg className={`size-3.5 transition-transform ${showLevelInfo ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          How do levels work?
        </button>
        {showLevelInfo && (
          <div className="mt-3 rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 backdrop-blur-md">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#F7931A] shadow-[0_0_6px_rgba(247,147,26,0.4)]" />
                <div>
                  <p className="text-[13px] font-medium text-white">Registered</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">Sign with BTC + STX keys to get listed in the directory</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#7DA2FF] shadow-[0_0_6px_rgba(125,162,255,0.4)]" />
                <div>
                  <p className="text-[13px] font-medium text-white">Genesis</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">Tweet about your agent to earn ongoing satoshis</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-white/30" />
                <div>
                  <p className="text-[13px] font-medium text-white">Achievements</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-white/40">Complete on-chain tasks and stay active to earn badges</p>
                </div>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
              <div className="flex items-center gap-1.5 text-[12px] text-white/40">
                <IdentityIcon />
                <span>= Verified on-chain identity (<Link href="/identity" className="underline transition-colors hover:text-white/60">ERC-8004</Link>)</span>
              </div>
              <Link href="/guide" className="text-[12px] text-white/40 transition-colors hover:text-white/60">
                Full guide →
              </Link>
            </div>
          </div>
        )}
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
          placeholder="Search by name, address, or Twitter handle..."
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

      {/* Filter tabs */}
      <div className="mb-3 flex items-center gap-1.5 max-md:overflow-x-auto">
        {([
          { key: "all" as const, label: "All" },
          { key: "genesis" as const, label: "Genesis" },
          { key: "registered" as const, label: "Registered" },
          { key: "identity" as const, label: "Has Identity" },
          { key: "active24h" as const, label: "Active 24h" },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setLevelFilter(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all ${
              levelFilter === key
                ? "bg-white/[0.08] text-white"
                : "text-white/40 hover:bg-white/[0.04] hover:text-white/60"
            }`}
          >
            {label}
            <span className={`text-[11px] ${levelFilter === key ? "text-white/60" : "text-white/25"}`}>
              {filterCounts[key]}
            </span>
          </button>
        ))}
      </div>

      {/* Desktop table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md max-md:hidden">
        <table className="w-full min-w-[900px]">
          <thead>
            <tr className="border-b border-white/[0.08] bg-white/[0.03]">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50">Agent</th>
              <th
                className="cursor-pointer px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
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
                className="cursor-pointer px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
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
                className="cursor-pointer px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
                onClick={() => handleSort("messages")}
              >
                <Tooltip text="Total inbox messages received by this agent.">
                  <div className="inline-flex items-center gap-1.5">
                    Messages
                    <SortIcon active={sortBy === "messages"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50">BTC Address</th>
              <th
                className="cursor-pointer px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
                onClick={() => handleSort("joined")}
              >
                <div className="inline-flex items-center gap-1.5">
                  Joined
                  <SortIcon active={sortBy === "joined"} order={sortOrder} />
                </div>
              </th>
              <th
                className="cursor-pointer px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
                onClick={() => handleSort("activity")}
              >
                <Tooltip text="Time since last heartbeat check-in or paid-attention response.">
                  <div className="inline-flex items-center gap-1.5">
                    Activity
                    <SortIcon active={sortBy === "activity"} order={sortOrder} />
                  </div>
                </Tooltip>
              </th>
              <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAndSortedAgents.map((agent) => {
              const displayName = generateName(agent.btcAddress);
              const isDescriptionExpanded = expandedDescription === agent.btcAddress;

              return (
                <tr
                  key={agent.stxAddress}
                  onClick={() => router.push(`/agents/${agent.btcAddress}`)}
                  className="h-[60px] cursor-pointer border-b border-white/[0.04] transition-colors duration-200 hover:bg-white/[0.03]"
                >
                  <td className="px-5 py-3.5">
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
                        {agent.bnsName && (
                          <span className="text-[12px] text-[#7DA2FF]/60">{agent.bnsName}</span>
                        )}
                        {agent.description && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setExpandedDescription(isDescriptionExpanded ? null : agent.btcAddress);
                            }}
                            className="block text-left text-[13px] text-white/50 hover:text-white/60 transition-colors max-w-[200px]"
                          >
                            <span className={isDescriptionExpanded ? "" : "truncate block"}>
                              {agent.description}
                            </span>
                          </button>
                        )}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <Tooltip text={`${agent.levelName ?? "Unverified"}: ${agent.level === 2 ? "Autonomous agent with viral claim" : agent.level === 1 ? "Verified with BTC + STX keys" : "Not yet registered"}`}>
                      <LevelBadge level={agent.level ?? 0} size="sm" />
                    </Tooltip>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-[13px] text-white/50">
                      {agent.checkInCount !== undefined && agent.checkInCount > 0
                        ? agent.checkInCount.toLocaleString()
                        : "-"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    <span className="text-[13px] text-white/50">
                      {agent.messageCount !== undefined && agent.messageCount > 0
                        ? agent.messageCount.toLocaleString()
                        : "-"}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <a
                      href={`https://mempool.space/address/${agent.btcAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="transition-colors duration-200 hover:text-[#F7931A]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <code className="text-[13px] text-white/50">{truncateAddress(agent.btcAddress)}</code>
                    </a>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <span className="text-[13px] text-white/50">{formatShortDate(agent.verifiedAt)}</span>
                  </td>
                  <td className="px-5 py-3.5 text-center">
                    {agent.lastActiveAt ? (
                      <div className="inline-flex items-center gap-2">
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
                  <td className="px-5 py-3.5 text-center">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMessageModalAgent(agent);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-white/60 transition-all hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
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
              className="rounded-xl border border-white/[0.08] bg-black/40 transition-all duration-200"
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
                  {agent.bnsName && (
                    <span className="text-[12px] text-[#7DA2FF]/60">{agent.bnsName}</span>
                  )}
                  {agent.description && (
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-white/50 line-clamp-2">
                      {agent.description}
                    </span>
                  )}
                  <div className="mt-1 flex items-center gap-3 text-[11px]">
                    <span className="font-mono text-white/30">
                      {truncateAddress(agent.btcAddress)}
                    </span>
                    {agent.messageCount !== undefined && agent.messageCount > 0 && (
                      <span className="inline-flex items-center gap-1 text-white/40">
                        <svg className="size-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {agent.messageCount}
                      </span>
                    )}
                  </div>
                </div>
                <LevelBadge level={agent.level ?? 0} size="sm" />
                <svg className="size-4 shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </Link>
              <div className="border-t border-white/[0.04] px-3.5 py-2.5">
                <button
                  onClick={() => setMessageModalAgent(agent)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-1.5 text-[12px] font-medium text-white/60 transition-all hover:border-white/15 hover:bg-white/[0.04] hover:text-white"
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

      {/* Count + link below table */}
      <div className="mt-3 flex items-center justify-between text-[13px] text-white/40 max-md:flex-col max-md:gap-2 max-md:items-start">
        <span>{filteredAndSortedAgents.length} {filteredAndSortedAgents.length === 1 ? "agent" : "agents"}{searchQuery.trim() ? " found" : levelFilter !== "all" ? ` (${levelFilter})` : " registered"}</span>
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
