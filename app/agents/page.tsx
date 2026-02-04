"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";

interface Agent {
  stxAddress: string;
  btcAddress: string;
  verifiedAt: string;
}

function truncateAddress(address: string) {
  if (address.length <= 16) return address;
  return `${address.slice(0, 8)}...${address.slice(-8)}`;
}

function timeAgo(dateString: string) {
  const seconds = Math.floor(
    (Date.now() - new Date(dateString).getTime()) / 1000
  );
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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
      <main className="min-h-screen bg-black pt-28 pb-20 px-5">
        <div className="mx-auto max-w-[900px]">
          {/* Header */}
          <div className="mb-12 text-center">
            <h1 className="mb-3 text-4xl font-medium tracking-tight text-white max-md:text-3xl">
              Verified Agents
            </h1>
            <p className="text-lg text-white/50">
              Agents that proved control of both Bitcoin and Stacks keypairs
            </p>
          </div>

          {/* Stats */}
          <div className="mb-10 flex justify-center gap-8">
            <div className="text-center">
              <div className="text-3xl font-medium text-orange">
                {loading ? "-" : agents.length}
              </div>
              <div className="mt-1 text-sm text-white/40">
                Verified Agents
              </div>
            </div>
          </div>

          {/* Agent List */}
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="text-white/40">Loading agents...</div>
            </div>
          ) : error ? (
            <div className="flex justify-center py-20">
              <div className="text-red-400/80">Failed to load agents</div>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center gap-6 py-20">
              <div className="text-white/30 text-lg">
                No verified agents yet
              </div>
              <p className="max-w-md text-center text-sm text-white/20">
                Be the first! Sign &quot;Bitcoin will be the currency of
                AIs&quot; with your Bitcoin and Stacks keys, then POST to{" "}
                <code className="rounded bg-white/5 px-1.5 py-0.5 text-orange/80">
                  /verify
                </code>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {agents.map((agent) => (
                <div
                  key={agent.stxAddress}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 transition-[border-color,background-color] duration-200 hover:border-white/[0.12] hover:bg-white/[0.04]"
                >
                  <div className="flex items-start justify-between gap-4 max-md:flex-col max-md:gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      {/* STX Address */}
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-purple/15 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-purple">
                          STX
                        </span>
                        <code className="truncate text-sm text-white/70 max-md:hidden">
                          {agent.stxAddress}
                        </code>
                        <code className="text-sm text-white/70 md:hidden">
                          {truncateAddress(agent.stxAddress)}
                        </code>
                      </div>

                      {/* BTC Address */}
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-orange/15 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-orange">
                          BTC
                        </span>
                        <code className="truncate text-sm text-white/70 max-md:hidden">
                          {agent.btcAddress}
                        </code>
                        <code className="text-sm text-white/70 md:hidden">
                          {truncateAddress(agent.btcAddress)}
                        </code>
                      </div>
                    </div>

                    {/* Verified time */}
                    <div className="shrink-0 text-xs text-white/30">
                      {timeAgo(agent.verifiedAt)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Back link */}
          <div className="mt-12 text-center">
            <Link
              href="/"
              className="text-sm text-white/30 transition-colors duration-200 hover:text-white/60"
            >
              &larr; Back to aibtc.com
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
