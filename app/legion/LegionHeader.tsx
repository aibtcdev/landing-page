import type { LegionSnapshot } from "@/lib/legion/types";
import {
  explorerContractUrl,
  GOV_RULES,
  TREASURY_CONTRACT,
} from "@/lib/legion/constants";
import { formatSbtc, shortAddress } from "@/lib/legion/format";

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-l border-white/10 pl-4 first:border-l-0 first:pl-0">
      <div className="text-[10px] uppercase tracking-[0.08em] text-white/40">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums leading-none text-white">
        {value}
      </div>
    </div>
  );
}

function WiringDot({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-white/50">
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-400" : "bg-white/20"}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export default function LegionHeader({ snapshot }: { snapshot: LegionSnapshot }) {
  const { treasury, totalStaked, members, blockHeight } = snapshot;
  const treasuryContract = snapshot.entry?.treasury ?? TREASURY_CONTRACT;

  return (
    <section className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {/* Top row: identity + chain + wiring */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-white/[0.06] px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
          <span className="text-white/40">Treasury</span>
          <a
            href={explorerContractUrl(treasuryContract)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-white/70 transition-colors hover:text-[#F7931A]"
            title={treasuryContract}
          >
            {shortAddress(treasuryContract, 6, 14)}
          </a>
          <span className="text-white/15">·</span>
          <span className="text-white/40">Block</span>
          <span className="font-mono text-white/70 tabular-nums">
            {blockHeight != null ? blockHeight.toLocaleString("en-US") : "—"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <WiringDot label="gov" ok={treasury.govWired} />
          <WiringDot label="token" ok={treasury.tokenWired} />
        </div>
      </div>

      {/* Metrics band + constitution */}
      <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 px-5 py-4">
        <div className="flex items-center gap-4">
          <Metric label="Pooled" value={`${formatSbtc(treasury.balance)} sBTC`} />
          <Metric label="Staked" value={`${formatSbtc(totalStaked)} sBTC`} />
          <Metric label="Stakers" value={`${members.length}`} />
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/45">
          <span className="text-white/30">Rules</span>
          <span>quorum ≥{GOV_RULES.quorumPct}%</span>
          <span className="text-white/15">·</span>
          <span>threshold ≥{GOV_RULES.thresholdPct}%</span>
          <span className="text-white/15">·</span>
          <span>min {GOV_RULES.minVoters} voters</span>
          <span className="text-white/15">·</span>
          <span>veto ≥{GOV_RULES.vetoPct}%</span>
        </div>
      </div>
    </section>
  );
}
