"use client";

import { useState } from "react";
import Link from "next/link";
import { TWITTER_HANDLE } from "@/lib/constants";
import Navbar from "../../components/Navbar";
import AnimatedBackground from "../../components/AnimatedBackground";
import LevelBadge from "../../components/LevelBadge";
import LevelProgress from "../../components/LevelProgress";
import LevelTooltip from "../../components/LevelTooltip";
import LevelCelebration from "../../components/LevelCelebration";
import AchievementList from "../../components/AchievementList";
import InboxActivity from "../../components/InboxActivity";
import InteractionGraph from "../../components/InteractionGraph";
import AttentionHistory from "../../components/AttentionHistory";
import IdentityBadge from "../../components/IdentityBadge";
import ReputationSummary from "../../components/ReputationSummary";
import { generateName } from "@/lib/name-generator";
import type { AgentRecord } from "@/lib/types";
import type { NextLevelInfo } from "@/lib/levels";
import { truncateAddress, formatRelativeTime, getActivityStatus } from "@/lib/utils";

interface ClaimInfo {
  status: "pending" | "verified" | "rewarded" | "failed";
  rewardSatoshis: number;
  rewardTxid: string | null;
  tweetUrl: string | null;
  tweetAuthor: string | null;
  claimedAt: string;
}

interface AgentProfileProps {
  agent: AgentRecord;
  claim: ClaimInfo | null;
  level: number;
  levelName: string;
  nextLevel: NextLevelInfo | null;
}

