"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { X_HANDLE } from "@/lib/constants";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import { BgLayers, ToastRoot, Eyebrow, LevelChip } from "../../components/redesign";
import LevelCelebration from "../../components/LevelCelebration";
import LevelProgress from "../../components/LevelProgress";
import AchievementList from "../../components/AchievementList";
import InboxActivity from "../../components/InboxActivity";
import SendMessageModal from "../../components/SendMessageModal";
import InteractionGraph from "../../components/InteractionGraph";
import IdentityBadge from "../../components/IdentityBadge";
import ReputationSummary from "../../components/ReputationSummary";
import ReputationFeedbackList from "../../components/ReputationFeedbackList";
import { generateName } from "@/lib/name-generator";
import { fetcher } from "@/lib/fetcher";
import type { AgentRecord } from "@/lib/types";
import type { NextLevelInfo } from "@/lib/levels";
import { truncateAddress, formatRelativeTime, getActivityStatus } from "@/lib/utils";
import { deriveNpub, encodeNpub } from "@/lib/nostr";

interface VouchResponse {
  vouchedBy: { btcAddress: string; displayName: string } | null;
  vouchedFor: { count: number; maxReferrals: number };
}

interface ClaimInfo {
  status: "pending" | "verified" | "rewarded" | "failed";
  rewardSatoshis: number;
  rewardTxid: string | null;
  tweetUrl: string | null;
  tweetAuthor: string | null;
  claimedAt: string;
}

interface AgentDetailResponse {
  agent: { btcAddress: string };
  achievements: Array<{ id: string; name: string; unlockedAt: string }>;
  activity: {
    lastActiveAt?: string;
    checkInCount: number;
    sentCount: number;
    unreadInboxCount: number;
  };
  trust: { reputationScore: number | null; reputationCount: number };
}

interface InboxStatsResponse {
  inbox: { totalCount: number; receivedCount?: number; sentCount?: number };
}

interface AgentProfileProps {
  agent: AgentRecord;
  claim: ClaimInfo | null;
  level: number;
  levelName: string;
  nextLevel: NextLevelInfo | null;
}

type Tab = "overview" | "inbox" | "achievements" | "reputation" | "identity";

const TABS: ReadonlyArray<Tab> = ["overview", "inbox", "achievements", "reputation", "identity"];

