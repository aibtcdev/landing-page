"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface IdentityBadgeProps {
  agentId?: number;
  stxAddress: string;
}

export default function IdentityBadge({
  agentId: initialAgentId,
  stxAddress,
}: IdentityBadgeProps) {
  const [agentId, setAgentId] = useState(initialAgentId);
  const [loading, setLoading] = useState(initialAgentId === undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (initialAgentId !== undefined) return;

    fetch(`/api/identity/${encodeURIComponent(stxAddress)}`)
      .then((r) => {
        if (!r.ok) return null;
        return r.json() as Promise<{ agentId: number | null }>;
      })
      .then((data) => {
        if (data?.agentId != null) setAgentId(data.agentId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [initialAgentId, stxAddress]);

  async function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const resp = await fetch(
        `/api/identity/${encodeURIComponent(stxAddress)}/refresh`,
        { method: "POST" }
      );
      if (!resp.ok) {
        const body = (await resp.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Refresh failed: ${resp.status}`);
      }
      const data = (await resp.json()) as {
        agentId: number | null;
        bnsName: string | null;
      };
      setAgentId(data.agentId ?? undefined);
      // BNS (and any other server-rendered fields) live on the AgentRecord;
      // reload the RSC payload to pick those up.
      router.refresh();
    } catch (e) {
      setRefreshError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  }

  let body: React.ReactNode;

  if (loading) {
    body = (
      <div className="rounded-xl border border-white/[0.08] bg-[rgba(12,12,12,0.6)] backdrop-blur-sm p-4">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-white/[0.06] animate-pulse motion-reduce:animate-none" />
          <div className="h-3 w-24 rounded bg-white/[0.06] animate-pulse motion-reduce:animate-none" />
        </div>
      </div>
    );
  } else if (agentId !== undefined) {
    body = (
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
  } else {
    body = (
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

  return (
    <div className="space-y-1.5">
      {body}
      <div className="flex items-center justify-end gap-2 px-1">
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing || loading}
          className="text-[11px] text-white/40 hover:text-white/70 transition-colors underline underline-offset-2 decoration-white/20 hover:decoration-white/50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-sm"
        >
          {refreshing ? "Refreshing…" : "Not showing up correctly? Refresh"}
        </button>
      </div>
      {refreshError && (
        <div className="px-1 text-[11px] text-red-400/80" role="alert">
          {refreshError}
        </div>
      )}
    </div>
  );
}
