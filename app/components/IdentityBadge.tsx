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
      <div className="rounded-xl border border-white/[0.08] bg-[rgba(12,12,12,0.6)] backdrop-blur-sm p-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-white/[0.06] animate-pulse" />
          <div className="h-3 w-24 rounded bg-white/[0.06] animate-pulse" />
        </div>
      </div>
    );
  }

  if (agentId !== undefined) {
    return (
      <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.06] backdrop-blur-sm p-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center size-8 rounded-full bg-blue-500/15">
            <svg className="size-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-blue-300">On-Chain Identity</div>
            <div className="text-xs text-blue-400/60 font-mono">ERC-8004 #{agentId}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Link
      href="/identity"
      className="block rounded-xl border border-white/[0.08] bg-[rgba(12,12,12,0.6)] backdrop-blur-sm p-4 transition-colors hover:border-white/[0.12]"
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-8 rounded-full bg-white/[0.06]">
          <svg className="size-4 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-white/70">Register Identity</div>
          <div className="text-xs text-white/40">ERC-8004 on-chain verification</div>
        </div>
        <svg className="ml-auto size-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </Link>
  );
}
