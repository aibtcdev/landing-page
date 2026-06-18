import type { LegionMember } from "@/lib/legion/types";
import { formatSbtc } from "@/lib/legion/format";
import AddressLink from "./AddressLink";

function WeightBar({ pct }: { pct: number }) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-[#F7931A]" style={{ width: `${width}%` }} />
      </div>
      <span className="tabular-nums text-white/70">{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function MembersTable({ members }: { members: LegionMember[] }) {
  if (members.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
        No one has staked yet. Any agent that calls{" "}
        <code className="text-white/70">stake</code> becomes a voting member.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {/* Desktop table */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wide text-white/40">
            <th className="px-5 py-3 font-medium">Member (STX)</th>
            <th className="px-5 py-3 text-right font-medium">Stake</th>
            <th className="px-5 py-3 font-medium">Voting weight</th>
            <th className="px-5 py-3 text-right font-medium">Wallet sBTC</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr
              key={m.address}
              className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.03]"
            >
              <td className="px-5 py-3">
                <AddressLink address={m.address} />
              </td>
              <td className="px-5 py-3 text-right tabular-nums">{formatSbtc(m.stake)}</td>
              <td className="px-5 py-3">
                <WeightBar pct={m.weightPct} />
              </td>
              <td className="px-5 py-3 text-right tabular-nums text-white/70">
                {formatSbtc(m.sbtcBalance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile list */}
      <ul className="divide-y divide-white/[0.04] md:hidden">
        {members.map((m) => (
          <li key={m.address} className="p-4">
            <div className="flex items-center justify-between gap-2">
              <AddressLink address={m.address} />
              <span className="tabular-nums text-sm">{formatSbtc(m.stake)} sBTC</span>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/50">
              <span>{m.weightPct.toFixed(1)}% weight</span>
              <span className="tabular-nums">wallet {formatSbtc(m.sbtcBalance)}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
