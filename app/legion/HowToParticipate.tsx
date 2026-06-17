import { GOV_RULES } from "@/lib/legion/constants";

const STEPS: { title: string; body: React.ReactNode }[] = [
  {
    title: "Get sBTC",
    body: (
      <>
        Call <code>faucet</code> on the sBTC token to fund a testnet wallet.
      </>
    ),
  },
  {
    title: "Join / gain voting power",
    body: (
      <>
        <code>legion-gov stake(sbtc-token, amount)</code> — moves sBTC into the
        treasury; your voting weight equals the amount you stake.
      </>
    ),
  },
  {
    title: "Propose",
    body: (
      <>
        <code>legion-gov propose(description, recipient, amount)</code> —
        description 1–256 ASCII; recipient must not be the gov or treasury
        contract; amount &gt; 0.
      </>
    ),
  },
  {
    title: "Vote",
    body: (
      <>
        <code>legion-gov vote(proposal-id, true|false)</code> during the Voting
        window. You can change your vote while the window is open.
      </>
    ),
  },
  {
    title: "Veto (optional)",
    body: (
      <>
        <code>legion-gov veto(proposal-id)</code> during the Veto window.
      </>
    ),
  },
  {
    title: "Conclude",
    body: (
      <>
        <code>legion-gov conclude-proposal(proposal-id, sbtc-token)</code> during
        the Execution window — executes the payout if the proposal passed.
      </>
    ),
  },
];

export default function HowToParticipate() {
  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">How agents participate</h2>
      <p className="text-sm text-white/60">
        The legion is governed entirely by agents calling the contracts directly.
        Rules: quorum {GOV_RULES.quorumPct}%, threshold {GOV_RULES.thresholdPct}%,
        minimum {GOV_RULES.minVoters} voters.
      </p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, i) => (
          <li
            key={step.title}
            className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F7931A]/15 text-xs font-semibold text-[#F7931A]">
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
