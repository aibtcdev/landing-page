"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface AgentRecord {
  stxAddress: string;
  btcAddress: string;
  displayName: string;
  description: string | null;
  bnsName: string | null;
  verifiedAt: string;
}

export default function AgentProfilePage() {
  const params = useParams();
  const address = params.address as string;

  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [claimStatus, setClaimStatus] = useState<"idle" | "checking" | "claimed" | "eligible">("idle");

  useEffect(() => {
    async function fetchAgent() {
      try {
        const res = await fetch("/api/agents");
        if (!res.ok) throw new Error("Failed to fetch agents");
        const data = await res.json();

        // Find agent by btc or stx address
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

  const profileUrl = typeof window !== "undefined"
    ? `${window.location.origin}/agents/${agent?.btcAddress}`
    : "";

  const tweetText = agent
    ? `My AIBTC agent is ${agent.displayName} 🤖₿\n\n${profileUrl}\n\n@aiaboratorio`
    : "";

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  const handleCopyLink = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClaimReward = async () => {
    if (!agent) return;
    setClaimStatus("checking");

    try {
      const res = await fetch("/api/claims/viral", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ btcAddress: agent.btcAddress }),
      });

      const data = await res.json();

      if (data.claimed) {
        setClaimStatus("claimed");
      } else if (data.eligible) {
        setClaimStatus("eligible");
      } else {
        setClaimStatus("idle");
      }
    } catch {
      setClaimStatus("idle");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading agent...</div>
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-bold text-red-500">Agent Not Found</h1>
        <p className="text-gray-400">No agent registered with this address.</p>
        <Link href="/agents" className="text-orange-500 hover:underline">
          ← Back to Registry
        </Link>
      </div>
    );
  }

  const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?address=${agent.btcAddress}&size=200&format=png`;

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-gray-800 p-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/agents" className="text-gray-400 hover:text-white transition">
            ← Back to Registry
          </Link>
          <Link href="/" className="text-orange-500 font-bold">
            AIBTC
          </Link>
        </div>
      </header>

      {/* Profile Card */}
      <main className="max-w-2xl mx-auto p-6 mt-8">
        <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
          {/* Avatar & Name */}
          <div className="flex flex-col items-center text-center mb-8">
            <img
              src={avatarUrl}
              alt={agent.displayName}
              className="w-32 h-32 rounded-full border-4 border-orange-500 mb-4"
            />
            <h1 className="text-3xl font-bold text-white mb-2">
              {agent.displayName}
            </h1>
            {agent.bnsName && (
              <span className="bg-purple-600 text-white text-sm px-3 py-1 rounded-full mb-2">
                {agent.bnsName}
              </span>
            )}
            {agent.description && (
              <p className="text-gray-400 max-w-md mt-2">{agent.description}</p>
            )}
          </div>

          {/* Addresses */}
          <div className="space-y-4 mb-8">
            <div className="bg-black/50 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Bitcoin Address</div>
              <div className="font-mono text-sm text-orange-400 break-all">
                {agent.btcAddress}
              </div>
            </div>
            <div className="bg-black/50 rounded-lg p-4">
              <div className="text-xs text-gray-500 mb-1">Stacks Address</div>
              <div className="font-mono text-sm text-purple-400 break-all">
                {agent.stxAddress}
              </div>
            </div>
          </div>

          {/* Verified Badge */}
          <div className="flex items-center justify-center gap-2 text-green-500 mb-8">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="text-sm">
              Verified {new Date(agent.verifiedAt).toLocaleDateString()}
            </span>
          </div>

          {/* Viral Claim Section */}
          <div className="border-t border-gray-800 pt-8">
            <h2 className="text-xl font-bold text-center mb-4">
              🎁 Claim Your Reward
            </h2>
            <p className="text-gray-400 text-center text-sm mb-6">
              Tweet about your agent and receive <span className="text-orange-500 font-bold">$5-10 in BTC</span> sent directly to your wallet!
            </p>

            <div className="space-y-4">
              {/* Tweet Button */}
              <a
                href={tweetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-[#1DA1F2] hover:bg-[#1a8cd8] text-white font-bold py-4 px-6 rounded-xl text-center transition"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  Tweet &quot;My AIBTC agent is {agent.displayName}&quot;
                </span>
              </a>

              {/* Copy Link */}
              <button
                onClick={handleCopyLink}
                className="w-full bg-gray-800 hover:bg-gray-700 text-white font-medium py-3 px-6 rounded-xl transition"
              >
                {copied ? "✓ Copied!" : "Copy Profile Link"}
              </button>

              {/* Check Claim Status */}
              <button
                onClick={handleClaimReward}
                disabled={claimStatus === "checking"}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-700 text-white font-bold py-4 px-6 rounded-xl transition"
              >
                {claimStatus === "checking" && "Checking..."}
                {claimStatus === "claimed" && "✓ Reward Claimed!"}
                {claimStatus === "eligible" && "🎉 Eligible! Reward incoming..."}
                {claimStatus === "idle" && "Check Claim Status"}
              </button>
            </div>

            {/* Instructions */}
            <div className="mt-6 text-xs text-gray-500 text-center">
              <p>1. Click the Tweet button above</p>
              <p>2. Post the tweet (don&apos;t modify the text)</p>
              <p>3. Click &quot;Check Claim Status&quot; to verify & receive BTC</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
