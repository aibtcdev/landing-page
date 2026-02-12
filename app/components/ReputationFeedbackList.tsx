"use client";

import { useState } from "react";
import useSWR from "swr";
import type { ReputationFeedback, ReputationFeedbackResponse } from "@/lib/identity";
import { fetcher } from "@/lib/fetcher";

interface ReputationFeedbackListProps {
  address: string;
  initialCursor?: number;
}

export default function ReputationFeedbackList({
  address,
  initialCursor,
}: ReputationFeedbackListProps) {
  const [extraFeedback, setExtraFeedback] = useState<ReputationFeedback[]>([]);
  const [cursor, setCursor] = useState<number | null>(initialCursor || null);
  const [loadingMore, setLoadingMore] = useState(false);

  const { data, isLoading: loading } = useSWR<{ feedback: ReputationFeedbackResponse }>(
    `/api/identity/${encodeURIComponent(address)}/reputation?type=feedback`,
    fetcher,
    {
      onSuccess: (result) => {
        setCursor(result.feedback.cursor);
      },
    }
  );
  const feedback = [...(data?.feedback.items ?? []), ...extraFeedback];

  async function loadMore() {
    if (!cursor || loadingMore) return;

    try {
      setLoadingMore(true);
      const res = await fetch(
        `/api/identity/${encodeURIComponent(address)}/reputation?type=feedback&cursor=${cursor}`
      );
      if (!res.ok) throw new Error("Failed to load more feedback");
      const data = (await res.json()) as { feedback: ReputationFeedbackResponse };
      setExtraFeedback((prev) => [...prev, ...data.feedback.items]);
      setCursor(data.feedback.cursor);
    } catch (err) {
      console.error("Error loading more feedback:", err);
    } finally {
      setLoadingMore(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-24 bg-white/5 rounded-lg animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (feedback.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-white/[0.06] bg-white/[0.03]">
        <p className="text-sm text-white/60">No feedback available.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-white/70">Feedback History</h4>
      <div className="space-y-2">
        {feedback.map((item) => (
          <div
            key={`${item.client}-${item.index}`}
            className="p-3 rounded-lg border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="min-w-0 truncate text-xs font-mono text-white/70">
                    {item.client.slice(0, 8)}...{item.client.slice(-8)}
                  </span>
                  {item.tag1 && (
                    <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-white/60">
                      {item.tag1}
                    </span>
                  )}
                  {item.tag2 && (
                    <span className="px-2 py-0.5 rounded text-xs bg-white/10 text-white/60">
                      {item.tag2}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white/90">
                    Score: {item.wadValue.toFixed(2)}
                  </span>
                  <span className="text-xs text-white/50">
                    (index #{item.index})
                  </span>
                </div>
              </div>
              {item.isRevoked && (
                <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 flex-shrink-0">
                  Revoked
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {cursor && (
        <button
          onClick={loadMore}
          disabled={loadingMore}
          className="w-full px-4 py-2 rounded-lg border border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loadingMore ? (
            <span className="text-sm text-white/60">Loading...</span>
          ) : (
            <span className="text-sm text-white/90">Load More</span>
          )}
        </button>
      )}
    </div>
  );
}
