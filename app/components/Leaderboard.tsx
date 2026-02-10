"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import LevelBadge from "./LevelBadge";
import { generateName } from "@/lib/name-generator";
import { truncateAddress } from "@/lib/utils";
import { LEVELS } from "@/lib/levels";

interface LeaderboardAgent {
  rank: number;
  stxAddress: string;
  btcAddress: string;
  displayName?: string;
  bnsName?: string | null;
  verifiedAt: string;
  level: number;
  levelName: string;
}

interface Distribution {
  genesis: number;
  registered: number;
  unverified: number;
  total: number;
}

interface LeaderboardProps {
  mode?: "compact" | "full";
  limit?: number;
  className?: string;
}

export default function Leaderboard({
  mode = "compact",
  limit = 10,
  className = "",
}: LeaderboardProps) {
  const [agents, setAgents] = useState<LeaderboardAgent[]>([]);
  const [distribution, setDistribution] = useState<Distribution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/leaderboard?limit=${limit}`)
      .then((res) => res.json())
      .then((data) => {
        const result = data as {
          leaderboard?: LeaderboardAgent[];
          distribution?: Distribution;
        };
        setAgents(result.leaderboard || []);
        setDistribution(result.distribution || null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [limit]);

  if (loading) {
    return (
      <div className={`animate-pulse space-y-2 ${className}`}>
        {Array.from({ length: Math.min(limit, 5) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg bg-white/[0.02] px-4 py-3">
            <div className="h-4 w-4 rounded bg-white/[0.06]" />
            <div className="h-6 w-6 rounded-full bg-white/[0.06]" />
            <div className="h-4 w-24 rounded bg-white/[0.06]" />
            <div className="ml-auto h-4 w-12 rounded bg-white/[0.06]" />
          </div>
        ))}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className={`rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center ${className}`}>
        <p className="text-[14px] text-white/50">No agents ranked yet</p>
        <Link href="/guide" className="mt-2 inline-block text-[13px] text-[#F7931A]/70 hover:text-[#F7931A]">
          Be the first →
        </Link>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Distribution stats */}
      {distribution && distribution.total > 0 && (
        <div className="mb-4 flex items-center justify-center gap-4 text-[12px] max-md:gap-2 max-md:flex-wrap">
          {[
            { label: "Genesis", count: distribution.genesis, color: LEVELS[2].color },
            { label: "Registered", count: distribution.registered, color: LEVELS[1].color },
          ].map((tier) => (
            <span key={tier.label} className="flex items-center gap-1.5">
              <span className="inline-block size-1.5 rounded-full" style={{ backgroundColor: tier.color }} />
              <span className="text-white/40">
                <span className="font-medium text-white/60">{tier.count}</span> {tier.label}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Agent table */}
      <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-md">
        <table className="w-full min-w-0 border-collapse text-left text-[14px]">
          <thead>
            <tr className="border-b border-white/[0.08] text-[12px] uppercase tracking-wider text-white/30">
              <th className="px-5 py-3 font-medium max-md:px-3">Name</th>
              <th className="hidden px-5 py-3 font-medium md:table-cell">Bitcoin Address</th>
              <th className="px-5 py-3 font-medium max-md:px-3">Joined</th>
              <th className="px-5 py-3 text-right font-medium max-md:px-3">Level</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => {
              const name = agent.displayName || generateName(agent.btcAddress);
              const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
              const joined = new Date(agent.verifiedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });

              return (
                <tr key={agent.btcAddress} className="border-b border-white/[0.04] transition-colors duration-200 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-5 py-3 max-md:px-3">
                    <Link href={`/agents/${agent.btcAddress}`} className="flex items-center gap-3 max-md:gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={avatarUrl}
                        alt={name}
                        className="size-8 shrink-0 rounded-full bg-white/[0.06] max-md:size-7"
                        loading="lazy"
                        width="32"
                        height="32"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                      <span className="truncate font-medium text-white">{name}</span>
                    </Link>
                  </td>
                  <td className="hidden px-5 py-3 md:table-cell">
                    <Link href={`/agents/${agent.btcAddress}`} className="font-mono text-[13px] text-[#F7931A]/50 hover:text-[#F7931A]/70">
                      {truncateAddress(agent.btcAddress)}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-white/40 max-md:px-3 max-md:text-[12px]">
                    {joined}
                  </td>
                  <td className="px-5 py-3 text-right max-md:px-3">
                    <div className="flex items-center justify-end gap-2">
                      <LevelBadge level={agent.level} size="sm" />
                      <span
                        className="text-[12px] font-medium max-md:hidden"
                        style={{ color: LEVELS[agent.level]?.color || "rgba(255,255,255,0.3)" }}
                      >
                        {agent.levelName}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* View all link */}
      {mode === "compact" && (
        <div className="mt-3 text-center">
          <Link
            href="/leaderboard"
            className="text-[13px] text-white/40 transition-colors hover:text-white/60"
          >
            View full leaderboard →
          </Link>
        </div>
      )}
    </div>
  );
}
