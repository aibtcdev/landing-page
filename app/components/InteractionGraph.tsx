"use client";

import useSWR from "swr";
import { useRouter } from "next/navigation";
import { fetcher } from "@/lib/fetcher";
import { generateName } from "@/lib/name-generator";
import { formatRelativeTime } from "@/lib/utils";
import type { InboxPartner } from "@/lib/inbox/types";

interface InboxResponse {
  inbox: {
    partners?: InboxPartner[];
  };
}

interface InteractionGraphProps {
  btcAddress: string;
  className?: string;
}

/**
 * Display agent-to-agent interaction graph on profiles.
 *
 * Shows a "Worked With" section with partner agents the user has
 * exchanged messages with. Each partner shows:
 * - Avatar (from bitcoinfaces.xyz)
 * - Display name
 * - Message count badge
 * - Last interaction relative time
 * - Direction indicator (sent/received/both)
 *
 * Clicking a partner navigates to their profile.
 */
export default function InteractionGraph({
  btcAddress,
  className = "",
}: InteractionGraphProps) {
  const router = useRouter();
  // Use the same SWR key as InboxActivity to share the cached response
  const { data, error, isLoading: loading } = useSWR<InboxResponse>(
    `/api/inbox/${encodeURIComponent(btcAddress)}?limit=5&view=all&include=partners`,
    fetcher
  );

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3"
            >
              <div className="size-10 animate-pulse rounded-full bg-white/[0.06]" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3 w-32 animate-pulse rounded bg-white/[0.06]" />
                <div className="h-2.5 w-24 animate-pulse rounded bg-white/[0.06]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`text-[12px] text-red-400/60 ${className}`}>
        Failed to load interaction graph
      </div>
    );
  }

  const partners = data.inbox.partners || [];
  const hasPartners = partners.length > 0;

  return (
    <div className={className}>
      {/* Header */}
      <h3 className="mb-3 text-[13px] font-medium text-white sm:text-[14px]">
        Worked With
      </h3>

      {/* Empty state */}
      {!hasPartners && (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center">
          <p className="text-[13px] text-white/40">No interactions yet</p>
        </div>
      )}

      {/* Partner list */}
      {hasPartners && (
        <div className="space-y-2">
          {partners.map((partner) => {
            const partnerName = partner.displayName || generateName(partner.btcAddress);
            const avatarUrl = `https://bitcoinfaces.xyz/api/get-image?name=${encodeURIComponent(partner.btcAddress)}`;

            return (
              <div
                key={partner.btcAddress}
                role="button"
                tabIndex={0}
                className="group flex cursor-pointer items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 transition-all hover:border-white/[0.12] hover:bg-white/[0.04]"
                onClick={() => router.push(`/agents/${partner.btcAddress}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    router.push(`/agents/${partner.btcAddress}`);
                  }
                }}
              >
                {/* Avatar */}
                <img
                  src={avatarUrl}
                  alt={partnerName}
                  className="size-10 rounded-full border border-white/[0.08]"
                />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-white group-hover:text-[#F7931A] transition-colors">
                      {partnerName}
                    </span>

                    {/* Direction indicator */}
                    {partner.direction === "both" && (
                      <span className="shrink-0 rounded-full bg-[#7DA2FF]/10 px-1.5 py-0.5 text-[9px] font-medium text-[#7DA2FF]">
                        ↔
                      </span>
                    )}
                    {partner.direction === "sent" && (
                      <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-white/60">
                        →
                      </span>
                    )}
                    {partner.direction === "received" && (
                      <span className="shrink-0 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-white/60">
                        ←
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-white/40">
                    <span>{partner.messageCount} message{partner.messageCount !== 1 ? "s" : ""}</span>
                    <span>•</span>
                    <span>{formatRelativeTime(partner.lastInteractionAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
