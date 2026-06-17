import type { LegionProposal, LegionVote } from "@/lib/legion/types";
import { deriveLifecycle, isPassing } from "@/lib/legion/lifecycle";
import { GOV_RULES, explorerTxUrl } from "@/lib/legion/constants";
import { formatSbtc } from "@/lib/legion/format";
import LifecycleTracker from "./LifecycleTracker";
import AddressLink from "./AddressLink";

/** A single voter: choice + weight, linking to the vote tx when known. */
function VoteChip({ vote }: { vote: LegionVote }) {
  const tone = vote.vote
    ? "border-green-400/30 bg-green-400/[0.08] text-green-300"
    : "border-red-400/30 bg-red-400/[0.08] text-red-300";
  const cls = `inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] tabular-nums ${tone} ${
    vote.txid ? "transition-colors hover:brightness-125" : ""
  }`;
  const inner = (
    <>
      <span className="font-medium">{vote.label.replace("legion-agent-", "agent-")}</span>
      <span>{vote.vote ? "YES" : "NO"}</span>
      <span className="opacity-50">· {formatSbtc(vote.amount)}</span>
      {vote.txid && <span aria-hidden className="opacity-50">↗</span>}
    </>
  );

  if (vote.txid) {
    return (
      <a
        href={explorerTxUrl(vote.txid)}
        target="_blank"
        rel="noopener noreferrer"
        title={`${vote.label} · ${formatSbtc(vote.amount)} sBTC · view vote tx`}
        className={cls}
      >
        {inner}
      </a>
    );
  }
  return (
    <span title={vote.address} className={cls}>
      {inner}
    </span>
  );
}

/** One gate check — the scannable unit. `ok` null = neutral/info. */
function GateStat({
  label,
  value,
  sub,
  ok,
}: {
  label: string;
  value: string;
  sub: string;
  ok: boolean | null;
}) {
  const tone =
    ok === null
      ? "border-white/10 bg-white/[0.02] text-white"
      : ok
        ? "border-green-400/25 bg-green-400/[0.06] text-green-300"
        : "border-red-400/20 bg-red-400/[0.05] text-red-300";
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.08em] text-white/40">
          {label}
        </span>
        {ok !== null && (
          <span aria-hidden className="text-[11px]">
            {ok ? "✓" : "✗"}
          </span>
        )}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums leading-none">
        {value}
      </div>
      <div className="mt-1 text-[10px] text-white/35">{sub}</div>
    </div>
  );
}

function StatusPill({
  passing,
  outcome,
  expired,
  stageLabel,
}: {
  passing: boolean;
  outcome: "executed" | "rejected" | null;
  expired: boolean;
  stageLabel: string;
}) {
  let text = passing ? "Passing" : "Not passing";
  let tone = passing
    ? "border-green-400/30 bg-green-400/[0.1] text-green-300"
    : "border-white/12 bg-white/[0.03] text-white/55";

  if (outcome === "executed") {
    text = "Passed · paid";
    tone = "border-green-400/40 bg-green-400/[0.12] text-green-300";
  } else if (outcome === "rejected") {
    text = "Rejected";
    tone = "border-red-400/30 bg-red-400/[0.1] text-red-300";
  } else if (expired) {
    text = "Expired";
    tone = "border-white/12 bg-white/[0.03] text-white/45";
  }

  return (
    <span className="flex shrink-0 flex-col items-end gap-0.5">
      <span
        className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}
      >
        {text}
      </span>
      <span className="text-[10px] uppercase tracking-wide text-white/30">
        {stageLabel}
      </span>
    </span>
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
  const life = deriveLifecycle(status, blockHeight);
  const passing = isPassing(status);

  // Real participation / approval percentages — the activity the page is about.
  const total = status.totalStakedSnapshot;
  const cast = status.yesWeight + status.noWeight + status.vetoWeight;
  const participationPct = total > 0 ? (cast / total) * 100 : 0;
  const approvalBase = status.yesWeight + status.noWeight;
  const approvalPct = approvalBase > 0 ? (status.yesWeight / approvalBase) * 100 : 0;

  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  const votedChips = proposal.votes.filter((v) => v.voted);

  return (
    <article className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 max-md:p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/40">
            <span className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-white/60">
              #{proposal.id}
            </span>
            <span>{proposal.proposerLabel ?? "—"}</span>
            <AddressLink address={proposal.proposer} />
            <span className="text-white/20">→ pays</span>
            <span className="font-semibold text-[#F7931A]">
              {formatSbtc(proposal.amount)} sBTC
            </span>
            <span className="text-white/20">to</span>
            <span>{proposal.recipientLabel ?? "—"}</span>
            <AddressLink address={proposal.recipient} />
          </div>
          <h3 className="text-[15px] font-medium leading-snug text-white">
            {proposal.desc}
          </h3>
        </div>
        <StatusPill
          passing={passing}
          outcome={life.outcome}
          expired={life.stage === "expired"}
          stageLabel={life.label}
        />
      </div>

      {/* Gate activity — the hero row */}
      <div className="mt-4 grid grid-cols-4 gap-2 max-sm:grid-cols-2">
        <GateStat
          label="Quorum"
          value={`${participationPct.toFixed(0)}%`}
          sub={`voted · need ≥${GOV_RULES.quorumPct}%`}
          ok={status.metQuorum}
        />
        <GateStat
          label="Threshold"
          value={`${approvalPct.toFixed(0)}%`}
          sub={`YES · need ≥${GOV_RULES.thresholdPct}%`}
          ok={status.metThreshold}
        />
        <GateStat
          label="Voters"
          value={`${status.voterCount}`}
          sub={`need ≥${GOV_RULES.minVoters}`}
          ok={status.voterCount >= GOV_RULES.minVoters}
        />
        <GateStat
          label="Veto"
          value={status.vetoActivated ? "Active" : "Clear"}
          sub={`${pct(status.vetoWeight).toFixed(0)}% veto weight`}
          ok={status.vetoActivated ? false : null}
        />
      </div>

      {/* Tally bar */}
      <div className="mt-4 space-y-1.5">
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          <div className="h-full bg-green-400/80" style={{ width: `${pct(status.yesWeight)}%` }} />
          <div className="h-full bg-red-400/70" style={{ width: `${pct(status.noWeight)}%` }} />
          <div className="h-full bg-amber-400/70" style={{ width: `${pct(status.vetoWeight)}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
          <span><span className="text-green-300">YES</span> {formatSbtc(status.yesWeight)}</span>
          <span><span className="text-red-300">NO</span> {formatSbtc(status.noWeight)}</span>
          <span><span className="text-amber-300">VETO</span> {formatSbtc(status.vetoWeight)}</span>
          <span className="text-white/30">of {formatSbtc(total)} staked</span>
        </div>
      </div>

      {/* Lifecycle */}
      <div className="mt-4">
        <LifecycleTracker status={status} blockHeight={blockHeight} />
      </div>

      {/* Who voted — each agent's choice + the weight they committed */}
      {votedChips.length > 0 && (
        <div className="mt-4 border-t border-white/[0.06] pt-3">
          <div className="mb-2 text-[10px] uppercase tracking-[0.08em] text-white/40">
            Who voted · {votedChips.length} of {proposal.votes.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {votedChips.map((v) => (
              <VoteChip key={v.address} vote={v} />
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
