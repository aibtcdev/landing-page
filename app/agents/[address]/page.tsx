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

function truncateAddress(address: string) {
  if (address.length <= 16) return address;
  return `${address.slice(0, 6)}...${address.slice(-6)}`;
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
        if (found) setAgent(found);
        else setError("Agent not found");
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

    // Update or create meta tags for AI discovery
    const updateMeta = (name: string, content: string, property?: boolean) => {
      const attr = property ? 'property' : 'name';
      let meta = document.querySelector(`meta[${attr}="${name}"]`);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute(attr, name);
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', content);
    };

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

  // Shared background
  const bg = (
    <div
      className="fixed inset-0 -z-10 h-full w-full overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
        style={{ backgroundImage: "url('/Artwork/AIBTC_Pattern1_optimized.jpg')" }}
      />
      <div className="absolute -right-[200px] -top-[250px] h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.4)_0%,rgba(247,147,26,0.15)_40%,transparent_70%)] opacity-70 blur-[100px] max-md:hidden animate-float1" />
      <div className="absolute -bottom-[250px] -left-[200px] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.35)_0%,rgba(125,162,255,0.12)_40%,transparent_70%)] opacity-60 blur-[100px] max-md:hidden animate-float2" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
    </div>
  );

  if (loading) {
    return (
      <>{bg}<Navbar />
        <div className="flex h-[90vh] items-center justify-center">
          <div className="animate-pulse text-sm text-white/40">Loading agent...</div>
        </div>
      </>
    );
  }

  if (error || !agent) {
    return (
      <>{bg}<Navbar />
        <div className="flex h-[90vh] flex-col items-center justify-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03]">
            <svg className="h-7 w-7 text-white/20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <p className="text-sm text-white/40">Agent not found</p>
          <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs text-white/40 hover:text-white/70 transition-colors">
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

      {bg}
      <Navbar />

      <div className="flex h-[90vh] items-center justify-center px-5">
        <div className="w-full max-w-[440px] md:max-w-[520px]">

          {/* Identity */}
          <div className="flex flex-col items-center text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl}
              alt={displayName}
              className="h-20 w-20 md:h-24 md:w-24 rounded-full border-2 border-orange/30 bg-white/[0.06]"
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
            <h1 className="mt-3 text-2xl md:text-3xl font-medium tracking-tight text-white">
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
              <p className="mt-2 max-w-sm text-xs md:text-sm leading-relaxed text-white/60">{agent.description}</p>
            )}
          </div>

          {/* Addresses — inline row */}
          <div className="mt-5 md:mt-6 flex gap-2 md:gap-3 max-md:flex-col">
            <a
              href={`https://mempool.space/address/${agent.btcAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <div className="text-[10px] md:text-[11px] font-semibold uppercase tracking-widest text-white/50">BTC</div>
              <div className="mt-0.5 font-mono text-[12px] md:text-sm text-orange">
                <span className="hidden md:inline">{agent.btcAddress}</span>
                <span className="md:hidden">{truncateAddress(agent.btcAddress)}</span>
              </div>
            </a>
            <a
              href={`https://explorer.hiro.so/address/${agent.stxAddress}?chain=mainnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 md:px-4 md:py-3 transition-colors hover:border-white/[0.12] hover:bg-white/[0.06]"
            >
              <div className="text-[10px] md:text-[11px] font-semibold uppercase tracking-widest text-white/50">STX</div>
              <div className="mt-0.5 font-mono text-[12px] md:text-sm text-purple">
                <span className="hidden md:inline">{agent.stxAddress}</span>
                <span className="md:hidden">{truncateAddress(agent.stxAddress)}</span>
              </div>
            </a>
          </div>

          {/* Divider */}
          <div className="my-5 md:my-6 h-px bg-white/[0.08]" />

          {/* Claim */}
          {hasExistingClaim ? (
            <div className="space-y-2.5 md:space-y-3 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-3 md:px-5 md:py-4">
              {/* Header with verification icon */}
              <div className="flex items-center gap-2">
                <svg className="h-5 w-5 md:h-6 md:w-6 text-[#4dcd5e]" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span className="text-sm md:text-base font-medium text-white/90">Agent Claimed</span>
              </div>

              {/* Claim details */}
              <div className="space-y-1.5 md:space-y-2 text-xs md:text-sm">
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
                    className="inline-flex items-center gap-1.5 text-xs md:text-sm text-blue hover:text-blue/80 transition-colors"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                    </svg>
                    View tweet
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5 md:space-y-3">
              <div className="flex gap-2 md:gap-3">
                <a
                  href={tweetIntentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white/[0.08] py-2.5 md:py-3 text-xs md:text-sm font-medium text-white transition-colors hover:bg-white/[0.12]"
                >
                  <svg className="h-3.5 w-3.5 md:h-4 md:w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Post on X
                </a>
                <button
                  onClick={handleCopyLink}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 md:px-5 md:py-3 text-xs md:text-sm text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white/90"
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
                  className="min-w-0 flex-1 rounded-lg border border-white/[0.1] bg-white/[0.05] px-3 py-2.5 md:px-4 md:py-3 font-mono text-xs md:text-sm text-white placeholder:text-white/40 outline-none transition-colors focus:border-orange/40 focus:bg-white/[0.07]"
                />
                <button
                  onClick={handleSubmitClaim}
                  disabled={submitting || !tweetUrlInput.trim()}
                  className="shrink-0 rounded-lg bg-orange px-5 py-2.5 md:px-6 md:py-3 text-xs md:text-sm font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.97] disabled:opacity-30 disabled:active:scale-100"
                >
                  {submitting ? "Verifying..." : "Claim"}
                </button>
              </div>
              {claimError && (
                <p className="text-[11px] md:text-xs text-red-400/80">{claimError}</p>
              )}
              <p className="text-center text-[11px] md:text-xs text-white/45">
                Tweet about your agent, paste the URL, and claim ownership.
              </p>
            </div>
          )}

          {/* Back link */}
          <div className="mt-5 md:mt-6 text-center">
            <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs md:text-sm text-white/50 transition-colors hover:text-white/80">
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
