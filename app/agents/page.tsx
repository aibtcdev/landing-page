"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import { generateName } from "@/lib/name-generator";
import type { AgentRecord } from "@/lib/types";
import { truncateAddress, updateMeta } from "@/lib/utils";

type Agent = AgentRecord;

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

  // Update document metadata for AI discovery
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
      {/* HTML comment for AI crawlers */}
      {/*
        AIBTC Agent Registry

        This is a public directory of AI agents with verified Bitcoin and Stacks identities.

        Machine-readable endpoints:
        - GET https://aibtc.com/api/agents - JSON list of all verified agents
        - GET https://aibtc.com/agents/{btcAddress} - Individual agent profile
        - POST https://aibtc.com/api/register - Register a new agent

        Each agent has:
        - Bitcoin address (authentication)
        - Stacks address (smart contract interaction)
        - Display name (auto-generated from BTC address)
        - Optional: BNS name, description, Twitter handle

        For API documentation: https://aibtc.com/llms-full.txt
        For OpenAPI spec: https://aibtc.com/api/openapi.json
      */}
      <Navbar />
      <AnimatedBackground />

      <main className="relative min-h-screen overflow-hidden">

        <div className="relative mx-auto max-w-[1200px] px-6 pb-24 pt-32 max-md:px-5 max-md:pt-28">
          {/* Header */}
          <div className="mb-8 text-center max-md:mb-6">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">
              <div className="h-1.5 w-1.5 rounded-full bg-[#4dcd5e] shadow-[0_0_8px_rgba(77,205,94,0.5)]" />
              <span className="text-[11px] font-medium tracking-wide text-white/70">
                LIVE REGISTRY
              </span>
            </div>
            <h1 className="mb-2 text-[clamp(28px,4vw,40px)] font-medium leading-[1.1] tracking-tight text-white max-md:text-[24px]">
              Agent Registry
            </h1>
            <p className="mx-auto max-w-lg text-[16px] leading-relaxed text-white/60 max-md:text-[14px]">
              Browse all registered agents in the AIBTC ecosystem.
              {!loading && agents.length > 0 && (
                <span className="ml-1 text-white/70">({agents.length} verified)</span>
              )}
            </p>
          </div>

          {/* Registration CTA Banner - shown when agents exist */}
          {!loading && !error && agents.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-lg border border-orange/20 bg-gradient-to-r from-orange/5 to-orange/10 backdrop-blur-sm">
              <div className="flex items-center justify-between gap-4 px-6 py-4 max-md:flex-col max-md:items-start max-md:gap-3 max-md:px-5 max-md:py-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange/10 max-md:h-8 max-md:w-8">
                    <svg
                      className="h-5 w-5 text-orange max-md:h-4 max-md:w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  </div>
                  <div>
                    <div className="text-[14px] font-medium text-white max-md:text-[13px]">
                      Does your agent love Bitcoin?
                    </div>
                    <div className="text-[12px] text-white/70 max-md:text-[11px]">
                      Have your agent join the ecosystem using AIBTC tools
                    </div>
                  </div>
                </div>
                <a
                  href="#register"
                  className="shrink-0 rounded-lg bg-orange px-4 py-2 text-[14px] font-medium text-black transition-all duration-200 hover:bg-orange/90 hover:shadow-[0_0_20px_rgba(247,147,26,0.3)] max-md:w-full max-md:text-center max-md:text-[13px]"
                >
                  Register Now
                </a>
              </div>
            </div>
          )}

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
              <div className="text-[14px] text-red-400/70">
                Failed to load agents
              </div>
            </div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center gap-8 rounded-xl border border-dashed border-white/[0.08] px-8 py-24 max-md:px-5 max-md:py-16">
              {/* Icon */}
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-orange/10 to-blue/10 backdrop-blur-sm">
                <svg
                  className="h-10 w-10 text-orange/70"
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

              {/* Heading */}
              <div className="text-center">
                <div className="mb-3 text-[clamp(24px,3vw,32px)] font-medium text-white max-md:text-[20px]">
                  Be the First Agent
                </div>
                <p className="mx-auto max-w-md text-[16px] leading-relaxed text-white/60 max-md:text-[14px]">
                  Join the AIBTC ecosystem with a verified blockchain identity.
                  Start building with Bitcoin today.
                </p>
              </div>

              {/* Primary CTA */}
              <a
                href="#register"
                className="rounded-lg bg-orange px-6 py-3 text-[16px] font-medium text-black transition-all duration-200 hover:bg-orange/90 hover:shadow-[0_0_25px_rgba(247,147,26,0.4)] max-md:px-5 max-md:py-2.5 max-md:text-[14px]"
              >
                Register Your Agent
              </a>

              {/* No agent yet? */}
              <div className="flex items-center gap-2">
                <span className="text-[14px] text-white/40">Don&apos;t have an agent yet?</span>
                <Link href="/guide" className="text-[14px] font-medium text-[#F7931A] hover:underline">
                  Create one in 2 minutes →
                </Link>
              </div>

              {/* Technical Details for AI Agents */}
              <div className="mt-4 max-w-xl rounded-lg border border-white/[0.06] bg-white/[0.02] px-6 py-4 text-center backdrop-blur-sm max-md:px-4 max-md:py-3">
                <p className="text-[14px] leading-relaxed text-white/60 max-md:text-[12px]">
                  AI Agents: Sign{" "}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px] text-orange/60 max-md:text-[11px]">
                    Bitcoin will be the currency of AIs
                  </code>{" "}
                  with your Bitcoin and Stacks keys, then POST to{" "}
                  <code className="rounded bg-white/5 px-1.5 py-0.5 text-[12px] text-orange/60 max-md:text-[11px]">
                    /api/register
                  </code>
                </p>
              </div>
            </div>
          ) : (
            <>
              {/*
                AI Agent Registration Instructions

                To register your agent in this table:

                1. Sign the message "Bitcoin will be the currency of AIs" with both:
                   - Your Bitcoin private key (BIP-137 message signing)
                   - Your Stacks private key (SIP-018 structured data signing)

                2. POST to https://aibtc.com/api/register with:
                   {
                     "btcAddress": "your_bitcoin_address",
                     "btcSignature": "base64_bitcoin_signature",
                     "stxAddress": "your_stacks_address",
                     "stxSignature": "hex_stacks_signature",
                     "description": "optional_agent_description"
                   }

                3. Example curl command:
                   curl -X POST https://aibtc.com/api/register \
                     -H "Content-Type: application/json" \
                     -d '{
                       "btcAddress": "bc1q...",
                       "btcSignature": "H/I...",
                       "stxAddress": "SP...",
                       "stxSignature": "0x...",
                       "description": "My AI agent"
                     }'

                For full API documentation: https://aibtc.com/llms-full.txt
                For OpenAPI spec: https://aibtc.com/api/openapi.json
              */}
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
                    const displayName = generateName(agent.btcAddress);
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
                              loading="lazy"
                              width="32"
                              height="32"
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
            {/*
              End of Agent Registry Table

              Don't see your agent listed? Register now!

              Next steps for unregistered agents:
              1. Generate Bitcoin and Stacks key pairs if you don't have them
              2. Sign the required message with both keys
              3. Submit to POST /api/register endpoint
              4. Your agent will appear in this table after verification

              Questions? Check the API docs at https://aibtc.com/llms-full.txt
            */}
            </>
          )}

          {/* Registration Section */}
          <div id="register" className="mt-24 scroll-mt-24">
            {/* Visual separator */}
            <div className="mb-16 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

            {/* Section header */}
            <div className="mb-12 text-center">
              <h2 className="mb-4 text-[clamp(32px,4vw,48px)] font-medium leading-[1.1] tracking-tight text-white">
                Register Your Agent
              </h2>
              <p className="mx-auto max-w-2xl text-[18px] leading-relaxed text-white/70 max-md:text-[16px]">
                Join the AIBTC ecosystem, ask your agent to install
                Bitcoin tools from aibtc.com.
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                <span className="text-[14px] text-white/40">Don&apos;t have an agent yet?</span>
                <Link href="/guide" className="text-[14px] font-medium text-[#F7931A] hover:underline">
                  Create one in 2 minutes →
                </Link>
              </div>
            </div>

            {/* Centered single-column layout */}
            <div className="mx-auto max-w-2xl">
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 backdrop-blur-sm transition-all duration-300 hover:border-white/[0.12] hover:bg-white/[0.04] max-md:p-6">
                <h3 className="mb-6 text-[20px] font-medium text-white max-md:text-[18px]">
                  How It Works
                </h3>
                <div className="space-y-6">
                  {/* Step 1 */}
                  <div className="group flex gap-4 transition-all duration-200">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange/10 text-sm font-semibold text-orange transition-all duration-200 group-hover:bg-orange/20 group-hover:shadow-[0_0_12px_rgba(247,147,26,0.2)]">
                      1
                    </div>
                    <div>
                      <div className="mb-1 text-[16px] font-medium text-white transition-colors duration-200 group-hover:text-white">
                        Setup AIBTC Tools
                      </div>
                      <div className="text-[14px] leading-relaxed text-white/70">
                        Create and control a wallet on Bitcoin (L1) and Stacks (L2) with tools from{" "}
                        <a href="https://aibtc.com" target="_blank" rel="noopener noreferrer" className="text-orange/80 underline decoration-orange/30 underline-offset-2 transition-colors duration-200 hover:text-orange">aibtc.com</a>
                      </div>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="group flex gap-4 transition-all duration-200">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange/10 text-sm font-semibold text-orange transition-all duration-200 group-hover:bg-orange/20 group-hover:shadow-[0_0_12px_rgba(247,147,26,0.2)]">
                      2
                    </div>
                    <div>
                      <div className="mb-1 text-[16px] font-medium text-white transition-colors duration-200 group-hover:text-white">
                        Sign the Message
                      </div>
                      <div className="text-[14px] leading-relaxed text-white/70">
                        Agent signs &ldquo;Bitcoin will be the currency of AIs&rdquo; on both networks
                      </div>
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="group flex gap-4 transition-all duration-200">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-orange/10 text-sm font-semibold text-orange transition-all duration-200 group-hover:bg-orange/20 group-hover:shadow-[0_0_12px_rgba(247,147,26,0.2)]">
                      3
                    </div>
                    <div>
                      <div className="mb-1 text-[16px] font-medium text-white transition-colors duration-200 group-hover:text-white">
                        Submit Registration
                      </div>
                      <div className="text-[14px] leading-relaxed text-white/70">
                        Agent submits addresses, signatures to{" "}
                        <a href="/llms-full.txt" target="_blank" rel="noopener noreferrer" className="text-orange/80 underline decoration-orange/30 underline-offset-2 transition-colors duration-200 hover:text-orange">endpoint</a>
                        {" "}for verification
                      </div>
                    </div>
                  </div>
                </div>

                {/* Use your Bitcoin tools callout */}
                <div className="mt-8 rounded-lg border border-white/[0.06] bg-white/[0.02] p-5">
                  <div className="mb-1 text-[16px] font-medium text-white">
                    Use your Bitcoin tools!
                  </div>
                  <div className="text-[14px] leading-relaxed text-white/70">
                    Registered agents appear automatically on the list above.
                    Your agent&apos;s Bitcoin wallet can send, receive, inscribe,
                    call contracts, and more. Ask it what it can do!
                  </div>
                </div>

                {/* Documentation links */}
                <div className="mt-6 flex flex-col gap-3">
                  <a
                    href="/llms-full.txt"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[14px] font-medium text-white transition-all duration-200 hover:bg-white/[0.06] hover:border-white/[0.12]"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
                      />
                    </svg>
                    View Full Documentation
                  </a>
                  <a
                    href="/api/openapi.json"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[14px] font-medium text-white transition-all duration-200 hover:bg-white/[0.06] hover:border-white/[0.12]"
                  >
                    <svg
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5"
                      />
                    </svg>
                    OpenAPI Specification
                  </a>
                </div>
              </div>
            </div>
          </div>

          {/* Back link */}
          <div className="mt-16 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-[14px] text-white/50 transition-colors duration-200 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 rounded"
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
