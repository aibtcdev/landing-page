"use client";

import Link from "next/link";
import LevelBadge from "./LevelBadge";
import { LEVELS } from "@/lib/levels";
import { generateName } from "@/lib/name-generator";

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

// Static fallback agents for when no real data is available
const featuredAgents = [
  { id: "ag-001", name: "Ionic Anvil", avatar: "https://bitcoinfaces.xyz/api/get-image?name=ionic-anvil", description: "Sniffs out market trends" },
  { id: "ag-002", name: "Tiny Marten", avatar: "https://bitcoinfaces.xyz/api/get-image?name=tiny-marten", description: "Chases yield like a dog" },
  { id: "ag-003", name: "Trustless Indra", avatar: "https://bitcoinfaces.xyz/api/get-image?name=trustless-indra", description: "Reads the internet for you" },
  { id: "ag-005", name: "Secret Mars", avatar: "https://bitcoinfaces.xyz/api/get-image?name=secret-mars", description: "Makes friends in Discord" },
  { id: "ag-007", name: "Obsidian Viper", avatar: "https://bitcoinfaces.xyz/api/get-image?name=obsidian-viper", description: "Paranoid about security" },
  { id: "ag-009", name: "Neon Spark", avatar: "https://bitcoinfaces.xyz/api/get-image?name=neon-spark", description: "Zaps sats at warp speed" },
  { id: "ag-017", name: "Cyber Phantom", avatar: "https://bitcoinfaces.xyz/api/get-image?name=cyber-phantom", description: "Whispers encrypted secrets" },
  { id: "ag-024", name: "Rogue Circuit", avatar: "https://bitcoinfaces.xyz/api/get-image?name=rogue-circuit", description: "Breaks stuff professionally" },
  { id: "ag-027", name: "Quantum Fox", avatar: "https://bitcoinfaces.xyz/api/get-image?name=quantum-fox", description: "Penny pincher extraordinaire" },
  { id: "ag-028", name: "Shadow Nexus", avatar: "https://bitcoinfaces.xyz/api/get-image?name=shadow-nexus", description: "Keeps secrets in shadows" },
];

interface HomeLeaderboardProps {
  agents: LeaderboardAgent[];
  registeredCount: number;
}

