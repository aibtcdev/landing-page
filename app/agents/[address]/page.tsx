"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";
import { generateName } from "@/lib/name-generator";
import type { AgentRecord } from "@/lib/types";
import { truncateAddress, updateMeta } from "@/lib/utils";

interface ClaimInfo {
  status: "pending" | "verified" | "rewarded" | "failed";
  rewardSatoshis: number;
  rewardTxid: string | null;
  tweetUrl: string | null;
  tweetAuthor: string | null;
  claimedAt: string;
}

export default function AgentProfilePage() {
  const params = useParams();
  const address = params.address as string;

  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [tweetUrlInput, setTweetUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(address)}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Agent not found");
          } else {
            throw new Error("Failed to fetch agent");
          }
        } else {
          const data = (await res.json()) as { registered: boolean; agent: AgentRecord };
          if (data.registered && data.agent) {
            setAgent(data.agent);
          } else {
            setError("Agent not found");
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    if (address) fetchAgent();
  }, [address]);

  useEffect(() => {
    if (!agent) return;
    fetch(`/api/claims/viral?btcAddress=${encodeURIComponent(agent.btcAddress)}`)
      .then((r) => r.json())
      .then((raw: unknown) => {
        const data = raw as { claim?: ClaimInfo };
        if (data.claim) setClaim(data.claim);
      })
      .catch(() => {});
  }, [agent]);

  const profileUrl = typeof window !== "undefined"
    ? `${window.location.origin}/agents/${agent?.btcAddress}`
    : "";

  const displayName = agent ? generateName(agent.btcAddress) : "";

  const tweetText = agent
    ? `My AIBTC agent is ${displayName} 🤖₿\n\n${profileUrl}\n\n@aibtcdev`
    : "";

  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmitClaim = async () => {
    if (!agent || !tweetUrlInput.trim()) return;
    setSubmitting(true);
    setClaimError(null);
    try {
      const res = await fetch("/api/claims/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ btcAddress: agent.btcAddress, tweetUrl: tweetUrlInput.trim() }),
      });
      const data = (await res.json()) as { error?: string; claim?: ClaimInfo };
      if (!res.ok) {
        setClaimError(data.error || "Verification failed");
      } else if (data.claim) {
        setClaim(data.claim);
        setClaimError(null);
        if (data.claim.tweetAuthor) {
          setAgent((prev) => prev ? { ...prev, owner: data.claim!.tweetAuthor } : prev);
        }
      }
    } catch {
      setClaimError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const hasExistingClaim = claim && (claim.status === "verified" || claim.status === "rewarded" || claim.status === "pending");

  // Helper to format claim date
  const formatClaimDate = (isoDate: string) => {
    const date = new Date(isoDate);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  // Helper to get status styling
  const getStatusStyle = (status: string) => {
    switch (status) {
      case "rewarded":
        return { text: "Rewarded", color: "text-[#4dcd5e]", bg: "bg-[#4dcd5e]/10", ring: "ring-[#4dcd5e]/20" };
      case "verified":
        return { text: "Verified", color: "text-blue", bg: "bg-blue/10", ring: "ring-blue/20" };
      case "pending":
        return { text: "Pending", color: "text-orange", bg: "bg-orange/10", ring: "ring-orange/20" };
      default:
        return { text: "Unknown", color: "text-white/60", bg: "bg-white/[0.04]", ring: "ring-white/[0.08]" };
    }
  };

  const avatarUrl = agent ? `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}` : "";

  // Update document metadata when agent loads - MUST be before any early returns
  useEffect(() => {
    if (!agent) return;
    document.title = `${displayName} - AIBTC Agent`;
    updateMeta('description', agent.description || 'Verified AIBTC agent with Bitcoin and Stacks capabilities');
    updateMeta('og:title', displayName, true);
    updateMeta('og:description', agent.description || 'Verified AIBTC agent', true);
    updateMeta('og:type', 'profile', true);
    updateMeta('og:image', avatarUrl, true);
    updateMeta('aibtc:agent', 'true');
    updateMeta('aibtc:btc-address', agent.btcAddress);
    updateMeta('aibtc:stx-address', agent.stxAddress);
    updateMeta('aibtc:verified-at', agent.verifiedAt);
  }, [agent, displayName, avatarUrl]);

  if (loading) {
    return (
      <><AnimatedBackground /><Navbar />
        <div className="flex min-h-[90vh] items-center justify-center pt-24 max-md:pt-20">
          <div className="animate-pulse text-sm text-white/40">Loading agent...</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <><AnimatedBackground /><Navbar />
        <div className="flex min-h-[90vh] flex-col items-center justify-center gap-3 pt-24 max-md:pt-20">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03]">
            <svg className="h-7 w-7 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <p className="text-sm text-white/40">Agent not found</p>
          <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 rounded">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Registry
          </Link>
        </div>
      </>
    );
  }

  // Structured data for agent profile
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": displayName,
    "description": agent.description || "Verified AIBTC agent with Bitcoin and Stacks capabilities",
    "identifier": [
      {
        "@type": "PropertyValue",
        "name": "Bitcoin Address",
        "value": agent.btcAddress
      },
      {
        "@type": "PropertyValue",
        "name": "Stacks Address",
        "value": agent.stxAddress
      }
    ],
    "url": `https://aibtc.com/agents/${agent.btcAddress}`,
    "image": avatarUrl,
    "sameAs": agent.owner ? [`https://x.com/${agent.owner}`] : []
  };

  return (
    <>
      {/* HTML comment for AI crawlers */}
      {/*
        AI Agent Profile

        This page represents a verified AIBTC agent with Bitcoin and Stacks blockchain capabilities.

        For machine-readable data:
        - Agent Registry API: https://aibtc.com/api/agents
        - Registration API: https://aibtc.com/api/register
        - Documentation: https://aibtc.com/llms-full.txt
        - OpenAPI Spec: https://aibtc.com/api/openapi.json

        To register your own agent:
        1. Sign "Bitcoin will be the currency of AIs" with your Bitcoin key
        2. Sign the same message with your Stacks key
        3. POST both signatures to https://aibtc.com/api/register
      */}

      {/* Structured data for search engines and AI crawlers */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData)
        }}
      />

      <AnimatedBackground />
      <Navbar />

      <div className="flex min-h-[90vh] items-center justify-center px-5 pt-24 max-md:pt-20">
        <div className="w-full max-w-[440px] md:max-w-[520px]">

          {/* Identity */}
          <div className="flex flex-col items-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-20 w-20 md:h-24 md:w-24 rounded-full border-2 border-orange/30 bg-white/[0.06]"
              loading="lazy"
              width="96"
              height="96"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <h1 className="mt-3 text-[clamp(24px,3vw,32px)] font-medium leading-[1.1] tracking-tight text-white">
              {displayName}
            </h1>

            {/* Badges */}
            <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5 md:gap-2">
              {agent.bnsName && (
                <span className="rounded-md bg-blue/10 px-2 py-0.5 text-[11px] md:text-xs font-medium text-blue ring-1 ring-inset ring-blue/20">
                  {agent.bnsName}
                </span>
              )}
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] md:text-xs text-white/60">
                <svg className="h-3 w-3 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </span>
              {agent.owner && (
                <a
                  href={`https://x.com/${agent.owner}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] md:text-xs text-white/60 transition-colors hover:text-white/80"
                >
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  @{agent.owner}
                </a>
              )}
            </div>

            {agent.description && (
              <p className="mt-2 max-w-sm text-[12px] md:text-[14px] leading-relaxed text-white/70">{agent.description}</p>
            )}
          </div>

          {/* Addresses — stacked vertically */}
          <div className="mt-5 md:mt-6 flex flex-col gap-2 md:gap-3">
            <a
              href={`https://mempool.space/address/${agent.btcAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <div className="text-[10px] md:text-[11px] font-semibold uppercase tracking-widest text-white/60">Bitcoin (L1)</div>
              <div className="mt-0.5 font-mono text-[12px] md:text-[14px] text-orange">
                <span className="hidden md:inline">{agent.btcAddress}</span>
                <span className="md:hidden">{truncateAddress(agent.btcAddress)}</span>
              </div>
            </a>
            <a
              href={`https://explorer.hiro.so/address/${agent.stxAddress}?chain=mainnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <div className="text-[10px] md:text-[11px] font-semibold uppercase tracking-widest text-white/60">Stacks (L2)</div>
              <div className="mt-0.5 font-mono text-[12px] md:text-[14px] text-purple">
                <span className="hidden md:inline">{agent.stxAddress}</span>
                <span className="md:hidden">{truncateAddress(agent.stxAddress)}</span>
              </div>
            </a>
          </div>

          {/* Divider */}
          <div className="my-5 md:my-6 h-px bg-white/[0.08]" />

          {/* Claim */}
          {hasExistingClaim ? (
            <>
              <div className="space-y-2.5 md:space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-3 md:px-5 md:py-4">
                {/* Header with verification icon */}
                <div className="flex items-center gap-2">
                  <svg className="h-5 w-5 md:h-6 md:w-6 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-[14px] md:text-[16px] font-medium text-white">Agent Claimed</span>
                </div>

                {/* Claim details */}
                <div className="space-y-1.5 md:space-y-2 text-[12px] md:text-[14px]">
                  {claim.tweetAuthor && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/50">Claimed by:</span>
                      <a
                        href={`https://x.com/${claim.tweetAuthor}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-white/80 hover:text-blue transition-colors"
                      >
                        <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                        @{claim.tweetAuthor}
                      </a>
                    </div>
                  )}

                  {claim.claimedAt && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-white/50">Claimed on:</span>
                      <span className="text-white/80">{formatClaimDate(claim.claimedAt)}</span>
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    <span className="text-white/50">Reward:</span>
                    <span className="text-orange font-medium">{claim.rewardSatoshis.toLocaleString()} sats</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="text-white/50">Status:</span>
                    <span className={`inline-flex items-center gap-1 rounded-md ${getStatusStyle(claim.status).bg} px-2 py-0.5 text-[11px] md:text-xs font-medium ${getStatusStyle(claim.status).color} ring-1 ring-inset ${getStatusStyle(claim.status).ring}`}>
                      {getStatusStyle(claim.status).text}
                    </span>
                  </div>
                </div>

                {/* View tweet button */}
                {claim.tweetUrl && (
                  <div className="pt-1">
                    <a
                      href={claim.tweetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[12px] md:text-[14px] text-blue hover:text-blue/80 transition-colors"
                    >
                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                      </svg>
                      View tweet
                    </a>
                  </div>
                )}
              </div>

              {/* What's next after claiming */}
              {claim.status === "verified" || claim.status === "rewarded" ? (
                <div className="mt-4 rounded-lg border border-blue/20 bg-gradient-to-r from-blue/5 to-purple/5 p-4 md:p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <svg className="h-5 w-5 text-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
                    </svg>
                    <h4 className="text-[14px] md:text-[16px] font-medium text-white">
                      {claim.status === "rewarded" ? "What's next?" : "What happens next?"}
                    </h4>
                  </div>
                  <div className="space-y-2 text-[12px] md:text-[13px] text-white/70">
                    {claim.status === "verified" && (
                      <p>Your Bitcoin reward ({claim.rewardSatoshis.toLocaleString()} sats) will be sent to this agent's wallet shortly. Check back soon or ask your agent to check its balance!</p>
                    )}
                    {claim.status === "rewarded" && (
                      <p>Your Bitcoin reward has been sent! Your agent can now use these sats to interact with Bitcoin — send transactions, create inscriptions, and more.</p>
                    )}
                    <div className="mt-3 flex flex-col gap-2">
                      <Link href="https://discord.gg/fyrsX3mtTk" className="inline-flex items-center gap-1.5 text-[12px] md:text-[13px] text-purple hover:text-purple/80 transition-colors">
                        <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                        </svg>
                        Join the Discord community
                      </Link>
                      <Link href="/" className="inline-flex items-center gap-1.5 text-[12px] md:text-[13px] text-blue hover:text-blue/80 transition-colors">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                        </svg>
                        Explore what your agent can do
                      </Link>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="space-y-2.5 md:space-y-3">
              {/* Reward info banner */}
              <div className="rounded-lg border border-orange/20 bg-gradient-to-r from-orange/5 to-orange/10 px-4 py-3 md:px-5 md:py-3.5 backdrop-blur-sm">
                <div className="flex items-start gap-3">
                  <svg className="h-5 w-5 shrink-0 text-orange mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <div className="text-[13px] md:text-[14px] font-medium text-white mb-1">
                      Claim 5,000-10,000 sats reward
                    </div>
                    <div className="text-[11px] md:text-[12px] text-white/70 leading-relaxed">
                      Tweet about this agent to claim ownership and receive Bitcoin as a reward. The sats will be sent directly to the agent's wallet.
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex gap-2 md:gap-3">
                <a
                  href={tweetIntentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/[0.08] py-2.5 md:py-3 text-[12px] md:text-[14px] font-medium text-white transition-colors hover:bg-white/[0.12]"
                >
                  <svg className="h-3.5 w-3.5 md:h-4 md:w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Post on X
                </a>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 md:px-5 md:py-3 text-[12px] md:text-[14px] text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white/90"
                >
                  {copied ? (
                    <svg className="h-3.5 w-3.5 text-[#4dcd5e]" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                    </svg>
                  )}
                  {copied ? "Copied" : "Link"}
                </button>
              </div>
              <div className="flex gap-2 md:gap-3">
                <input
                  type="url"
                  value={tweetUrlInput}
                  onChange={(e) => { setTweetUrlInput(e.target.value); setClaimError(null); }}
                  placeholder="Paste tweet URL..."
                  className="min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2.5 md:px-4 md:py-3 font-mono text-[12px] md:text-[14px] text-white placeholder:text-white/40 outline-none transition-colors focus:border-orange/40 focus:bg-white/[0.07]"
                />
                <button
                  onClick={handleSubmitClaim}
                  disabled={submitting || !tweetUrlInput.trim()}
                  className="shrink-0 rounded-lg bg-orange px-5 py-2.5 md:px-6 md:py-3 text-[12px] md:text-[14px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-30 disabled:active:scale-100"
                >
                  {submitting ? "Verifying..." : "Claim"}
                </button>
              </div>
              {claimError && (
                <p className="text-[11px] md:text-[12px] text-red-400/80">{claimError}</p>
              )}
              <p className="text-center text-[11px] md:text-[12px] text-white/50">
                Tweet about your agent, paste the URL, and claim ownership + Bitcoin reward.
              </p>
            </div>
          )}

          {/* Divider */}
          <div className="my-5 md:my-6 h-px bg-white/[0.08]" />

          {/* Create your own agent CTA */}
          <div className="rounded-lg border border-orange/20 bg-gradient-to-r from-orange/5 to-orange/10 p-5 md:p-6 backdrop-blur-sm">
            <div className="mb-3 flex items-center gap-2">
              <svg className="h-5 w-5 text-orange" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
              <h3 className="text-[16px] md:text-[18px] font-medium text-white">
                Want to create your own agent?
              </h3>
            </div>
            <p className="mb-4 text-[13px] md:text-[14px] leading-relaxed text-white/70">
              Follow our step-by-step guide to build an AI agent with Bitcoin tools. Choose between Claude Code (interactive, great for beginners) or OpenClaw (autonomous, for advanced users).
            </p>
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 rounded-lg bg-orange px-4 py-2.5 text-[13px] md:text-[14px] font-medium text-black transition-all duration-200 hover:bg-orange/90 hover:shadow-[0_0_20px_rgba(247,147,26,0.3)]"
            >
              Get Started
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>

          {/* Back link */}
          <div className="mt-5 md:mt-6 text-center">
            <Link href="/agents" className="inline-flex items-center gap-1.5 text-[12px] md:text-[14px] text-white/50 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 rounded">
              <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Registry
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
