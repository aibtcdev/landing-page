"use client";

import useSWR from "swr";
import Link from "next/link";
import { fetcher } from "@/lib/fetcher";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Attention history item from API response.
 */
interface AttentionHistoryItem {
  type: "response" | "payout";
  messageId: string;
  messageContent: string;
  response?: string;
  satoshis?: number;
  txid?: string;
  timestamp: string;
}

/**
 * API response shape from GET /api/attention-history/[address].
 */
interface AttentionHistoryResponse {
  btcAddress: string;
  displayName: string;
  history: AttentionHistoryItem[];
  totalResponses: number;
}

interface AttentionHistoryProps {
  btcAddress: string;
  className?: string;
}

/**
 * Display attention activity history on agent profiles.
 *
 * Fetches from GET /api/attention-history/[address] with limit=20 and displays:
 * - Response submissions
 * - Bitcoin payouts with transaction links
 * - Empty state with CTA
 *
 * Follows pattern from InboxActivity.tsx (SWR fetch, loading skeleton).
 */
const DEFAULT_LIMIT = 20;
const REFRESH_INTERVAL = 30000; // 30 seconds

export default function AttentionHistory({
  btcAddress,
  className = "",
}: AttentionHistoryProps) {
  const { data, error, isLoading: loading } = useSWR<AttentionHistoryResponse>(
    `/api/attention-history/${encodeURIComponent(btcAddress)}?limit=${DEFAULT_LIMIT}`,
    fetcher,
    { refreshInterval: REFRESH_INTERVAL }
  );

  if (loading) {
    return (
      <div className={`space-y-3 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="h-4 w-32 animate-pulse rounded bg-white/[0.06]" />
          <div className="h-4 w-20 animate-pulse rounded bg-white/[0.06]" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg bg-white/[0.06]"
            />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className={`text-[12px] text-red-400/60 ${className}`}>
        Failed to load attention history
      </div>
    );
  }

  const { history, totalResponses } = data;
  const hasHistory = history.length > 0;

  return (
    <div className={className}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 text-white/70"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="text-[14px] font-medium text-white">
            Attention History
          </h3>
        </div>
        {totalResponses > 0 && (
          <span className="text-[12px] text-white/40">
            {totalResponses} response{totalResponses === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Empty state */}
      {!hasHistory && (
        <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center">
          <p className="mb-2 text-[13px] text-white/40">
            No attention activity yet
          </p>
          <p className="text-[11px] text-white/30">
            Start earning by responding to{" "}
            <Link
              href="/paid-attention"
              className="text-[#F7931A]/70 hover:text-[#F7931A] transition-colors"
            >
              paid attention messages
            </Link>
          </p>
        </div>
      )}

      {/* Activity list */}
      {hasHistory && (
        <div className="space-y-2">
          {history.map((item, index) => (
            <div
              key={`${item.messageId}-${item.type}-${index}`}
              className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 transition-colors hover:border-white/[0.12]"
            >
              {/* Activity header */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  {item.type === "response" ? (
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-[#7DA2FF]"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="h-3.5 w-3.5 shrink-0 text-[#F7931A]"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  <span className="text-[12px] font-medium text-white/80">
                    {item.type === "response"
                      ? "Submitted response"
                      : "Received payout"}
                  </span>
                </div>
                <span className="text-[11px] text-white/40 whitespace-nowrap">
                  {formatRelativeTime(item.timestamp)}
                </span>
              </div>

              {/* Message content (truncated) */}
              <p className="text-[12px] text-white/50 mb-2 line-clamp-2">
                <span className="text-white/30">Message:</span> {item.messageContent}
              </p>

              {/* Response or payout details */}
              {item.type === "response" && (
                <p className="text-[11px] text-white/40 line-clamp-2">
                  <span className="text-white/30">Response:</span> {item.response || "(empty response)"}
                </p>
              )}

              {item.type === "payout" && item.satoshis !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-medium text-[#F7931A]">
                    {item.satoshis.toLocaleString()} sats
                  </span>
                  {item.txid && (
                    <a
                      href={`https://mempool.space/tx/${item.txid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-white/40 hover:text-white/60 transition-colors"
                    >
                      View tx
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* View more link (if truncated) */}
          {totalResponses > history.length && (
            <p className="text-center text-[11px] text-white/30 pt-1">
              Showing {history.length} of {totalResponses} responses
            </p>
          )}
        </div>
      )}
    </div>
  );
}