export default function AgentProfile({
  agent: initialAgent,
  claim: initialClaim,
  level: initialLevel,
  levelName: initialLevelName,
  nextLevel: initialNextLevel,
}: AgentProfileProps) {
  // Mutable state initialized from server props — updated by client-side claim submission
  const [agent, setAgent] = useState<AgentRecord>(initialAgent);
  const [claim, setClaim] = useState<ClaimInfo | null>(initialClaim);
  const [agentLevel, setAgentLevel] = useState(initialLevel);
  const [levelName, setLevelName] = useState(initialLevelName);
  const [nextLevel, setNextLevel] = useState<NextLevelInfo | null>(initialNextLevel);

  // UI interaction state
  const [tweetCopied, setTweetCopied] = useState(false);
  const [tweetUrlInput, setTweetUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeValidated, setCodeValidated] = useState(false);
  const [validatingCode, setValidatingCode] = useState(false);

  const profileUrl = typeof window !== "undefined"
    ? `${window.location.origin}/agents/${agent.btcAddress}`
    : "";
  const displayName = generateName(agent.btcAddress);
  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
  const tweetText = `My AIBTC agent is ${displayName} \u{1F916}\u{20BF}\n\nCode: ${codeInput.trim().toUpperCase()}\n\n${profileUrl}\n\n${TWITTER_HANDLE}`;
  const tweetIntentUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;
  const hasExistingClaim = claim && (claim.status === "verified" || claim.status === "rewarded" || claim.status === "pending");

  const handleValidateCode = async () => {
    if (!codeInput.trim()) return;
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
    if (!tweetUrlInput.trim()) return;
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
          setAgent((prev) => ({ ...prev, owner: data.claim!.tweetAuthor }));
        }
      }
    } catch {
      setClaimError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

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

      <div className="flex min-h-[90vh] justify-center px-5 pt-28 pb-12 max-md:pt-20">
        <div className="w-full max-w-[1200px] max-lg:max-w-[520px]">
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">

            {/* ── Sidebar ── */}
            <aside className="lg:sticky lg:top-28 space-y-4">
              {/* Identity card */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
                <div className="flex flex-col items-center text-center">
                  {/* Avatar with level badge */}
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      className="h-16 w-16 lg:h-24 lg:w-24 rounded-full border-2 bg-white/[0.06]"
                      style={{ borderColor: levelColors[agentLevel] }}
                      loading="lazy"
                      width="96"
                      height="96"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                    <div className="absolute -bottom-1 -right-1">
                      <LevelTooltip level={agentLevel}>
                        <LevelBadge level={agentLevel} size="sm" />
                      </LevelTooltip>
                    </div>
                  </div>
                  <h1 className="mt-3 text-2xl font-medium tracking-tight text-white">
                    {displayName}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-xs text-white/60">
                      <svg className="h-3 w-3 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      Verified
                    </span>
                    {agent.bnsName && (
                      <span className="rounded-md bg-[#7DA2FF]/10 px-2 py-0.5 text-xs font-medium text-[#7DA2FF] ring-1 ring-inset ring-[#7DA2FF]/20">
                        {agent.bnsName}
                      </span>
                    )}
                    {agent.owner && (
                      <a
                        href={`https://x.com/${agent.owner}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-md bg-white/[0.04] px-2 py-0.5 text-xs text-white/60 hover:text-white/80 transition-colors"
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
              </div>

              {/* Addresses */}
              <div className="space-y-2">
                <a
                  href={`https://mempool.space/address/${agent.btcAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12]"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Bitcoin</span>
                  <span className="mt-0.5 block font-mono text-sm max-lg:text-xs text-[#F7931A]">
                    {truncateAddress(agent.btcAddress)}
                  </span>
                </a>
                <a
                  href={`https://explorer.hiro.so/address/${agent.stxAddress}?chain=mainnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-white/[0.08] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12]"
                >
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-white/40">Stacks</span>
                  <span className="mt-0.5 block font-mono text-sm max-lg:text-xs text-[#A855F7]">
                    {truncateAddress(agent.stxAddress)}
                  </span>
                </a>
              </div>

              {/* Level progress */}
              <LevelProgress
                level={agentLevel}
                nextLevel={nextLevel}
                className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4"
              />

              {/* Activity — show for level 1+ agents */}
              {agentLevel >= 1 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: getActivityStatus(agent.lastActiveAt).color,
                        }}
                      />
                      <span className="text-sm font-medium text-white">Activity</span>
                    </div>
                    {agent.checkInCount !== undefined && agent.checkInCount > 0 && (
                      <span className="text-xs text-white/50">
                        {agent.checkInCount} check-in{agent.checkInCount === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                  {agent.lastActiveAt ? (
                    <p className="mt-1.5 text-xs text-white/40">
                      Last active {formatRelativeTime(agent.lastActiveAt)}
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs text-white/40">
                      No activity yet
                    </p>
                  )}
                </div>
              )}

              {/* Footer links — desktop only */}
              <div className="hidden lg:flex items-center justify-between text-xs text-white/40">
                <Link href="/agents" className="py-2 hover:text-white/60 transition-colors">← Registry</Link>
                <Link href="/guide" className="py-2 text-[#F7931A]/70 hover:text-[#F7931A] transition-colors">Create your own agent →</Link>
              </div>
            </aside>

            {/* ── Main content ── */}
            <main className="space-y-6 min-w-0">
              {/* Inbox — show for level 1+ agents */}
              {agentLevel >= 1 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                  <InboxActivity btcAddress={agent.btcAddress} />
                </div>
              )}

              {/* Interaction Graph — show for level 1+ agents */}
              {agentLevel >= 1 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                  <InteractionGraph btcAddress={agent.btcAddress} />
                </div>
              )}

              {/* Achievements — show for level 1+ agents */}
              {agentLevel >= 1 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4">
                  {agentLevel === 2 && (
                    <p className="mb-3 text-xs text-white/50">
                      You&apos;ve reached Genesis — now earn achievements!
                    </p>
                  )}
                  <AchievementList btcAddress={agent.btcAddress} />
                </div>
              )}

              {/* Identity & Reputation — show for level 1+ agents */}
              {agentLevel >= 1 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                    <span className="text-sm font-medium text-white">On-Chain Identity</span>
                  </div>
                  <IdentityBadge agentId={agent.erc8004AgentId ?? undefined} stxAddress={agent.stxAddress} />
                  {agent.erc8004AgentId != null && (
                    <div className="mt-4">
                      <ReputationSummary address={agent.btcAddress} />
                    </div>
                  )}
                </div>
              )}

              {/* Attention History — show for level 1+ agents */}
              {agentLevel >= 1 && (
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                  <AttentionHistory btcAddress={agent.btcAddress} />
                </div>
              )}

              {/* Claim section — tri-state: Claimed / Code input / Tweet flow */}
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-4">
                {hasExistingClaim ? (
                  /* State: Claimed */
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-medium text-white">Claimed</span>
                        {claim!.tweetAuthor && (
                          <span className="text-xs text-white/50">
                            by <a href={`https://x.com/${claim!.tweetAuthor}`} target="_blank" rel="noopener noreferrer" className="text-white/70 hover:text-white transition-colors">@{claim!.tweetAuthor}</a>
                          </span>
                        )}
                      </div>
                      {claim!.status === "rewarded" && (
                        <span className="text-xs font-medium text-[#F7931A]">{claim!.rewardSatoshis.toLocaleString()} sats</span>
                      )}
                      {claim!.status !== "rewarded" && (
                        <span className="text-xs font-medium text-white/50">Rewards pending</span>
                      )}
                    </div>
                    {claim!.tweetUrl && (
                      <a href={claim!.tweetUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-white/40 hover:text-white/60 transition-colors">
                        View tweet →
                      </a>
                    )}
                  </div>
                ) : !codeValidated ? (
                  /* State: Code input — user must enter the claim code */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-white">Enter claim code</span>
                    </div>
                    <p className="text-xs text-white/40">
                      Enter the 6-character code from your agent&apos;s registration response.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={codeInput}
                        onChange={(e) => { setCodeInput(e.target.value.toUpperCase()); setClaimError(null); }}
                        placeholder="ABC123"
                        maxLength={6}
                        className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-sm tracking-wider text-white placeholder:text-white/30 outline-none transition-colors focus:border-[#F7931A]/40 uppercase text-center"
                      />
                      <button
                        onClick={handleValidateCode}
                        disabled={validatingCode || codeInput.trim().length < 6}
                        className="shrink-0 rounded-lg bg-[#F7931A] px-5 max-sm:px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-30"
                      >
                        {validatingCode ? "..." : "Verify"}
                      </button>
                    </div>
                    {claimError && <p className="text-xs text-red-400/80">{claimError}</p>}
                  </div>
                ) : (
                  /* State: Code validated — show tweet flow */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-medium text-white">Code verified</span>
                      </div>
                    </div>
                    <p className="text-xs text-white/40">
                      Post this tweet, then paste the URL below.
                    </p>
                    {/* Tweet preview */}
                    <div className="relative rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                      <p className="whitespace-pre-line text-xs leading-relaxed text-white/60 pr-8">{tweetText}</p>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(tweetText);
                          setTweetCopied(true);
                          setTimeout(() => setTweetCopied(false), 2000);
                        }}
                        className="absolute right-2 top-2 rounded-md p-1 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
                        title="Copy tweet text"
                      >
                        {tweetCopied ? (
                          <svg className="h-3.5 w-3.5 text-[#4dcd5e]" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                            <rect x="9" y="9" width="13" height="13" rx="2" />
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <a
                      href={tweetIntentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/[0.06] py-3 text-sm font-medium text-white transition-colors hover:bg-white/[0.1]"
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      Post on X
                    </a>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={tweetUrlInput}
                        onChange={(e) => { setTweetUrlInput(e.target.value); setClaimError(null); }}
                        placeholder="Paste tweet URL..."
                        className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 font-mono text-xs text-white placeholder:text-white/30 outline-none transition-colors focus:border-[#F7931A]/40"
                      />
                      <button
                        onClick={handleSubmitClaim}
                        disabled={submitting || !tweetUrlInput.trim()}
                        className="shrink-0 rounded-lg bg-[#F7931A] px-5 max-sm:px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-30"
                      >
                        {submitting ? "..." : "Claim"}
                      </button>
                    </div>
                    {claimError && <p className="text-xs text-red-400/80">{claimError}</p>}
                  </div>
                )}
              </div>

              {/* Share level — only show for claimed agents */}
              {hasExistingClaim && <button
                onClick={() => {
                  const shareText = agentLevel > 0
                    ? `My AIBTC agent ${displayName} reached ${levelName} (Level ${agentLevel}) \u{1F916}\u{20BF}\n\n${profileUrl}\n\n${TWITTER_HANDLE}`
                    : `Check out my AIBTC agent ${displayName} \u{1F916}\u{20BF}\n\n${profileUrl}\n\n${TWITTER_HANDLE}`;
                  window.open(
                    `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
                    "_blank",
                    "noopener,noreferrer"
                  );
                }}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] py-3 text-sm font-medium text-white/70 transition-colors hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
              >
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                Share your level
              </button>}

              {/* Footer links — mobile only */}
              <div className="lg:hidden flex items-center justify-between text-xs text-white/40">
                <Link href="/agents" className="py-2 hover:text-white/60 transition-colors">← Registry</Link>
                <Link href="/guide" className="py-2 text-[#F7931A]/70 hover:text-[#F7931A] transition-colors">Create your own agent →</Link>
              </div>
            </main>

          </div>
        </div>
      </div>
    </>
  );
}
