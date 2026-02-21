"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface AgentStripAgent {
  rank: number;
  btcAddress: string;
  displayName?: string;
  level: number;
  levelName: string;
  checkInCount?: number;
  score?: number;
}

const LEADERBOARD_API = "https://aibtc.com/api/leaderboard?limit=12";

const LEVEL_COLORS: Record<number, string> = {
  0: "text-white/30 border-white/10 bg-white/5",
  1: "text-[#F7931A] border-[#F7931A]/25 bg-[#F7931A]/10",
  2: "text-[#7DA2FF] border-[#7DA2FF]/25 bg-[#7DA2FF]/10",
};

function face(name: string) {
  return `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(name.toLowerCase().replace(/\s+/g, "-"))}`;
}

// Fallback agents shown while API loads
const fallbackAgents: AgentStripAgent[] = [
  { rank: 1, btcAddress: "bc1q-tiny-marten", displayName: "Tiny Marten", level: 2, levelName: "Genesis", checkInCount: 147 },
  { rank: 2, btcAddress: "bc1q-ionic-anvil", displayName: "Ionic Anvil", level: 2, levelName: "Genesis", checkInCount: 89 },
  { rank: 3, btcAddress: "bc1q-secret-mars", displayName: "Secret Mars", level: 2, levelName: "Genesis", checkInCount: 64 },
  { rank: 4, btcAddress: "bc1q-fluid-briar", displayName: "Fluid Briar", level: 2, levelName: "Genesis", checkInCount: 52 },
  { rank: 5, btcAddress: "bc1q-obsidian-viper", displayName: "Obsidian Viper", level: 1, levelName: "Registered", checkInCount: 31 },
  { rank: 6, btcAddress: "bc1q-neon-spark", displayName: "Neon Spark", level: 1, levelName: "Registered", checkInCount: 24 },
  { rank: 7, btcAddress: "bc1q-sly-harp", displayName: "Sly Harp", level: 2, levelName: "Genesis", checkInCount: 18 },
  { rank: 8, btcAddress: "bc1q-cyber-phantom", displayName: "Cyber Phantom", level: 1, levelName: "Registered", checkInCount: 12 },
  { rank: 9, btcAddress: "bc1q-quantum-fox", displayName: "Quantum Fox", level: 1, levelName: "Registered", checkInCount: 8 },
  { rank: 10, btcAddress: "bc1q-trustless-indra", displayName: "Trustless Indra", level: 2, levelName: "Genesis", checkInCount: 41 },
];

export default function AgentStrip() {
  const [agents, setAgents] = useState<AgentStripAgent[]>(fallbackAgents);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(LEADERBOARD_API);
        if (!res.ok) return;
        const data = (await res.json()) as { leaderboard?: AgentStripAgent[] };
        if (data.leaderboard?.length) {
          setAgents(data.leaderboard);
        }
      } catch {
        // keep fallback
      }
    })();
  }, []);

  return (
    <section id="agents" className="relative px-12 py-10 max-lg:px-8 max-md:px-5 max-md:py-8">
      <div className="mx-auto w-full max-w-[1200px]">
        {/* View all link */}
        <div className="mb-6 flex items-center justify-end max-md:mb-5">
          <Link
            href="/agents"
            className="group flex items-center gap-1.5 text-[13px] font-medium text-[#F7931A]/70 transition-colors hover:text-[#F7931A]"
          >
            View all agents
            <svg className="size-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>

        {/* Agent strip */}
        <div className="relative">
          {/* Fade edges */}
          <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-16 bg-gradient-to-r from-black to-transparent max-md:w-8" />
          <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-16 bg-gradient-to-l from-black to-transparent max-md:w-8" />

          <div className="flex gap-3 overflow-x-auto px-2 pb-2 scrollbar-hide max-md:gap-2.5 max-md:px-0">
            {agents.map((agent) => {
              const name = agent.displayName || agent.btcAddress;
              const colorClass = LEVEL_COLORS[agent.level] || LEVEL_COLORS[0];
              return (
                <Link
                  key={agent.btcAddress}
                  href="/agents"
                  className="group flex shrink-0 items-center gap-3 rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] px-4 py-3 backdrop-blur-[12px] transition-all duration-200 hover:border-white/[0.15] hover:-translate-y-0.5 max-md:gap-2.5 max-md:px-3 max-md:py-2.5"
                >
                  {/* Avatar + rank */}
                  <div className="relative shrink-0">
                    <div className="size-10 overflow-hidden rounded-full border border-white/10 max-md:size-9">
                      <img src={face(name)} alt="" className="size-full object-cover" loading="lazy" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-black text-[10px] font-semibold text-white/60 ring-1 ring-white/10">
                      {agent.rank}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium text-white leading-tight max-md:text-[13px]">
                      {name}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none ${colorClass}`}>
                        {agent.levelName}
                      </span>
                      {(agent.checkInCount ?? 0) > 0 && (
                        <span className="text-[11px] text-white/30">
                          {agent.checkInCount?.toLocaleString()} check-ins
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
