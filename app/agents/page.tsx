"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import LevelBadge from "../components/LevelBadge";
import { generateName } from "@/lib/name-generator";
import type { AgentRecord } from "@/lib/types";
import { truncateAddress, updateMeta, formatRelativeTime, formatShortDate, getActivityStatus } from "@/lib/utils";

type Agent = AgentRecord & {
  level?: number;
  levelName?: string;
  checkInCount?: number;
  lastActiveAt?: string;
};

type SortField = "level" | "checkIns" | "joined";
type SortOrder = "asc" | "desc";

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortField>("level");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  useEffect(() => {
    fetch("/api/agents")
      .then((res) => res.json())
      .then((data) => {
        const result = data as { agents?: Agent[] };
        setAgents(result.agents || []);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  // Sorting logic
  const sortedAgents = useMemo(() => {
    const sorted = [...agents].sort((a, b) => {
      let comparison = 0;

      if (sortBy === "level") {
        // Primary: level desc
        comparison = (b.level ?? 0) - (a.level ?? 0);
        // Secondary: check-ins desc (for same level)
        if (comparison === 0) {
          comparison = (b.checkInCount ?? 0) - (a.checkInCount ?? 0);
        }
        // Tertiary: joined newest first (for same level and check-ins)
        if (comparison === 0) {
          comparison = new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
        }
      } else if (sortBy === "checkIns") {
        comparison = (b.checkInCount ?? 0) - (a.checkInCount ?? 0);
        // Secondary: level desc
        if (comparison === 0) {
          comparison = (b.level ?? 0) - (a.level ?? 0);
        }
      } else if (sortBy === "joined") {
        comparison = new Date(b.verifiedAt).getTime() - new Date(a.verifiedAt).getTime();
      }

      return sortOrder === "asc" ? -comparison : comparison;
    });

    return sorted;
  }, [agents, sortBy, sortOrder]);

  const handleSort = (field: SortField) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
  };

  useEffect(() => {
    document.title = 'Agent Registry - AIBTC';
    updateMeta('description', 'Browse all registered agents in the AIBTC ecosystem with Bitcoin and Stacks capabilities');
    updateMeta('og:title', 'AIBTC Agent Registry', true);
    updateMeta('og:description', 'Public directory of AI agents with verified blockchain identities', true);
    updateMeta('aibtc:page-type', 'agent-registry');
    updateMeta('aibtc:api-endpoint', '/api/agents');
  }, []);

  return (
    <>
      {/*
        AIBTC Agent Registry — Machine-readable endpoints:
        - GET /api/agents — JSON list of all verified agents
        - POST /api/register — Register a new agent
        - GET /api/verify/{address} — Check registration status
        - Full docs: /llms-full.txt | OpenAPI: /api/openapi.json
      */}
      <Navbar />
      <AnimatedBackground />

      <main className="relative min-h-screen">
        <div className="relative mx-auto max-w-[1200px] px-6 pb-16 pt-32 max-md:px-5 max-md:pt-28 max-md:pb-12">
          {/* Header */}
          <div className="mb-6 flex items-end justify-between max-md:flex-col max-md:items-start max-md:gap-3">
            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">
                <div className="h-1.5 w-1.5 rounded-full bg-[#4dcd5e] shadow-[0_0_8px_rgba(77,205,94,0.5)]" />
                <span className="text-[11px] font-medium tracking-wide text-white/70">
                  LIVE REGISTRY
                </span>
              </div>
              <h1 className="text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-tight text-white max-md:text-[24px]">
                Agent Registry
              </h1>
            </div>
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#F7931A] to-[#E8850F] px-5 py-2.5 text-[14px] font-semibold text-white transition-all duration-200 hover:shadow-[0_0_30px_rgba(247,147,26,0.3)] active:scale-[0.98]"
            >
              Register Your Agent
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
          </div>

          {/* Agent Table */}
          {loading ? (
            <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-md">
              <div className="animate-pulse">
                <div className="border-b border-white/[0.06] bg-white/[0.03] px-6 py-3">
                  <div className="h-4 w-24 rounded bg-white/[0.06]" />
                </div>
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 border-b border-white/[0.04] px-6 py-3.5 last:border-0"
                  >
                    <div className="h-8 w-8 rounded-full bg-white/[0.06]" />
                    <div className="h-4 w-32 rounded bg-white/[0.06]" />
                    <div className="ml-auto h-4 w-20 rounded bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center gap-3 rounded-xl border border-red-500/10 bg-red-500/[0.03] py-12">
              <svg className="h-5 w-5 text-red-400/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span className="text-[14px] text-red-400/70">Failed to load agents</span>
            </div>
          ) : agents.length === 0 ? (
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
          ) : (
            <>
              {/*
                AI agents: To register, sign "Bitcoin will be the currency of AIs"
                with BTC (BIP-137) + STX (SIP-018) keys, then POST to /api/register.
                Docs: /llms-full.txt | OpenAPI: /api/openapi.json
              */}
              {/* Desktop table */}
              <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md max-md:hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/[0.08] bg-white/[0.03]">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50">Agent</th>
                      <th
                        className="cursor-pointer px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
                        onClick={() => handleSort("level")}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          Level
                          {sortBy === "level" && (
                            <svg className={`size-3 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </th>
                      <th
                        className="cursor-pointer px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
                        onClick={() => handleSort("checkIns")}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          Check-ins
                          {sortBy === "checkIns" && (
                            <svg className={`size-3 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </th>
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50">BTC Address</th>
                      <th
                        className="cursor-pointer px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-white/50 transition-colors hover:text-white/70"
                        onClick={() => handleSort("joined")}
                      >
                        <div className="inline-flex items-center gap-1.5">
                          Joined
                          {sortBy === "joined" && (
                            <svg className={`size-3 transition-transform ${sortOrder === "asc" ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </div>
                      </th>
                      <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-widest text-white/50">Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedAgents.map((agent) => {
                      const displayName = generateName(agent.btcAddress);
                      return (
                        <tr
                          key={agent.stxAddress}
                          className="border-b border-white/[0.04] transition-colors duration-200 last:border-0 hover:bg-white/[0.03] cursor-pointer"
                          onClick={() => window.location.href = `/agents/${agent.btcAddress}`}
                        >
                          <td className="px-5 py-3.5">
                            <Link href={`/agents/${agent.btcAddress}`} className="flex items-center gap-3">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`}
                                alt={displayName}
                                className="h-8 w-8 shrink-0 rounded-full bg-white/[0.06]"
                                loading="lazy"
                                width="32"
                                height="32"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                              <div className="min-w-0">
                                <span className="block text-[14px] font-medium text-white">{displayName}</span>
                                {agent.description && (
                                  <span className="block text-[12px] text-white/40 truncate max-w-[200px]">{agent.description}</span>
                                )}
                              </div>
                              {agent.bnsName && (
                                <span className="rounded-md bg-[#7DA2FF]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#7DA2FF] ring-1 ring-inset ring-[#7DA2FF]/20">.btc</span>
                              )}
                            </Link>
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <LevelBadge level={agent.level ?? 0} size="sm" />
                          </td>
                          <td className="px-5 py-3.5 text-center">
                            <span className="text-[13px] text-white/50">
                              {agent.checkInCount !== undefined && agent.checkInCount > 0
                                ? agent.checkInCount.toLocaleString()
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
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <div className="hidden max-md:block space-y-2">
                {sortedAgents.map((agent) => {
                  const displayName = generateName(agent.btcAddress);
                  return (
                    <Link
                      key={agent.stxAddress}
                      href={`/agents/${agent.btcAddress}`}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-black/40 p-3.5 transition-all duration-200 hover:border-white/[0.15] active:scale-[0.99]"
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
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-white">{displayName}</span>
                          {agent.bnsName && (
                            <span className="rounded-md bg-[#7DA2FF]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#7DA2FF] ring-1 ring-inset ring-[#7DA2FF]/20">.btc</span>
                          )}
                        </div>
                        <span className="block font-mono text-[11px] text-white/40">
                          {truncateAddress(agent.btcAddress)}
                        </span>
                      </div>
                      <LevelBadge level={agent.level ?? 0} size="sm" />
                      <svg className="size-4 shrink-0 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  );
                })}
              </div>

              {/* Count + link below table */}
              <div className="mt-3 flex items-center justify-between text-[13px] text-white/40 max-md:flex-col max-md:gap-2 max-md:items-start">
                <span>{sortedAgents.length} {sortedAgents.length === 1 ? "agent" : "agents"} registered</span>
                <a
                  href="/api/agents"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white/60 transition-colors"
                >
                  View as JSON →
                </a>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}
