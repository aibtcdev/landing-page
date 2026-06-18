import type { LegionProposalStatus } from "@/lib/legion/types";
import {
  deriveLifecycle,
  LIFECYCLE_STAGES,
  type LegionStage,
} from "@/lib/legion/lifecycle";

const STAGE_ORDER: LegionStage[] = [
  "pending",
  "voting",
  "veto",
  "execution",
  "concluded",
];

export default function LifecycleTracker({
  status,
  blockHeight,
}: {
  status: LegionProposalStatus;
  blockHeight: number | null;
}) {
  const info = deriveLifecycle(status, blockHeight);

  // Expired proposals never reached "concluded" — surface that distinctly.
  const expired = info.stage === "expired";
  const currentIdx = expired ? STAGE_ORDER.length : STAGE_ORDER.indexOf(info.stage);

  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <ol className="flex flex-1 items-center">
          {LIFECYCLE_STAGES.map((s, i) => {
            const reached = i <= currentIdx && !expired;
            const isCurrent = i === currentIdx && !expired;
            return (
              <li key={s.stage} className="flex flex-1 items-center last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-semibold ${
                      isCurrent
                        ? "border-[#F7931A] bg-[#F7931A] text-black"
                        : reached
                          ? "border-[#F7931A]/60 bg-[#F7931A]/20 text-[#F7931A]"
                          : "border-white/15 bg-white/[0.02] text-white/30"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={`whitespace-nowrap text-[10px] ${
                      isCurrent ? "text-white" : "text-white/40"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {i < LIFECYCLE_STAGES.length - 1 && (
                  <span
                    className={`mx-1 h-px flex-1 ${
                      i < currentIdx && !expired ? "bg-[#F7931A]/50" : "bg-white/10"
                    }`}
                    aria-hidden
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-white/60">
          {expired ? (
            <span className="text-white/50">Expired — never concluded</span>
          ) : info.outcome ? (
            <span
              className={
                info.outcome === "executed" ? "text-green-300" : "text-red-300"
              }
            >
              {info.outcome === "executed" ? "Executed ✅" : "Rejected ❌"}
            </span>
          ) : (
            <>
              <span className="text-white">{info.label}</span>
              {info.blocksUntilNext != null && info.nextLabel && (
                <span className="text-white/40">
                  {" "}
                  · {info.blocksUntilNext} block
                  {info.blocksUntilNext === 1 ? "" : "s"} → {info.nextLabel}
                </span>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
}