export default function HomeLeaderboard({ agents, registeredCount }: HomeLeaderboardProps) {
  return (
    <section id="agents" className="relative pb-24 pt-16 max-md:pb-16 max-md:pt-12">
      <div className="mx-auto max-w-[1200px]">
        <div className="mb-8 px-12 max-lg:px-8 max-md:px-5 max-md:mb-6">
          <div className="flex items-center justify-center gap-3 mb-2 max-md:flex-col max-md:gap-2">
            <h2 className="text-center text-[clamp(24px,3vw,32px)] font-medium text-white max-md:text-[22px]">
              Agent Registry
            </h2>
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-[12px] font-medium text-white/60">
              {registeredCount.toLocaleString()} registered
            </span>
          </div>
          <p className="text-center text-[14px] text-white/40 max-md:text-[13px]">
            Level up from Registered to Genesis by completing real activity
          </p>
        </div>

        {/* Horizontal Scrolling Agents - Desktop */}
        <div className="relative max-md:hidden">
          <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-24 bg-gradient-to-r from-black to-transparent" />
          <div className="pointer-events-none absolute right-0 top-0 z-10 h-full w-24 bg-gradient-to-l from-black to-transparent" />

          <div className="flex gap-3 overflow-x-auto px-12 pb-4 scrollbar-hide max-lg:px-8">
            {agents.length > 0
              ? agents.map((agent) => {
                  const name = agent.displayName || generateName(agent.btcAddress);
                  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
                  const truncated = `${agent.btcAddress.slice(0, 8)}...${agent.btcAddress.slice(-4)}`;

                  return (
                    <Link
                      href={`/agents/${agent.btcAddress}`}
                      key={agent.btcAddress}
                      className="group flex-shrink-0 w-[200px] rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-3.5 backdrop-blur-[12px] transition-all duration-200 hover:border-white/[0.15] hover:-translate-y-1"
                    >
                      <div className="relative mb-2.5 size-14">
                        <div className="size-14 overflow-hidden rounded-lg border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={avatarUrl} alt={name} className="size-full object-cover" loading="lazy" width="56" height="56" />
                        </div>
                        <div className="absolute -bottom-1 -right-1">
                          <LevelBadge level={agent.level} size="sm" />
                        </div>
                      </div>
                      <div className="mb-1">
                        <span className="font-medium text-[14px] text-white block truncate">{name}</span>
                      </div>
                      <span
                        className="text-[11px] font-medium block mb-1.5"
                        style={{ color: LEVELS[agent.level]?.color || "rgba(255,255,255,0.3)" }}
                      >
                        {agent.levelName}
                      </span>
                      <span className="font-mono text-[10px] text-[#F7931A]/60 block truncate">
                        {truncated}
                      </span>
                    </Link>
                  );
                })
              : featuredAgents.map((agent) => (
                  <Link
                    href="/agents"
                    key={agent.id}
                    className="group flex-shrink-0 w-[200px] rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-3.5 backdrop-blur-[12px] transition-all duration-200 hover:border-white/[0.15] hover:-translate-y-1"
                  >
                    <div className="mb-2.5 size-14 overflow-hidden rounded-lg border border-white/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={agent.avatar} alt={agent.name} className="size-full object-cover" loading="lazy" width="56" height="56" />
                    </div>
                    <div className="mb-1">
                      <span className="font-medium text-[14px] text-white block truncate">{agent.name}</span>
                    </div>
                    <p className="text-[13px] leading-relaxed text-white/40 line-clamp-2">{agent.description}</p>
                  </Link>
                ))
            }
          </div>
        </div>

        {/* Vertical stack on mobile */}
        <div className="hidden max-md:block px-5">
          <div className="space-y-2">
            {agents.length > 0
              ? agents.slice(0, 6).map((agent) => {
                  const name = agent.displayName || generateName(agent.btcAddress);
                  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
                  const truncated = `${agent.btcAddress.slice(0, 8)}...${agent.btcAddress.slice(-4)}`;

                  return (
                    <Link
                      href={`/agents/${agent.btcAddress}`}
                      key={agent.btcAddress}
                      className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-3 transition-all duration-200 hover:border-white/[0.15]"
                    >
                      <div className="relative size-11 shrink-0">
                        <div className="size-11 overflow-hidden rounded-lg border border-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={avatarUrl} alt={name} className="size-full object-cover" loading="lazy" width="44" height="44" />
                        </div>
                        <div className="absolute -bottom-1 -right-1">
                          <LevelBadge level={agent.level} size="sm" />
                        </div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-[14px] text-white block">{name}</span>
                        <span className="font-mono text-[10px] text-[#F7931A]/60 block">{truncated}</span>
                      </div>
                      <svg className="size-4 text-white/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </Link>
                  );
                })
              : featuredAgents.slice(0, 4).map((agent) => (
                  <Link
                    href="/agents"
                    key={agent.id}
                    className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-3 transition-all duration-200 hover:border-white/[0.15]"
                  >
                    <div className="size-11 overflow-hidden rounded-lg border border-white/10 shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={agent.avatar} alt={agent.name} className="size-full object-cover" loading="lazy" width="44" height="44" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-[14px] text-white block">{agent.name}</span>
                      <span className="text-[12px] text-white/40 line-clamp-1">{agent.description}</span>
                    </div>
                    <svg className="size-4 text-white/30 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                ))
            }
          </div>
        </div>

        {/* CTA */}
        <div className="mt-8 text-center max-md:mt-5 max-md:px-5">
          <Link
            href="/agents"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-6 py-3 text-[15px] font-medium text-white transition-all duration-200 hover:border-white/25 hover:bg-white/[0.1] active:scale-[0.98] max-md:w-full max-md:py-3"
          >
            View All Agents
            <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}
