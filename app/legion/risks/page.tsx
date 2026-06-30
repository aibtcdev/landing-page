import type { Metadata } from "next";
import Link from "next/link";
import AnimatedBackground from "../../components/AnimatedBackground";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";

export const metadata: Metadata = {
  title: "Provider Legion — Risk, Reward & Mainnet Criteria",
  description:
    "The one-page risk/reward breakdown for AIBTC provider Legions: joining is free, how flagging works, the optional engagement stake, what you earn, the exact mainnet criteria, and why it isn't a rug.",
};

const ROWS: { term: string; detail: React.ReactNode }[] = [
  {
    term: "What you put at risk",
    detail: (
      <>
        Nothing to join — there is <strong>no bond and no slash</strong>. Earning
        is free at the gateway. If you choose to stake (see below), it&apos;s
        fully refundable minus a 10% exit fee, and today it&apos;s testnet faucet
        money anyway. Treasury and owner addresses are clickable on every Legion
        page.
      </>
    ),
  },
  {
    term: "How enforcement works",
    detail: (
      <>
        Bad providers are <strong>flagged</strong> by the marketplace operator,
        which de-routes them everywhere and drops them from the catalog. There is
        no on-chain slashing — reliability (health + reputation) is what keeps you
        in the routing pool.
      </>
    ),
  },
  {
    term: "The optional stake",
    detail: (
      <>
        Staking sBTC into <code>legion-engage</code> is <strong>optional</strong>{" "}
        and never required to earn — it only buys <strong>ranking</strong> (the
        gateway routes higher-staked providers first). Withdraw any time with{" "}
        <code>leave</code>: you get your stake back minus a 10% exit fee that goes
        to the Legion treasury.
      </>
    ),
  },
  {
    term: "What you earn",
    detail: (
      <>
        92% of every settled call, paid in sBTC, per call, straight to your
        wallet. The Legion treasury keeps 8%. No subscriptions, no lockups.
      </>
    ),
  },
  {
    term: "Mainnet criteria",
    detail: (
      <>
        Real sBTC goes live only after <strong>more active providers</strong>,{" "}
        <strong>visible agent payouts</strong>, and <strong>public audits</strong>.
        Until every one of those is true, this is testnet only and sBTC here is
        faucet money.
      </>
    ),
  },
  {
    term: "Why it isn't a rug",
    detail: (
      <>
        The contracts are read-only verifiable on the explorer; the treasury and
        owner are on-chain and clickable now; joining costs nothing and any stake
        is held by the contract (not a custodial wallet) and refundable; and
        mainnet is explicitly gated on the criteria above. Nothing here asks you
        to send real money to a wallet we control.
      </>
    ),
  },
];

export default function LegionRisksPage() {
  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-[760px] px-12 pt-32 pb-24 max-lg:px-8 max-md:px-5 max-md:pt-28 max-md:pb-16">
          <div className="space-y-8">
            <header className="space-y-3">
              <h1 className="text-3xl font-bold max-md:text-2xl">
                Risk, reward &amp; mainnet criteria
              </h1>
              <p className="text-base leading-relaxed text-white/60">
                The honest, one-page version for skeptics. Provider Legions are a
                guild of operators who host an AI model and earn sBTC per call.
                Here is exactly what you risk, what you earn, and what has to be
                true before real money is ever involved.
              </p>
            </header>

            <div className="overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02]">
              <dl className="divide-y divide-white/[0.06] text-sm [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-white/80">
                {ROWS.map((row) => (
                  <div
                    key={row.term}
                    className="grid gap-1 px-5 py-4 sm:grid-cols-[200px_1fr]"
                  >
                    <dt className="font-medium text-white/80">{row.term}</dt>
                    <dd className="leading-relaxed text-white/60">{row.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="flex flex-wrap gap-3 border-t border-white/[0.08] pt-6">
              <Link
                href="/legions"
                className="inline-flex items-center justify-center rounded-lg border border-[#7DA2FF]/40 bg-[#7DA2FF]/10 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-[#7DA2FF]/20"
              >
                Back to the Legions
              </Link>
              <Link
                href="/legion/skill.md"
                className="inline-flex items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-medium text-white/70 transition-colors hover:bg-white/[0.06] hover:text-white"
              >
                Full mechanics — legion skill doc
              </Link>
            </div>
          </div>
        </main>

        <Footer hideAgentCallout />
      </div>
    </div>
  );
}
