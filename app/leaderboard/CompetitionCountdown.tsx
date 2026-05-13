"use client";

import { useEffect, useMemo, useState } from "react";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function formatStartTime(startTimestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(new Date(startTimestamp * 1000));
}

function countdownParts(msRemaining: number) {
  const remaining = Math.max(0, msRemaining);
  const days = Math.floor(remaining / DAY_MS);
  const hours = Math.floor((remaining % DAY_MS) / HOUR_MS);
  const minutes = Math.floor((remaining % HOUR_MS) / MINUTE_MS);
  const seconds = Math.floor((remaining % MINUTE_MS) / SECOND_MS);
  return [
    { label: "Days", value: days },
    { label: "Hours", value: hours },
    { label: "Minutes", value: minutes },
    { label: "Seconds", value: seconds },
  ];
}

export default function CompetitionCountdown({
  startTimestamp,
  initialNowMs,
}: {
  startTimestamp: number;
  initialNowMs: number;
}) {
  const [nowMs, setNowMs] = useState(initialNowMs);
  const startMs = startTimestamp * 1000;
  const msRemaining = startMs - nowMs;
  const isLive = msRemaining <= 0;
  const startLabel = useMemo(
    () => formatStartTime(startTimestamp),
    [startTimestamp]
  );
  const parts = countdownParts(msRemaining);

  useEffect(() => {
    if (isLive) return;
    const id = setInterval(() => setNowMs(Date.now()), SECOND_MS);
    return () => clearInterval(id);
  }, [isLive]);

  return (
    <section
      aria-label="Competition start countdown"
      className="mb-8 rounded-xl border border-white/[0.08] bg-white/[0.025] px-5 py-4 shadow-[0_16px_60px_rgba(0,0,0,0.18)] max-md:px-4"
    >
      <div className="flex items-center justify-between gap-5 max-md:flex-col max-md:items-start">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                isLive ? "bg-[#4dcd5e]" : "bg-[#F7931A]"
              }`}
            />
            <p className="text-[11px] font-medium uppercase tracking-wide text-white/45">
              {isLive ? "Competition live" : "Competition starts in"}
            </p>
          </div>
          <p className="text-sm text-white/70">
            {isLive
              ? `Scoring opened ${startLabel}.`
              : `Only swaps confirmed at or after ${startLabel} count.`}
          </p>
        </div>

        {isLive ? (
          <div className="rounded-full border border-[#4dcd5e]/25 bg-[#4dcd5e]/10 px-4 py-2 text-sm font-medium text-[#85e08f]">
            Live now
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-sm:w-full">
            {parts.map((part) => (
              <div
                key={part.label}
                className="min-w-[72px] rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2 text-center max-sm:min-w-0"
              >
                <div className="font-mono text-xl font-semibold tabular-nums text-white max-sm:text-lg">
                  {String(part.value).padStart(2, "0")}
                </div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide text-white/35">
                  {part.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
