"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Navbar from "../../components/Navbar";
import { generateName } from "@/lib/name-generator";

interface AgentRecord {
  stxAddress: string;
  btcAddress: string;
  displayName: string;
  description: string | null;
  bnsName: string | null;
  verifiedAt: string;
  owner?: string | null;
}

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

  // Claim state
  const [claim, setClaim] = useState<ClaimInfo | null>(null);
  const [tweetUrlInput, setTweetUrlInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);

  // Fetch agent data
  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch("/api/agents");
        if (!res.ok) throw new Error("Failed to fetch agents");
        const data = (await res.json()) as { agents: AgentRecord[] };

        const found = data.agents.find(
          (a: AgentRecord) =>
            a.btcAddress === address ||
            a.stxAddress === address ||
            a.btcAddress.toLowerCase() === address.toLowerCase() ||
            a.stxAddress.toLowerCase() === address.toLowerCase()
        );

        if (found) {
          setAgent(found);
        } else {
          setError("Agent not found");
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }

    if (address) {
      fetchAgent();
    }
  }, [address]);

  // Fetch existing claim status on mount
  useEffect(() => {
    if (!agent) return;
    fetch(`/api/claims/viral?btcAddress=${encodeURIComponent(agent.btcAddress)}`)
      .then((r) => r.json())
      .then((raw: unknown) => {
        const data = raw as { claimed?: boolean; eligible?: boolean; claim?: ClaimInfo };
        if (data.claim) {
          setClaim(data.claim);
        }
      })
      .catch(() => {});
  }, [agent]);

  const profileUrl = typeof window !== "undefined"
    ? `${window.location.origin}/agents/${agent?.btcAddress}`
    : "";

  const displayName = agent ? (agent.displayName || generateName(agent.btcAddress)) : "";

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
        body: JSON.stringify({
          btcAddress: agent.btcAddress,
          tweetUrl: tweetUrlInput.trim(),
        }),
      });

      const data = (await res.json()) as {
        error?: string;
        claim?: ClaimInfo;
        claimed?: boolean;
        eligible?: boolean;
      };

      if (!res.ok) {
        setClaimError(data.error || "Verification failed");
      } else if (data.claim) {
        setClaim(data.claim);
        setClaimError(null);
        // Update agent with owner handle from the claim response
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
      <>
        <Navbar />
        <div
          className="fixed inset-0 -z-10 min-h-[100lvh] w-full overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
          aria-hidden="true"
        />
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-pulse text-sm text-white/40">Loading agent...</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <>
        <Navbar />
        <div
          className="fixed inset-0 -z-10 min-h-[100lvh] w-full overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
          aria-hidden="true"
        />
        <div className="flex min-h-screen flex-col items-center justify-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03]">
            <svg className="h-8 w-8 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h1 className="text-xl font-medium text-white/70">Agent Not Found</h1>
          <p className="text-sm text-white/40">No agent registered with this address.</p>
          <Link
            href="/agents"
            className="mt-2 inline-flex items-center gap-2 text-sm text-white/50 transition-colors duration-200 hover:text-white/80"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to Registry
          </Link>
        </div>
      </>
    );
  }

  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(agent.btcAddress)}`;
  const hasExistingClaim = claim && (claim.status === "verified" || claim.status === "rewarded" || claim.status === "pending");

  return (
    <>
      <Navbar />
      {/* Animated Background */}
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
        <div className="relative mx-auto max-w-[720px] px-6 pb-24 pt-32 max-md:px-5 max-md:pt-28">

          {/* Profile Card */}
          <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-black/60 p-8 backdrop-blur-md max-md:p-6">

            {/* Avatar & Name */}
            <div className="flex flex-col items-center text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={avatarUrl}
                alt={displayName}
                className="h-24 w-24 rounded-full border-2 border-orange/40 bg-white/[0.06]"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
              <h1 className="mt-4 text-3xl font-medium tracking-tight text-white max-md:text-2xl">
                {displayName}
              </h1>
              {agent.bnsName && (
                <span className="mt-2 rounded-md bg-blue/10 px-2.5 py-1 text-xs font-medium text-blue ring-1 ring-inset ring-blue/20">
                  {agent.bnsName}
                </span>
              )}
              {agent.description && (
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/50">{agent.description}</p>
              )}

              {/* Badges row */}
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                {/* Verified Badge */}
                <div className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1">
                  <svg className="h-3.5 w-3.5 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-xs text-white/50">
                    Verified {new Date(agent.verifiedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {/* Owner (X handle) */}
                {agent.owner && (
                  <a
                    href={`https://x.com/${agent.owner}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1 transition-colors duration-200 hover:border-white/[0.15] hover:bg-white/[0.05]"
                  >
                    <svg className="h-3 w-3 text-white/50" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                    <span className="text-xs text-white/50">@{agent.owner}</span>
                  </a>
                )}
              </div>
            </div>

            {/* Addresses */}
            <div className="mt-8 space-y-3">
              <a
                href={`https://mempool.space/address/${agent.btcAddress}`}
                target="_blank"
                rel="noopener noreferrer"
                className="block rounded-lg border border-white/[0.06] bg-white/[0.03] p-4 transition-colors duration-200 hover:border-white/[0.12] hover:bg-white/[0.05]"
              >
                <div className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Bitcoin Address</div>
                <div className="mt-1.5 font-mono text-[13px] text-orange break-all">
                  {agent.btcAddress}
                </div>
              </a>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-white/40">Stacks Address</div>
                <div className="mt-1.5 font-mono text-[13px] text-purple break-all">
                  {agent.stxAddress}
                </div>
              </div>
            </div>

            {/* Claim Section */}
            <div className="mt-8 border-t border-white/[0.06] pt-8">
              <h2 className="text-center text-lg font-medium text-white">
                Claim Your Reward
              </h2>
              <p className="mt-1 text-center text-sm text-white/50">
                Tweet about your agent and receive{" "}
                <span className="font-medium text-orange">5,000-10,000 sats</span>{" "}
                sent directly to your wallet.
              </p>

              {hasExistingClaim ? (
                /* Already claimed — show status */
                <div className="mt-6 rounded-lg border border-white/[0.06] bg-white/[0.03] p-5">
                  <div className="flex items-center gap-2">
                    {claim.status === "rewarded" ? (
                      <svg className="h-5 w-5 shrink-0 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <div className="h-2 w-2 shrink-0 rounded-full bg-orange animate-pulse" />
                    )}
                    <span className="text-sm font-medium text-white">
                      {claim.status === "rewarded" && "Reward sent!"}
                      {claim.status === "verified" && "Tweet verified — reward pending"}
                      {claim.status === "pending" && "Claim submitted — verifying"}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5 text-xs text-white/40">
                    <div className="flex justify-between">
                      <span>Reward</span>
                      <span className="text-orange">{claim.rewardSatoshis?.toLocaleString()} sats</span>
                    </div>
                    {claim.tweetUrl && (
                      <div className="flex justify-between">
                        <span>Tweet</span>
                        <a href={claim.tweetUrl} target="_blank" rel="noopener noreferrer" className="text-blue hover:underline">
                          View tweet
                        </a>
                      </div>
                    )}
                    {claim.rewardTxid && (
                      <div className="flex justify-between">
                        <span>Transaction</span>
                        <a
                          href={`https://mempool.space/tx/${claim.rewardTxid}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-orange hover:underline"
                        >
                          {claim.rewardTxid.slice(0, 8)}...
                        </a>
                      </div>
                    )}
                    {claim.claimedAt && (
                      <div className="flex justify-between">
                        <span>Claimed</span>
                        <span>{new Date(claim.claimedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* No claim yet — show the flow */
                <div className="mt-6 space-y-4">
                  {/* Step 1: Tweet */}
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/40">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-[10px]">1</span>
                      Post on X
                    </div>
                    <a
                      href={tweetIntentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/[0.08] px-6 py-3.5 text-sm font-medium text-white transition-colors duration-200 hover:bg-white/[0.12]"
                    >
                      <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      Tweet about {displayName}
                    </a>
                  </div>

                  {/* Step 2: Paste URL */}
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/40">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-[10px]">2</span>
                      Paste your tweet URL
                    </div>
                    <input
                      type="url"
                      value={tweetUrlInput}
                      onChange={(e) => { setTweetUrlInput(e.target.value); setClaimError(null); }}
                      placeholder="https://x.com/you/status/..."
                      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-4 py-3 font-mono text-sm text-white placeholder:text-white/20 outline-none transition-colors duration-200 focus:border-orange/50 focus:bg-white/[0.05]"
                    />
                  </div>

                  {/* Step 3: Verify */}
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-white/40">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/[0.08] text-[10px]">3</span>
                      Verify and claim
                    </div>
                    <button
                      onClick={handleSubmitClaim}
                      disabled={submitting || !tweetUrlInput.trim()}
                      className="w-full rounded-lg bg-orange px-6 py-3.5 text-sm font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
                    >
                      {submitting ? "Verifying tweet..." : "Verify & Claim Reward"}
                    </button>
                  </div>

                  {claimError && (
                    <div className="rounded-lg border border-red-500/20 bg-red-500/[0.06] p-3 text-xs text-red-400">
                      {claimError}
                    </div>
                  )}
                </div>
              )}

              {/* Copy Link */}
              <button
                onClick={handleCopyLink}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-6 py-3 text-sm text-white/70 transition-colors duration-200 hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white"
              >
                {copied ? (
                  <>
                    <svg className="h-4 w-4 text-[#4dcd5e]" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Copied!
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                    </svg>
                    Copy Profile Link
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Back link */}
          <div className="mt-10 text-center">
            <Link
              href="/agents"
              className="inline-flex items-center gap-2 text-sm text-white/50 transition-colors duration-200 hover:text-white/80"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Back to Registry
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
