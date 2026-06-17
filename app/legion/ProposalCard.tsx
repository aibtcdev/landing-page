import type { LegionProposal } from "@/lib/legion/types";
import { isPassing } from "@/lib/legion/lifecycle";
import { formatSbtc } from "@/lib/legion/format";
import LifecycleTracker from "./LifecycleTracker";
import AddressLink from "./AddressLink";

function Badge({
  ok,
  label,
}: {
  ok: boolean;
  label: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${
        ok
          ? "border-green-400/30 bg-green-400/[0.08] text-green-300"
          : "border-white/10 bg-white/[0.02] text-white/40"
      }`}
    >
      {ok ? "✓" : "✗"} {label}
    </span>
  );
}

function TallyBar({
  yes,
  no,
  veto,
  total,
}: {
  yes: number;
  no: number;
  veto: number;
  total: number;
}) {
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="space-y-1.5">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full bg-green-400/80" style={{ width: `${pct(yes)}%` }} />
        <div className="h-full bg-red-400/70" style={{ width: `${pct(no)}%` }} />
        <div className="h-full bg-amber-400/70" style={{ width: `${pct(veto)}%` }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
        <span>
          <span className="text-green-300">YES</span> {formatSbtc(yes)} (
          {pct(yes).toFixed(0)}%)
        </span>
        <span>
          <span className="text-red-300">NO</span> {formatSbtc(no)} (
          {pct(no).toFixed(0)}%)
        </span>
        <span>
          <span className="text-amber-300">VETO</span> {formatSbtc(veto)} (
          {pct(veto).toFixed(0)}%)
        </span>
      </div>
    </div>
  );
}

export default function ProposalCard({
  proposal,
  blockHeight,
}: {
  proposal: LegionProposal;
  blockHeight: number | null;
}) {
  const { status } = proposal;
  const passing = isPassing(status);
  const votedChips = proposal.votes.filter((v) => v.voted);

  return (
    <article className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 max-md:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-white/40">
            <span className="rounded bg-white/5 px-2 py-0.5 font-mono">
              #{proposal.id}
            </span>
            <span>
              proposed by {proposal.proposerLabel ?? ""}{" "}
              <AddressLink address={proposal.proposer} />
            </span>
          </div>
          <h3 className="max-w-2xl text-base font-medium leading-snug text-white">
            {proposal.desc}
          </h3>
        </div>
        <span
          className={`shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
            passing
              ? "border-green-400/30 bg-green-400/[0.08] text-green-300"
              : "border-white/10 bg-white/[0.02] text-white/50"
          }`}
        >
          {passing ? "Passing" : "Not passing"}
        </span>
      </div>

      {/* Payout line */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/60">
        <span>Pays</span>
        <span className="font-semibold text-white">
          {formatSbtc(proposal.amount)} sBTC
        </span>
        <span>to</span>
        <span className="text-white/80">{proposal.recipientLabel ?? ""}</span>
        <AddressLink address={proposal.recipient} />
      </div>

      {/* Lifecycle */}
      <div className="mt-4">
        <LifecycleTracker status={status} blockHeight={blockHeight} />
      </div>

      {/* Tally */}
      <div className="mt-4">
        <TallyBar
          yes={status.yesWeight}
          no={status.noWeight}
          veto={status.vetoWeight}
          total={status.totalStakedSnapshot}
        />
      </div>

      {/* Gate badges */}
      <div className="mt-3 flex flex-wrap gap-2">
        <Badge ok={status.metQuorum} label="Quorum" />
        <Badge ok={status.metThreshold} label="Threshold" />
        <Badge ok={status.voterCount >= 2} label={`${status.voterCount} voters`} />
        {status.vetoActivated && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-2.5 py-0.5 text-xs text-amber-300">
            ⚠ Veto active
          </span>
        )}
      </div>

      {/* Voter chips */}
      {votedChips.length > 0 && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-white/40">
            Votes cast
          </div>
          <div className="flex flex-wrap gap-1.5">
            {votedChips.map((v) => (
              <span
                key={v.address}
                title={`${v.label} · ${formatSbtc(v.amount)} sBTC`}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  v.vote
                    ? "border-green-400/30 bg-green-400/[0.08] text-green-300"
                    : "border-red-400/30 bg-red-400/[0.08] text-red-300"
                }`}
              >
                {v.label.replace("legion-agent-", "#")} {v.vote ? "YES" : "NO"}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
