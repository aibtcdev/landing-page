"use client";

import { useEffect, useState } from "react";
import type { ReputationSummary as ReputationSummaryType } from "@/lib/identity";
import ReputationFeedbackList from "./ReputationFeedbackList";

interface ReputationSummaryProps {
  agentId: number;
  address: string;
}

export default function ReputationSummary({
  agentId,
  address,
}: ReputationSummaryProps) {
  const [summary, setSummary] = useState<ReputationSummaryType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);

  useEffect(() => {
    async function fetchSummary() {
      try {
        setLoading(true);
        const res = await fetch(
          `/api/identity/${encodeURIComponent(address)}/reputation?type=summary`
        );
        if (!res.ok) {
          throw new Error("Failed to load reputation data");
        }
        const data = (await res.json()) as { summary: ReputationSummaryType | null };
        setSummary(data.summary);
      } catch (err) {
        console.error("Error fetching reputation summary:", err);
        setError("Failed to load reputation data");
      } finally {
        setLoading(false);
      }
    }

    fetchSummary();
  }, [agentId, address]);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-20 bg-white/5 rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-red-500/20 bg-red-500/10">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!summary || summary.count === 0) {
    return (
      <div className="p-4 rounded-lg border border-white/10 bg-white/5">
        <p className="text-sm text-white/60">
          No reputation feedback yet. Start building your on-chain reputation by
          delivering quality service to clients.
        </p>
      </div>
    );
  }

  // Convert score to 5-star scale for display (assuming WAD values range 0-5)
  const stars = Math.min(5, Math.max(0, Math.round(summary.summaryValue)));

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-lg border border-white/10 bg-white/5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-white/90">
            Reputation Score
          </h4>
          <span className="text-xs text-white/50">
            {summary.count} review{summary.count !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <svg
                key={i}
                className={`w-5 h-5 ${
                  i < stars ? "text-[#F7931A]" : "text-white/20"
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
          <span className="text-lg font-semibold text-white/90">
            {summary.summaryValue.toFixed(2)}
          </span>
        </div>

        <button
          onClick={() => setShowFeedback(!showFeedback)}
          className="mt-3 text-xs text-blue-400 hover:text-blue-300 transition-colors"
        >
          {showFeedback ? "Hide" : "View"} Feedback →
        </button>
      </div>

      {showFeedback && <ReputationFeedbackList agentId={agentId} address={address} />}
    </div>
  );
}
