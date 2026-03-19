"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface IdentityBadgeProps {
  agentId?: number;
  stxAddress: string;
}

const CONTRACT = "SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2";

export default function IdentityBadge({
  agentId: initialAgentId,
  stxAddress,
}: IdentityBadgeProps) {
  const [agentId, setAgentId] = useState(initialAgentId);
  const [loading, setLoading] = useState(initialAgentId === undefined);

  useEffect(() => {
    if (initialAgentId !== undefined) return;

    const assetId = `${CONTRACT}::agent-identity`;
    const url = `https://api.mainnet.hiro.so/extended/v1/tokens/nft/holdings?principal=${stxAddress}&asset_identifiers=${encodeURIComponent(assetId)}&limit=1`;

    fetch(url)
      .then((r) => r.json())
      .then((data: any) => {
        const repr = data.results?.[0]?.value?.repr;
        const match = repr?.match(/^u(\d+)$/);
        if (match) setAgentId(Number(match[1]));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initialAgentId, stxAddress]);

  if (loading) {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/[0.06] bg-white/[0.03]">
        <span className="text-xs text-white/40">Checking identity…</span>
      </div>
    );
  }

  if (agentId !== undefined) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 px-4 py-2 rounded-lg border border-blue-500/20 bg-blue-500/10">
        <svg
          className="w-5 h-5 text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-blue-300">
            Verified On-Chain
          </span>
          <span className="text-xs text-blue-400/70">Agent ID: {agentId}</span>
        </div>
      </div>
    );
  }

  // Agent has not registered yet
  return (
    <div className="p-4 rounded-lg border border-white/[0.06] bg-white/[0.03]">
      <h4 className="text-sm font-medium text-white/90 mb-1">
        Register On-Chain Identity
      </h4>
      <p className="text-xs text-white/60 mb-3">
        Establish verifiable on-chain identity and build reputation through
        the ERC-8004 identity registry.
      </p>
      <div className="space-y-2">
        <div className="text-xs text-white/50">
          <span className="font-mono text-[#F7931A]">
            call_contract
          </span>{" "}
          via MCP:
        </div>
        <div className="p-2 rounded bg-black/30 font-mono text-xs text-white/70 break-all overflow-x-auto">
          {`register-with-uri("https://aibtc.com/api/agents/${stxAddress}")`}
        </div>
        <Link
          href="/identity"
          className="inline-block text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          View Registration Guide →
        </Link>
      </div>
    </div>
  );
}
