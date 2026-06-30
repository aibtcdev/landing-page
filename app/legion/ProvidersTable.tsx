import type { ProviderRecord } from "@/lib/legion/types";
import { formatSbtc } from "@/lib/legion/format";
import AddressLink from "./AddressLink";

function StatusDot({ p }: { p: ProviderRecord }) {
  const label = p.flagged ? "flagged" : p.active ? "active" : "down";
  const color = p.flagged
    ? "bg-red-400"
    : p.active
      ? "bg-green-400"
      : "bg-white/20";
  const text = p.flagged ? "text-red-400/80" : p.active ? "text-white/70" : "text-white/40";
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-1.5 w-1.5 rounded-full ${color}`} aria-hidden />
      <span className={text}>{label}</span>
    </span>
  );
}

function Stake({ sats }: { sats: number }) {
  return (
    <span className="tabular-nums text-white/70">
      {sats > 0 ? (
        `${formatSbtc(sats)} sBTC`
      ) : (
        <span className="text-white/30">unstaked</span>
      )}
    </span>
  );
}

export default function ProvidersTable({
  providers,
}: {
  providers: ProviderRecord[];
}) {
  if (providers.length === 0) {
    return (
      <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-8 text-center text-sm text-white/50">
        No providers yet. Anyone can join for <span className="text-white/70">free</span> —
        register an endpoint with the gateway and start serving. An optional{" "}
        <code className="text-white/70">legion-engage</code> stake ranks you higher.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {/* Desktop table */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wide text-white/40">
            <th className="px-5 py-3 font-medium" scope="col">Provider (STX)</th>
            <th className="px-5 py-3 font-medium" scope="col">Model</th>
            <th className="px-5 py-3 text-right font-medium" scope="col">Stake</th>
            <th className="px-5 py-3 font-medium" scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {providers.map((p) => (
            <tr
              key={p.address}
              className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.03]"
            >
              <td className="px-5 py-3">
                <AddressLink address={p.address} />
              </td>
              <td className="px-5 py-3 font-mono text-xs text-white/70">{p.model || "—"}</td>
              <td className="px-5 py-3 text-right tabular-nums">
                <Stake sats={p.stake} />
              </td>
              <td className="px-5 py-3">
                <StatusDot p={p} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile list */}
      <ul className="divide-y divide-white/[0.04] md:hidden">
        {providers.map((p) => (
          <li key={p.address} className="space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <AddressLink address={p.address} />
              <Stake sats={p.stake} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-white/50">
              <span className="font-mono">{p.model || "—"}</span>
              <StatusDot p={p} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
