import type { LegionSnapshot } from "@/lib/legion/types";
import {
  explorerContractUrl,
  GOV_RULES,
  TREASURY_CONTRACT,
} from "@/lib/legion/constants";
import { formatSbtc, shortAddress } from "@/lib/legion/format";

function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-white/40">{sub}</div>}
    </div>
  );
}

function WiringBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
        ok
          ? "border-green-400/30 bg-green-400/[0.08] text-green-300"
          : "border-white/10 bg-white/[0.02] text-white/40"
      }`}
    >
      <span aria-hidden>{ok ? "✓" : "—"}</span>
      {label}
    </span>
  );
}

export default function LegionHeader({ snapshot }: { snapshot: LegionSnapshot }) {
  const { treasury, totalStaked, members, blockHeight } = snapshot;
  const stakedCount = members.filter((m) => m.stake > 0).length;

  return (
    <section className="space-y-5">
      {/* Treasury identity + live height */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#F7931A]/20 bg-[#F7931A]/[0.05] px-5 py-4">
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-white/40">
            Treasury contract
          </div>
          <a
            href={explorerContractUrl(TREASURY_CONTRACT)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-sm text-white/80 transition-colors hover:text-[#F7931A]"
            title={TREASURY_CONTRACT}
          >
            {shortAddress(TREASURY_CONTRACT, 8, 16)}
          </a>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-white/40">
            Block height
          </div>
          <div className="font-mono text-lg font-semibold text-white">
            {blockHeight != null ? blockHeight.toLocaleString("en-US") : "—"}
          </div>
        </div>
      </div>

      {/* Headline stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Pooled sBTC"
          value={`${formatSbtc(treasury.balance)} sBTC`}
          sub="In the shared treasury"
        />
        <StatCard
          label="Total staked"
          value={`${formatSbtc(totalStaked)} sBTC`}
          sub="Combined voting weight"
        />
        <StatCard
          label="Members staked"
          value={`${stakedCount} / ${members.length}`}
          sub="Agents with voting power"
        />
      </div>

      {/* Constitution + wiring */}
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="text-xs uppercase tracking-wide text-white/40">
            Constitution
          </div>
          <ul className="mt-3 grid gap-2 text-sm text-white/70 sm:grid-cols-2">
            <li>
              <span className="text-white">Quorum:</span> ≥ {GOV_RULES.quorumPct}%
              of staked weight must vote
            </li>
            <li>
              <span className="text-white">Threshold:</span> ≥{" "}
              {GOV_RULES.thresholdPct}% of cast votes YES
            </li>
            <li>
              <span className="text-white">Min participants:</span> ≥{" "}
              {GOV_RULES.minVoters} distinct voters
            </li>
            <li>
              <span className="text-white">Veto:</span> blocked if veto weight ≥{" "}
              {GOV_RULES.vetoPct}% and exceeds YES
            </li>
          </ul>
        </div>
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
          <div className="text-xs uppercase tracking-wide text-white/40">
            Wiring
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <WiringBadge label="gov" ok={treasury.govWired} />
            <WiringBadge label="payout" ok={treasury.payoutWired} />
            <WiringBadge label="token" ok={treasury.tokenWired} />
          </div>
        </div>
      </div>
    </section>
  );
}
