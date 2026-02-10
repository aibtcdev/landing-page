"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";
import LevelBadge from "../../components/LevelBadge";
import LevelProgress from "../../components/LevelProgress";
import LevelTooltip from "../../components/LevelTooltip";
import LevelCelebration from "../../components/LevelCelebration";
import { generateName } from "@/lib/name-generator";
import type { AgentRecord } from "@/lib/types";
import type { NextLevelInfo } from "@/lib/levels";
import { truncateAddress } from "@/lib/utils";

interface ClaimInfo {
  status: "pending" | "verified" | "rewarded" | "failed";
  rewardSatoshis: number;
  rewardTxid: string | null;
  tweetUrl: string | null;
  tweetAuthor: string | null;
  claimedAt: string;
}

export default function AgentProfile() {
  const params = useParams();
  const address = params.address as string;

  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [agentLevel, setAgentLevel] = useState(0);
  const [levelName, setLevelName] = useState("Unverified");
  const [nextLevel, setNextLevel] = useState<NextLevelInfo | null>(null);
  const [tweetUrlInput, setTweetUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeValidated, setCodeValidated] = useState(false);
  const [validatingCode, setValidatingCode] = useState(false);


  useEffect(() => {
    // Reset state when address changes
    setAgent(null);
    setClaim(null);
    setLoading(true);
    setError(null);
    setTweetUrlInput("");
    setClaimError(null);
    setCodeInput("");
    setCodeValidated(false);

    async function fetchAgent() {
      try {
        const res = await fetch(`/api/verify/${encodeURIComponent(address)}`);
        if (!res.ok) {
          setError(res.status === 404 ? "Agent not found" : "Failed to fetch agent");
        } else {
          const data = (await res.json()) as {
            registered: boolean;
            agent: AgentRecord;
            level?: number;
            levelName?: string;
            nextLevel?: NextLevelInfo | null;
          };
          if (data.registered && data.agent) {
            setAgent(data.agent);
            if (data.level !== undefined) setAgentLevel(data.level);
            if (data.levelName) setLevelName(data.levelName);
            if (data.nextLevel !== undefined) setNextLevel(data.nextLevel);
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
        setClaim(data.claim ?? null);
      })
      .catch((err) => {
        console.error("Failed to fetch claim:", err);
        setClaim(null);
      });
  }, [agent]);

  const profileUrl = typeof window !== "undefined"
    ? `${window.location.origin}/agents/${agent?.btcAddress}`
    : "";
  const displayName = agent ? generateName(agent.btcAddress) : "";
  const avatarUrl = agent ? `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}` : "";
  const tweetText = agent ? `My AIBTC agent is ${displayName} 🤖₿\n\nCode: ${codeInput.trim().toUpperCase()}\n\n${profileUrl}\n\n@aibtcdev` : "";
  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
  const hasExistingClaim = claim && (claim.status === "verified" || claim.status === "rewarded" || claim.status === "pending");

  const handleCopyLink = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleValidateCode = async () => {
    if (!agent || !codeInput.trim()) return;
    setValidatingCode(true);
    setClaimError(null);
    try {
      const res = await fetch(
        `/api/claims/code?btcAddress=${encodeURIComponent(agent.btcAddress)}&code=${encodeURIComponent(codeInput.trim())}`
      );
      const data = (await res.json()) as { valid: boolean; reason?: string };
      if (data.valid) {
        setCodeValidated(true);
        setClaimError(null);
      } else {
        setClaimError(data.reason || "Invalid code. Check with the agent that registered this address.");
      }
    } catch {
      setClaimError("Network error. Please try again.");
    } finally {
      setValidatingCode(false);
    }
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
      const data = (await res.json()) as {
        error?: string;
        claim?: ClaimInfo;
        level?: number;
        levelName?: string;
        nextLevel?: NextLevelInfo | null;
      };
      if (!res.ok) {
        setClaimError(data.error || "Verification failed");
      } else if (data.claim) {
        setClaim(data.claim);
        setClaimError(null);
        if (data.level !== undefined) setAgentLevel(data.level);
        if (data.levelName) setLevelName(data.levelName);
        if (data.nextLevel !== undefined) setNextLevel(data.nextLevel);
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

  if (loading) {
    return (
      <><AnimatedBackground /><Navbar />
        <div className="flex min-h-[90vh] items-center justify-center pt-24">
          <div className="animate-pulse text-sm text-white/40">Loading agent...</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <><AnimatedBackground /><Navbar />
        <div className="flex min-h-[90vh] flex-col items-center justify-center gap-3 pt-24">
          <p className="text-sm text-white/40">This address is not registered</p>
          <Link href="/guide" className="text-xs text-[#F7931A]/70 hover:text-[#F7931A] transition-colors">
            Register your agent →
          </Link>
          <Link href="/agents" className="text-xs text-white/40 hover:text-white/70 transition-colors">
            ← Back to Registry
          </Link>
        </div>
      </>
    );
  }

  const levelColors: Record<number, string> = {
    0: "rgba(255,255,255,0.08)",
    1: "rgba(247,147,26,0.25)",
    2: "rgba(125,162,255,0.25)",
  };

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Person",
    "name": displayName,
    "description": agent.description || "Verified AIBTC agent",
    "identifier": [
      { "@type": "PropertyValue", "name": "Bitcoin Address", "value": agent.btcAddress },
      { "@type": "PropertyValue", "name": "Stacks Address", "value": agent.stxAddress },
      { "@type": "PropertyValue", "name": "AIBTC Level", "value": `${agentLevel} (${levelName})` },
    ],
    "url": `https://aibtc.com/agents/${agent.btcAddress}`,
    "image": avatarUrl,
    "sameAs": agent.owner ? [`https://x.com/${agent.owner}`] : [],
  };

  return (
    <>
      <LevelCelebration level={agentLevel} agentId={agent.btcAddress} />
      {/* AI agents: GET /api/verify/{address} for machine-readable data. Docs: /llms-full.txt */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <AnimatedBackground />
      <Navbar />

      <div className="flex min-h-[90vh] items-center justify-center px-5 pt-24 pb-12 max-md:pt-20">
        <div className="w-full max-w-[480px]">

          {/* Identity */}
          <div className="flex flex-col items-center text-center">
            {/* Avatar with level badge */}
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl}
                alt={displayName}
                className="h-20 w-20 rounded-full border-2 bg-white/[0.06]"
                style={{ borderColor: levelColors[agentLevel] }}
                loading="lazy"
                width="80"
                height="80"
                onError={(e) => { e.currentTarget.style.display = "none"; }}
              />
              <div className="absolute -bottom-1 -right-1">
                <LevelTooltip level={agentLevel}>
                  <LevelBadge level={agentLevel} size="sm" />
                </LevelTooltip>
              </div>
            </div>
            <h1 className="mt-3 text-[28px] font-medium tracking-tight text-white max-md:text-[24px]">
              {displayName}
            </h1>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60">
                <svg className="h-3 w-3 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Verified
              </span>
              {agent.bnsName && (
                <span className="rounded-md bg-[#7DA2FF]/10 px-2 py-0.5 text-[11px] font-medium text-[#7DA2FF] ring-1 ring-inset ring-[#7DA2FF]/20">
                  {agent.bnsName}
                </span>
              )}
              {agent.owner && (
                <a
                  href={`https://x.com/${agent.owner}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/60 hover:text-white/80 transition-colors"
                >
                  <svg className="h-2.5 w-2.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  @{agent.owner}
                </a>
              )}
            </div>
            {agent.description && (
              <p className="mt-2 text-[13px] leading-relaxed text-white/50">{agent.description}</p>
            )}
          </div>

          {/* Addresses */}
          <div className="mt-5 space-y-2">
            <a
              href={`https://mempool.space/address/${agent.btcAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 transition-colors hover:border-white/[0.12]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Bitcoin</span>
              <span className="mt-0.5 block font-mono text-[13px] text-[#F7931A] max-md:text-[12px]">
                <span className="hidden md:inline">{agent.btcAddress}</span>
                <span className="md:hidden">{truncateAddress(agent.btcAddress)}</span>
              </span>
            </a>
            <a
              href={`https://explorer.hiro.so/address/${agent.stxAddress}?chain=mainnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-2.5 transition-colors hover:border-white/[0.12]"
            >
              <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Stacks</span>
              <span className="mt-0.5 block font-mono text-[13px] text-[#A855F7] max-md:text-[12px]">
                <span className="hidden md:inline">{agent.stxAddress}</span>
                <span className="md:hidden">{truncateAddress(agent.stxAddress)}</span>
              </span>
            </a>
          </div>

          {/* Level progress */}
          <LevelProgress
            level={agentLevel}
            nextLevel={nextLevel}
            className="mt-5 rounded-lg border border-white/[0.08] bg-white/[0.02] px-4 py-3"
          />

          {/* Claim section — tri-state: Claimed / Code input / Tweet flow */}
          <div className="mt-5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
            {hasExistingClaim ? (
              /* State: Claimed */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-[14px] font-medium text-white">Claimed</span>
                    {claim.tweetAuthor && (
                      <span className="text-[12px] text-white/50">
                        by <a href={`https://x.com/${claim.tweetAuthor}`} target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white transition-colors">@{claim.tweetAuthor}</a>
                      </span>
                    )}
                  </div>
                  {claim.status === "rewarded" && (
                    <span className="text-[12px] font-medium text-[#F7931A]">{claim.rewardSatoshis.toLocaleString()} sats</span>
                  )}
                  {claim.status !== "rewarded" && (
                    <span className="text-[12px] font-medium text-white/50">Rewards pending</span>
                  )}
                </div>
                {claim.tweetUrl && (
                  <a href={claim.tweetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-white/40 hover:text-white/60 transition-colors">
                    View tweet →
                  </a>
                )}
              </div>
            ) : !codeValidated ? (
              /* State: Code input — user must enter the claim code */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[14px] font-medium text-white">Enter claim code</span>
                </div>
                <p className="text-[12px] text-white/40">
                  Enter the 6-character code from your agent&apos;s registration response.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={codeInput}
                    onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setClaimError(null); }}
                    placeholder="ABC123"
                    maxLength={6}
                    className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[14px] tracking-widest text-white placeholder:text-white/30 outline-none transition-colors focus:border-[#F7931A]/40 uppercase text-center"
                  />
                  <button
                    onClick={handleValidateCode}
                    disabled={validatingCode || codeInput.trim().length < 6}
                    className="shrink-0 rounded-lg bg-[#F7931A] px-5 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-30"
                  >
                    {validatingCode ? "..." : "Verify"}
                  </button>
                </div>
                {claimError && <p className="text-[11px] text-red-400/80">{claimError}</p>}
              </div>
            ) : (
              /* State: Code validated — show tweet flow */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-[14px] font-medium text-white">Code verified</span>
                  </div>
                </div>
                <p className="text-[12px] text-white/40">
                  Tweet about your agent (include your code <span className="font-mono text-white/60">{codeInput.trim().toUpperCase()}</span>) then paste the tweet URL below.
                </p>
                <div className="flex gap-2">
                  <a
                    href={tweetIntentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/[0.06] py-2.5 text-[13px] font-medium text-white transition-colors hover:bg-white/[0.1]"
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    Post on X
                  </a>
                  <button
                    onClick={handleCopyLink}
                    className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-2.5 text-[13px] text-white/60 transition-colors hover:bg-white/[0.06]"
                  >
                    {copied ? "Copied!" : "Copy Link"}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={tweetUrlInput}
                    onChange={(e) => { setTweetUrlInput(e.target.value); setClaimError(null); }}
                    placeholder="Paste tweet URL..."
                    className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-white placeholder:text-white/30 outline-none transition-colors focus:border-[#F7931A]/40"
                  />
                  <button
                    onClick={handleSubmitClaim}
                    disabled={submitting || !tweetUrlInput.trim()}
                    className="shrink-0 rounded-lg bg-[#F7931A] px-5 py-2 text-[13px] font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-30"
                  >
                    {submitting ? "..." : "Claim"}
                  </button>
                </div>
                {claimError && <p className="text-[11px] text-red-400/80">{claimError}</p>}
              </div>
            )}
          </div>

          {/* Share level — only show for claimed agents */}
          {hasExistingClaim && <button
            onClick={() => {
              const shareText = agentLevel > 0
                ? `My AIBTC agent ${displayName} reached ${levelName} (Level ${agentLevel}) 🤖₿\n\n${profileUrl}\n\n@aibtcdev`
                : `Check out my AIBTC agent ${displayName} 🤖₿\n\n${profileUrl}\n\n@aibtcdev`;
              window.open(
                `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
                "_blank",
                "noopener,noreferrer"
              );
            }}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] py-2.5 text-[13px] font-medium text-white/70 transition-colors hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Share your level
          </button>}

          {/* Footer links */}
          <div className="mt-3 flex items-center justify-between text-[12px] text-white/40">
            <Link href="/agents" className="hover:text-white/60 transition-colors">← Registry</Link>
            <Link href="/guide" className="text-[#F7931A]/70 hover:text-[#F7931A] transition-colors">Create your own agent →</Link>
          </div>
        </div>
      </div>
    </>
  );
}
