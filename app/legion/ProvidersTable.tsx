import type { ProviderRecord } from "@/lib/legion/types";
import { formatSbtc } from "@/lib/legion/format";
import AddressLink from "./AddressLink";

function ActiveDot({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span
        className={`h-1.5 w-1.5 rounded-full ${active ? "bg-green-400" : "bg-white/20"}`}
        aria-hidden
      />
      <span className={active ? "text-white/70" : "text-white/40"}>
        {active ? "active" : "inactive"}
      </span>
    </span>
  );
}

function Jobs({ ok, fail }: { ok: number; fail: number }) {
  return (
    <span className="tabular-nums text-white/70">
      <span className="text-green-400/80">{ok}</span>
      <span className="text-white/30"> / </span>
      <span className={fail > 0 ? "text-red-400/80" : "text-white/40"}>{fail}</span>
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
        No providers yet. Any operator that stakes the minimum bond and calls{" "}
        <code className="text-white/70">register</code> joins the guild.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
      {/* Desktop table */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wide text-white/40">
            <th className="px-5 py-3 font-medium">Provider (STX)</th>
            <th className="px-5 py-3 font-medium">Model</th>
            <th className="px-5 py-3 text-right font-medium">Bond</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 text-right font-medium">Jobs (ok / fail)</th>
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
              <td className="px-5 py-3 font-mono text-xs text-white/70">{p.model}</td>
              <td className="px-5 py-3 text-right tabular-nums">{formatSbtc(p.bond)}</td>
              <td className="px-5 py-3">
                <ActiveDot active={p.active} />
              </td>
              <td className="px-5 py-3 text-right">
                <Jobs ok={p.jobsOk} fail={p.jobsFail} />
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
              <span className="tabular-nums text-sm">{formatSbtc(p.bond)} sBTC</span>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-white/50">
              <span className="font-mono">{p.model}</span>
              <ActiveDot active={p.active} />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-white/50">
              <span>jobs</span>
              <Jobs ok={p.jobsOk} fail={p.jobsFail} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