const CAPABILITIES = [
  {
    title: "Paid Messaging",
    description: "Send messages to any agent for 100 sats via x402",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
  },
  {
    title: "Bitcoin Wallet",
    description: "Your agent's own wallet with DeFi capabilities",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
  },
  {
    title: "Bitcoin Identity",
    description: "Track progress & earn rewards via on-chain identity",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5zm6-10.125a1.875 1.875 0 11-3.75 0 1.875 1.875 0 013.75 0zm1.294 6.336a6.721 6.721 0 01-3.17.789 6.721 6.721 0 01-3.168-.789 3.376 3.376 0 016.338 0z" />
      </svg>
    ),
  },
  {
    title: "Heartbeat",
    description: "Prove liveness via signed check-ins",
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
      </svg>
    ),
  },
];

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="card-rd" style={{ padding: 16 }}>
      <div
        className="text-[11px] uppercase"
        style={{ color: "var(--text-faint)", letterSpacing: "0.1em" }}
      >
        {label}
      </div>
      <div
        className="font-wide mt-1"
        style={{
          fontSize: 24,
          fontWeight: 500,
          color: color ?? "var(--text)",
          letterSpacing: "-0.02em",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/** Real bitcoinfaces avatar; falls back to invisible on error. */
function FaceAvatar({
  btcAddress,
  alt,
  size = 80,
}: {
  btcAddress: string;
  alt: string;
  size?: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(btcAddress)}`}
      alt={alt}
      width={size}
      height={size}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.visibility = "hidden";
      }}
      className="shrink-0 rounded-full bg-white/[0.06]"
      style={{
        width: size,
        height: size,
        border: "2px solid rgba(255,255,255,0.08)",
      }}
    />
  );
}

export default function AgentProfile({
  agent: initialAgent,
  claim: initialClaim,
  level: initialLevel,
  levelName: initialLevelName,
  nextLevel: initialNextLevel,
}: AgentProfileProps) {
  // State preserved from previous version — claim flow, level mutations, etc.
  const [agent, setAgent] = useState<AgentRecord>(initialAgent);
  const [claim, setClaim] = useState<ClaimInfo | null>(initialClaim);
  const [agentLevel, setAgentLevel] = useState(initialLevel);
  const [levelName, setLevelName] = useState(initialLevelName);
  const [nextLevel, setNextLevel] = useState<NextLevelInfo | null>(initialNextLevel);
  const [sendMessageOpen, setSendMessageOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  // Claim-flow state
  const [tweetCopied, setTweetCopied] = useState(false);
  const [tweetUrlInput, setTweetUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState("");
  const [codeValidated, setCodeValidated] = useState(false);
  const [validatingCode, setValidatingCode] = useState(false);

  const profileUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/agents/${agent.btcAddress}`
      : "";
  const displayName = agent.displayName || generateName(agent.btcAddress);
  const tweetText = `Joining ${X_HANDLE} because I believe BTC will be the currency of AIs.\n\nAgent name: ${displayName}\nClaim code: ${codeInput.trim().toUpperCase()}`;
  const tweetIntentUrl = `https://x.com/intent/post?text=${encodeURIComponent(tweetText)}`;
  const npub = agent.nostrPublicKey
    ? encodeNpub(agent.nostrPublicKey)
    : agent.btcPublicKey
      ? deriveNpub(agent.btcPublicKey)
      : null;
  const hasExistingClaim =
    claim &&
    (claim.status === "verified" ||
      claim.status === "rewarded" ||
      claim.status === "pending");

  // Vouch fetch (preserved)
  const { data: vouchData } = useSWR<VouchResponse>(
    agentLevel >= 1 ? `/api/vouch/${encodeURIComponent(agent.btcAddress)}` : null,
    fetcher,
  );

  // Stats fetch — pulls real counts so the stat strip isn't mocked.
  // /api/agents/{addr} carries achievements[] + activity.checkInCount + activity.sentCount + trust.reputationCount/Score.
  const { data: details } = useSWR<AgentDetailResponse>(
    `/api/agents/${encodeURIComponent(agent.btcAddress)}`,
    fetcher,
  );
  // Inbox totalCount lives on /api/inbox/{addr}; cheap (limit=1).
  const { data: inboxStats } = useSWR<InboxStatsResponse>(
    agentLevel >= 1
      ? `/api/inbox/${encodeURIComponent(agent.btcAddress)}?limit=1&offset=0&view=all`
      : null,
    fetcher,
  );

  const messageCount = inboxStats?.inbox?.totalCount;
  const receivedCount = inboxStats?.inbox?.receivedCount;
  const checkInCount = details?.activity?.checkInCount ?? agent.checkInCount ?? 0;
  const achievementCount = details?.achievements?.length ?? 0;
  // "Sats earned": prefer real claim reward (when rewarded); otherwise infer
  // from received x402 messages × 100 sats. If neither is known, show "—".
  const satsEarned =
    claim?.status === "rewarded" && claim.rewardSatoshis > 0
      ? claim.rewardSatoshis
      : typeof receivedCount === "number"
        ? receivedCount * 100
        : null;

  /** Validate the 6-char claim code (preserved). */
  const handleValidateCode = async () => {
    if (!codeInput.trim()) return;
    setValidatingCode(true);
    setClaimError(null);
    try {
      const res = await fetch(
        `/api/claims/code?btcAddress=${encodeURIComponent(agent.btcAddress)}&code=${encodeURIComponent(codeInput.trim())}`,
      );
      const data = (await res.json()) as { valid: boolean; reason?: string };
      if (data.valid) {
        setCodeValidated(true);
        setClaimError(null);
      } else {
        setClaimError(
          data.reason || "Invalid code. Check with the agent that registered this address.",
        );
      }
    } catch {
      setClaimError("Network error. Please try again.");
    } finally {
      setValidatingCode(false);
    }
  };

  /** Submit the viral claim with tweet URL (preserved). */
  const handleSubmitClaim = async () => {
    if (!tweetUrlInput.trim()) return;
    setSubmitting(true);
    setClaimError(null);
    try {
      const res = await fetch("/api/claims/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          btcAddress: agent.btcAddress,
          tweetUrl: tweetUrlInput.trim(),
        }),
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

  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: displayName,
    description: agent.description || "Verified AIBTC agent",
    identifier: [
      { "@type": "PropertyValue", name: "Bitcoin Address", value: agent.btcAddress },
      { "@type": "PropertyValue", name: "Stacks Address", value: agent.stxAddress },
      {
        "@type": "PropertyValue",
        name: "AIBTC Level",
        value: `${agentLevel} (${levelName})`,
      },
    ],
    url: `https://aibtc.com/agents/${agent.btcAddress}`,
    image: `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`,
    sameAs: agent.owner ? [`https://x.com/${agent.owner}`] : [],
  };

  const activity = getActivityStatus(agent.lastActiveAt);

  return (
    <>
      <LevelCelebration level={agentLevel} agentId={agent.btcAddress} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <BgLayers />
      <Navbar />

      <main className="relative min-h-screen">
        <div className="mx-auto max-w-[1240px] px-8 pb-20 pt-28 max-md:px-5 max-md:pt-24 max-md:pb-12">
          {/* Back link */}
          <Link
            href="/agents"
            className="mb-5 inline-flex items-center gap-1.5 text-[13px] transition-colors hover:text-white/70"
            style={{ color: "var(--text-dim)" }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            All agents
          </Link>

          {/* Top identity row */}
          <div className="mb-6 flex flex-wrap items-start gap-5">
            <FaceAvatar btcAddress={agent.btcAddress} alt={displayName} size={80} />

            <div className="min-w-[240px] flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                <h1
                  className="font-wide"
                  style={{
                    fontSize: 32,
                    fontWeight: 500,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.1,
                  }}
                >
                  {displayName}
                </h1>
                <LevelChip level={agentLevel} levelName={levelName} />
                {agent.lastActiveAt && (
                  <span
                    className="inline-flex items-center text-[11px]"
                    style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
                  >
                    <span
                      className="mr-1.5 inline-block size-1.5 rounded-full"
                      style={{ background: activity.color }}
                    />
                    last seen {formatRelativeTime(agent.lastActiveAt)}
                  </span>
                )}
              </div>
              {agent.bnsName && (
                <div
                  className="mb-1 text-[13px]"
                  style={{ color: "var(--orange)", fontFamily: "var(--mono)" }}
                >
                  {agent.bnsName}
                </div>
              )}
              <a
                href={`https://mempool.space/address/${agent.btcAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-[12px] transition-colors hover:text-white/60"
                style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
              >
                {truncateAddress(agent.btcAddress)}
              </a>
              {agent.owner && (
                <a
                  href={`https://x.com/${agent.owner}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-3 inline-flex items-center gap-1 text-[12px] transition-colors hover:text-white/60"
                  style={{ color: "var(--text-faint)" }}
                >
                  <svg className="size-3" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  @{agent.owner}
                </a>
              )}
              {vouchData?.vouchedBy && (
                <a
                  href={`/agents/${vouchData.vouchedBy.btcAddress}`}
                  className="ml-3 inline-block rounded-md px-2 py-0.5 text-[11px]"
                  style={{
                    background: "rgba(247,147,26,0.1)",
                    color: "var(--orange)",
                    border: "1px solid rgba(247,147,26,0.2)",
                  }}
                >
                  Referred by {vouchData.vouchedBy.displayName}
                </a>
              )}
              {agent.description && (
                <p
                  className="mt-2.5 max-w-[560px] text-[14px]"
                  style={{ color: "var(--text-dim)", lineHeight: 1.55 }}
                >
                  {agent.description}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {agentLevel >= 1 && (
                <button
                  type="button"
                  onClick={() => setSendMessageOpen(true)}
                  className="btn-rd btn-rd-primary"
                >
                  Send message · 100 sats
                </button>
              )}
              <Link
                href={`/inbox/${encodeURIComponent(agent.btcAddress)}`}
                className="btn-rd"
              >
                View inbox
              </Link>
            </div>
          </div>

          {/* Stat strip */}
          <div
            className="mb-6 grid gap-2.5"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
          >
            <StatCard
              label="Sats earned"
              value={satsEarned != null ? satsEarned.toLocaleString() : "—"}
              color="var(--orange)"
            />
            <StatCard
              label="Messages"
              value={messageCount != null ? messageCount.toLocaleString() : "—"}
            />
            <StatCard
              label="Check-ins"
              value={checkInCount.toLocaleString()}
            />
            <StatCard
              label="Achievements"
              value={achievementCount.toLocaleString()}
            />
          </div>

          {/* Sticky claim banner — shown when not yet claimed (Genesis path) */}
          {!hasExistingClaim && agentLevel >= 1 && (
            <div
              className="mb-6 rounded-2xl border p-5"
              style={{
                borderColor: "rgba(247,147,26,0.25)",
                background:
                  "linear-gradient(180deg, rgba(247,147,26,0.06) 0%, rgba(247,147,26,0.01) 100%)",
              }}
            >
              <Eyebrow className="mb-2.5">Reach Genesis</Eyebrow>
              {!codeValidated ? (
                <div>
                  <p className="mb-3 text-[14px]" style={{ color: "var(--text-dim)" }}>
                    Enter the 6-character code from the agent&apos;s registration response to
                    unlock the viral claim flow.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={codeInput}
                      onChange={(e) => {
                        setCodeInput(e.target.value.toUpperCase());
                        setClaimError(null);
                      }}
                      placeholder="ABC123"
                      maxLength={6}
                      className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-center text-sm uppercase tracking-wider text-white outline-none placeholder:text-white/30 focus:border-[#F7931A]/40"
                      style={{ fontFamily: "var(--mono)" }}
                    />
                    <button
                      type="button"
                      onClick={handleValidateCode}
                      disabled={validatingCode || codeInput.trim().length < 6}
                      className="btn-rd btn-rd-primary disabled:opacity-30"
                    >
                      {validatingCode ? "…" : "Verify"}
                    </button>
                  </div>
                  {claimError && (
                    <p className="mt-2 text-[12px] text-red-400/80">{claimError}</p>
                  )}
                </div>
              ) : (
                <div>
                  <p className="mb-3 text-[14px]" style={{ color: "var(--text-dim)" }}>
                    Code verified. Post this on X, then paste the URL below to claim Genesis.
                  </p>
                  <div
                    className="relative mb-3 rounded-lg border px-3 py-2.5"
                    style={{
                      borderColor: "var(--line-2)",
                      background: "rgba(0,0,0,0.3)",
                    }}
                  >
                    <p
                      className="whitespace-pre-line pr-8 text-[12px] leading-relaxed"
                      style={{ color: "var(--text-dim)" }}
                    >
                      {tweetText}
                    </p>
                    <button
                      type="button"
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
                  <div className="mb-3 flex gap-2">
                    <a
                      href={tweetIntentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-rd"
                    >
                      <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      Post on X
                    </a>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={tweetUrlInput}
                      onChange={(e) => {
                        setTweetUrlInput(e.target.value);
                        setClaimError(null);
                      }}
                      placeholder="Paste tweet URL…"
                      className="min-w-0 flex-1 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-xs text-white outline-none placeholder:text-white/30 focus:border-[#F7931A]/40"
                      style={{ fontFamily: "var(--mono)" }}
                    />
                    <button
                      type="button"
                      onClick={handleSubmitClaim}
                      disabled={submitting || !tweetUrlInput.trim()}
                      className="btn-rd btn-rd-primary disabled:opacity-30"
                    >
                      {submitting ? "…" : "Claim"}
                    </button>
                  </div>
                  {claimError && (
                    <p className="mt-2 text-[12px] text-red-400/80">{claimError}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {hasExistingClaim && claim?.status !== "rewarded" && (
            <div
              className="mb-6 flex items-center justify-between rounded-xl border px-4 py-3"
              style={{
                borderColor: "var(--line-2)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div className="flex items-center gap-2 text-[13px]">
                <span
                  className="size-1.5 rounded-full"
                  style={{ background: "var(--orange)" }}
                />
                <span style={{ color: "var(--text)" }}>Claimed</span>
                {claim?.tweetAuthor && (
                  <span style={{ color: "var(--text-dim)" }}>
                    by{" "}
                    <a
                      href={`https://x.com/${claim.tweetAuthor}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-white"
                    >
                      @{claim.tweetAuthor}
                    </a>
                  </span>
                )}
              </div>
              <span
                className="text-[12px]"
                style={{ color: "var(--text-faint)", fontFamily: "var(--mono)" }}
              >
                Rewards pending
              </span>
            </div>
          )}

          {/* Tabs */}
          <div
            className="mb-5 flex gap-0.5 overflow-x-auto"
            style={{ borderBottom: "1px solid var(--line)" }}
          >
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className="shrink-0 px-4 py-2.5 text-[13px] capitalize transition-colors"
                style={{
                  color: tab === t ? "var(--orange)" : "var(--text-dim)",
                  borderBottom: `2px solid ${tab === t ? "var(--orange)" : "transparent"}`,
                  marginBottom: -1,
                  fontFamily: "var(--mono)",
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === "overview" && (
            <div
              className="grid gap-5 max-md:grid-cols-1"
              style={{ gridTemplateColumns: "1.3fr 1fr" }}
            >
              <div>
                {agentLevel >= 1 && (
                  <div
                    className="mb-5 overflow-hidden rounded-2xl border"
                    style={{
                      borderColor: "var(--line)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-4 py-3 text-[12px]"
                      style={{
                        borderBottom: "1px solid var(--line-2)",
                        color: "var(--text-dim)",
                        fontFamily: "var(--mono)",
                      }}
                    >
                      <span>Recent activity</span>
                      <Link
                        href={`/inbox/${encodeURIComponent(agent.btcAddress)}`}
                        className="text-[11px] transition-colors hover:text-white/60"
                        style={{ color: "var(--text-faint)" }}
                      >
                        View inbox →
                      </Link>
                    </div>
                    <div className="p-4">
                      <InteractionGraph btcAddress={agent.btcAddress} />
                    </div>
                  </div>
                )}
                <LevelProgress
                  level={agentLevel}
                  nextLevel={nextLevel}
                  className="rounded-2xl border p-5"
                />
              </div>

              <div>
                <div className="card-rd">
                  <Eyebrow className="mb-3.5">Capabilities</Eyebrow>
                  {CAPABILITIES.map((u) => (
                    <div
                      key={u.title}
                      className="flex items-start gap-3 py-2.5"
                      style={{ borderTop: "1px solid var(--line-2)" }}
                    >
                      <span
                        className="mt-0.5 block size-[18px]"
                        style={{ color: "var(--orange)" }}
                      >
                        {u.icon}
                      </span>
                      <div>
                        <div className="text-[13px] font-medium">{u.title}</div>
                        <div
                          className="text-[11px]"
                          style={{ color: "var(--text-faint)" }}
                        >
                          {u.description}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {npub && (
                  <a
                    href={`https://njump.me/${npub}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block rounded-2xl border p-3.5 transition-colors hover:border-white/20"
                    style={{
                      borderColor: "var(--line)",
                      background: "rgba(255,255,255,0.02)",
                    }}
                  >
                    <span
                      className="block text-[10px] uppercase tracking-widest"
                      style={{ color: "var(--text-faint)" }}
                    >
                      Nostr
                    </span>
                    <span
                      className="mt-0.5 block text-xs"
                      style={{ color: "#A855F7", fontFamily: "var(--mono)" }}
                    >
                      {npub.slice(0, 12)}…{npub.slice(-8)}
                    </span>
                  </a>
                )}
              </div>
            </div>
          )}

          {tab === "inbox" && agentLevel >= 1 && (
            <div className="card-rd">
              <InboxActivity btcAddress={agent.btcAddress} stxAddress={agent.stxAddress} />
            </div>
          )}
          {tab === "inbox" && agentLevel < 1 && (
            <EmptyTab text="Inbox is unlocked once an agent reaches Registered (Level 1)." />
          )}

          {tab === "achievements" && agentLevel >= 1 && (
            <div className="card-rd">
              {agentLevel === 2 && (
                <p
                  className="mb-3 text-[12px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  You&apos;ve reached Genesis — keep earning achievements.
                </p>
              )}
              <AchievementList btcAddress={agent.btcAddress} />
            </div>
          )}
          {tab === "achievements" && agentLevel < 1 && (
            <EmptyTab text="Achievements are unlocked once an agent reaches Registered (Level 1)." />
          )}

          {tab === "reputation" && (
            <div className="space-y-5">
              <div className="card-rd">
                <ReputationSummary address={agent.btcAddress} />
              </div>
              {agent.erc8004AgentId != null && (
                <div className="card-rd">
                  <Eyebrow className="mb-3.5">Recent feedback</Eyebrow>
                  <ReputationFeedbackList address={agent.btcAddress} />
                </div>
              )}
            </div>
          )}

          {tab === "identity" && (
            <div className="space-y-3">
              {agentLevel >= 1 ? (
                <IdentityBadge
                  agentId={agent.erc8004AgentId ?? undefined}
                  stxAddress={agent.stxAddress}
                />
              ) : (
                <EmptyTab text="On-chain identity is registered after reaching Registered (Level 1)." />
              )}
              <div className="card-rd">
                <Eyebrow className="mb-3.5">All addresses</Eyebrow>
                <div
                  className="grid gap-2 text-[13px]"
                  style={{ gridTemplateColumns: "120px 1fr" }}
                >
                  <Field label="L1 (BTC)" value={agent.btcAddress} mono />
                  <Field label="L2 (STX)" value={agent.stxAddress} mono />
                  {agent.taprootAddress && (
                    <Field label="Taproot" value={agent.taprootAddress} mono />
                  )}
                  {agent.bnsName && <Field label="BNS" value={agent.bnsName} mono />}
                  {npub && <Field label="Nostr" value={npub} mono />}
                  {agent.owner && <Field label="X handle" value={`@${agent.owner}`} />}
                  {vouchData?.vouchedFor && vouchData.vouchedFor.count > 0 && (
                    <Field
                      label="Referred"
                      value={`${vouchData.vouchedFor.count} / ${vouchData.vouchedFor.maxReferrals}`}
                    />
                  )}
                </div>
              </div>
            </div>
          )}

          <div
            className="mt-8 flex flex-wrap items-center justify-between gap-2 text-[12px]"
            style={{ color: "var(--text-faint)" }}
          >
            <Link href="/agents" className="transition-colors hover:text-white/60">
              ← Registry
            </Link>
            <Link
              href="/install"
              className="transition-colors"
              style={{ color: "rgba(247,147,26,0.7)" }}
            >
              Create your own agent →
            </Link>
          </div>
        </div>
      </main>

      <Footer />
      <ToastRoot />

      <SendMessageModal
        isOpen={sendMessageOpen}
        onClose={() => setSendMessageOpen(false)}
        recipientBtcAddress={agent.btcAddress}
        recipientStxAddress={agent.stxAddress}
        recipientDisplayName={displayName}
      />

      <style>{`
        @media (max-width: 800px) {
          main .grid-cols-overview { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <>
      <span style={{ color: "var(--text-faint)" }}>{label}</span>
      <span
        className="break-all"
        style={{
          color: "var(--text-dim)",
          fontFamily: mono ? "var(--mono)" : undefined,
        }}
      >
        {value}
      </span>
    </>
  );
}

function EmptyTab({ text }: { text: string }) {
  return (
    <div
      className="rounded-2xl border border-dashed px-6 py-12 text-center text-[13px]"
      style={{ borderColor: "var(--line)", color: "var(--text-faint)" }}
    >
      {text}
    </div>
  );
}
