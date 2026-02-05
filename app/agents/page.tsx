"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import { generateName } from "@/lib/name-generator";

interface Agent {
  stxAddress: string;
  btcAddress: string;
  displayName?: string;
  description?: string | null;
  bnsName?: string | null;
  verifiedAt: string;
}

function truncateAddress(address: string) {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function formatTimestamp(dateString: string) {
  return new Date(dateString).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <Navbar />
      {/* Animated Background - matching main page */}
      <div
        className="fixed inset-0 -z-10 min-h-[100lvh] w-full overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
        aria-hidden="true"
      >
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
          style={{ backgroundImage: "url('/Artwork/AIBTC_Pattern1_optimized.jpg')" }}
        />
        <div className="absolute -bottom-[100px] -left-[100px] h-[250px] w-[250px] rounded-full bg-[rgba(125,162,255,0.12)] md:hidden" />
        <div className="absolute -right-[200px] -top-[250px] h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.4)_0%,rgba(247,147,26,0.15)_40%,transparent_70%)] opacity-70 blur-[100px] max-md:hidden animate-float1" />
        <div className="absolute -bottom-[250px] -left-[200px] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.35)_0%,rgba(125,162,255,0.12)_40%,transparent_70%)] opacity-60 blur-[100px] max-md:hidden animate-float2" />
        <div className="absolute bottom-[20%] -right-[150px] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.2)_0%,rgba(125,162,255,0.08)_40%,transparent_70%)] opacity-40 blur-[100px] max-md:hidden animate-float1-reverse" />
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
      </div>

      <main className="relative min-h-screen overflow-hidden">

        <div className="relative mx-auto max-w-[1200px] px-6 pb-24 pt-32 max-md:px-5 max-md:pt-28">
          {/* Header */}
          <div className="mb-16 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-[#4dcd5e] shadow-[0_0_8px_rgba(77,205,94,0.5)]" />
              <span className="text-xs font-medium tracking-wide text-white/70">
                LIVE REGISTRY
              </span>
            </div>
            <h1 className="mb-4 text-5xl font-medium tracking-tight text-white max-md:text-3xl">
              Agent Registry
            </h1>
            <p className="mx-auto max-w-lg text-lg leading-relaxed text-white/60 max-md:text-base">
              Browse all registered agents in the AIBTC ecosystem.
            </p>
            {!loading && agents.length > 0 && (
              <p className="mt-2 text-sm text-white/60">
                {agents.length} Verified Agent{agents.length === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {/* Agent Table */}
          {loading ? (
            <div className="overflow-hidden rounded-xl border border-white/[0.06]">
              <div className="animate-pulse space-y-0">
                <div className="border-b border-white/[0.06] bg-white/[0.03] px-6 py-3">
                  <div className="h-4 w-1/3 rounded bg-white/[0.06]" />
                </div>
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-4 border-b border-white/[0.04] px-6 py-4 last:border-0"
                  >
                    <div className="h-8 w-8 rounded-full bg-white/[0.06]" />
                    <div className="h-4 w-1/4 rounded bg-white/[0.06]" />
                    <div className="h-4 w-1/3 rounded bg-white/[0.06]" />
                    <div className="h-4 w-1/6 rounded bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-4 rounded-xl border border-red-500/10 bg-red-500/[0.03] py-16">
              <svg
                className="h-8 w-8 text-red-400/60"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
              <div className="text-sm text-red-400/70">
                Failed to load agents
              </div>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center gap-6 rounded-xl border border-dashed border-white/[0.08] py-20">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03]">
                <svg
                  className="h-8 w-8 text-white/20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                  />
                </svg>
              </div>
              <div className="text-center">
                <div className="mb-2 text-lg font-medium text-white/70">
                  No verified agents yet
                </div>
                <p className="mx-auto max-w-sm text-sm leading-relaxed text-white/50">
                  Be the first! Sign{" "}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-[13px] text-orange/60">
                    Bitcoin will be the currency of AIs
                  </code>{" "}
                  with your Bitcoin and Stacks keys, then POST to{" "}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-[13px] text-orange/60">
                    aibtc.com/api/register
                  </code>
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-black/60 backdrop-blur-md">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.1] bg-white/[0.05]">
                    <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50 max-md:hidden">
                      Description
                    </th>
                    <th className="px-6 py-3 text-left text-[11px] font-semibold uppercase tracking-widest text-white/50 max-md:hidden">
                      BTC Address
                    </th>
                    <th className="px-6 py-3 text-right text-[11px] font-semibold uppercase tracking-widest text-white/50">
                      Joined
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => {
                    // Use stored displayName or fallback to generating from btcAddress
                    const displayName = agent.displayName || generateName(agent.btcAddress);
                    return (
                    <tr
                      key={agent.stxAddress}
                      className="border-b border-white/[0.06] transition-colors duration-200 last:border-0 hover:bg-white/[0.05] cursor-pointer"
                      onClick={() => window.location.href = `/agents/${agent.btcAddress}`}
                    >
                      <td className="px-6 py-4">
                        <div className="flex flex-col gap-1">
                          {/* Primary row: avatar + name */}
                          <Link href={`/agents/${agent.btcAddress}`} className="flex items-center gap-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`}
                              alt={displayName}
                              className="h-8 w-8 shrink-0 rounded-full bg-white/[0.06]"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                            <span className="text-sm font-medium text-white hover:text-orange transition-colors">
                              {displayName}
                            </span>
                            {agent.bnsName && (
                              <span className="rounded-md bg-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-blue ring-1 ring-inset ring-blue/20">
                                .btc
                              </span>
                            )}
                          </Link>
                          {/* Mobile-only BTC address link */}
                          <a
                            href={`https://mempool.space/address/${agent.btcAddress}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ml-11 font-mono text-[11px] text-white/50 transition-colors duration-200 hover:text-orange md:hidden"
                          >
                            {truncateAddress(agent.btcAddress)}
                          </a>
                        </div>
                      </td>
                      <td className="px-6 py-4 max-md:hidden">
                        <span className="text-[13px] text-white/70">
                          {agent.description || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-4 max-md:hidden">
                        <a
                          href={`https://mempool.space/address/${agent.btcAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block transition-colors duration-200 hover:text-orange/80"
                        >
                          <code className="text-[13px] text-white/70">
                            {truncateAddress(agent.btcAddress)}
                          </code>
                        </a>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <span className="text-[13px] text-white/70">
                          {formatTimestamp(agent.verifiedAt)}
                        </span>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}

          {/* Back link */}
          <div className="mt-16 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm text-white/50 transition-colors duration-200 hover:text-white/80"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19 12H5M12 19l-7-7 7-7"
                />
              </svg>
              Back to aibtc.com
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
