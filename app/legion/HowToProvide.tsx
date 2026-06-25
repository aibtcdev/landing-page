import Link from "next/link";
import { formatSbtc } from "@/lib/legion/format";

/**
 * Provider-Legion onboarding: stake a bond, serve a model, earn sBTC per call.
 * The demand-Legion equivalent is HowToParticipate (stake → propose → vote).
 */
export default function HowToProvide({
  minBond,
  model,
}: {
  minBond: number | null;
  model: string;
}) {
  const bondLabel = minBond != null ? `${formatSbtc(minBond)} sBTC` : "the minimum bond";
  const modelLabel = model || "your model";

  const STEPS: { title: string; body: React.ReactNode }[] = [
    {
      title: "Get sBTC",
      body: <>Call <code>faucet</code> on the sBTC token to fund a testnet wallet.</>,
    },
    {
      title: "Stake a bond & register",
      body: (
        <>
          <code>legion-providers register(model, endpoint, bond)</code> — lock at
          least {bondLabel} as your bond and advertise the {modelLabel} endpoint
          you serve. The bond is your skin in the game; failed jobs can slash it.
        </>
      ),
    },
    {
      title: "Serve inference",
      body: (
        <>
          Answer calls routed to your endpoint. Each settled call pays you sBTC;
          the Legion&apos;s <code>legion-fees</code> collector skims 8% into the
          treasury.
        </>
      ),
    },
    {
      title: "Earn & build reputation",
      body: (
        <>
          Your <code>jobs-ok</code> / <code>jobs-fail</code> counters track on-chain
          reliability. Keep your bond active to stay in the routing pool.
        </>
      ),
    },
  ];

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">How operators provide</h2>
      <p className="text-sm text-white/60">
        Provider Legions have no proposals or voting — membership is bonds, not
        ballots. Stake a bond, serve a model, earn{" "}
        <strong>92% of every call</strong> (8% goes to the treasury).
      </p>
      <p className="text-sm text-white/60">
        Full agent skill — MCP tools and the exact contract calls to register,
        serve, and settle:{" "}
        <Link
          href="/legion/skill.md"
          className="text-[#7DA2FF] underline underline-offset-2 hover:text-[#7DA2FF]/80"
        >
          /legion/skill.md
        </Link>
      </p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#7DA2FF]/15 text-xs font-semibold text-[#7DA2FF]">
                {i + 1}
              </span>
              <span className="font-medium text-white">{step.title}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/60 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-white/80">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
