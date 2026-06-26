import Link from "next/link";
import { formatSbtc } from "@/lib/legion/format";
import CopyButton from "../components/CopyButton";

/**
 * Provider-Legion onboarding: get test sBTC, lock a bond + register, serve the
 * model, get paid. The demand-Legion equivalent is HowToParticipate. The exact
 * typed contract call lives in /legion/skill.md.
 */

export default function HowToProvide({
  minBond,
  model,
}: {
  minBond: number | null;
  model: string;
}) {
  const bondLabel = minBond != null ? formatSbtc(minBond) : "the minimum";
  const modelLabel = model || "qwen2.5-7b";
  const registerCmd = `legion-providers.register("${modelLabel}", "https://your-endpoint:8000/v1", ${bondLabel})`;
  const dockerCmd = `docker run -p 8000:8000 vllm/vllm-openai --model Qwen/Qwen2.5-7B-Instruct`;

  const STEPS: { title: string; body: React.ReactNode }[] = [
    {
      title: "Get test sBTC (30 seconds)",
      body: (
        <>
          Spin up a Stacks wallet and run the sBTC faucet → free test tokens land
          in your wallet. No real money at risk.
        </>
      ),
    },
    {
      title: "Lock bond + register (one paste)",
      body: (
        <>
          Use <code>call_contract</code> →{" "}
          <code>legion-providers register</code>:
          <span className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all">{registerCmd}</code>
            <CopyButton text={registerCmd} variant="icon" label="" ariaLabel="Copy register command" />
          </span>
          Minimum {bondLabel} sBTC. This bond is slashed if your endpoint returns
          errors or times out too often.
        </>
      ),
    },
    {
      title: "Run the model once",
      body: (
        <>
          One Docker command → your endpoint is live. We route paying calls to it
          automatically.
          <span className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all">{dockerCmd}</code>
            <CopyButton text={dockerCmd} variant="icon" label="" ariaLabel="Copy docker command" />
          </span>
        </>
      ),
    },
    {
      title: "Get paid + climb the list",
      body: (
        <>
          Every settled call = sBTC in your wallet, minus 8%. Your public{" "}
          <code>jobs-ok</code> / <code>jobs-fail</code> counter decides how much
          traffic you receive.
          <span className="mt-2 block text-xs text-white/40">
            Advanced:{" "}
            <Link
              href="/legion/skill.md"
              className="text-white/60 underline underline-offset-2 hover:text-white/80"
            >
              exact contract call + agent integration
            </Link>
          </span>
        </>
      ),
    },
  ];

  return (
    <section id="how-to-provide" className="scroll-mt-24 space-y-4">
      <h2 className="text-xl font-semibold">How operators provide</h2>
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
            <div className="mt-2 text-sm leading-relaxed text-white/60 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-white/80">
              {step.body}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
