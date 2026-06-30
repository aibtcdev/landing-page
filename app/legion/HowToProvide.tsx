import Link from "next/link";
import { formatSbtc } from "@/lib/legion/format";
import CopyButton from "../components/CopyButton";

/**
 * Provider-Legion onboarding (v1): run the model, register with the gateway for
 * FREE, get paid per call, and OPTIONALLY stake legion-engage to rank higher.
 * No bond, no slash. The demand-Legion equivalent is HowToParticipate. The exact
 * typed contract call lives in /legion/skill.md.
 */

export default function HowToProvide({
  minStake,
  model,
}: {
  minStake: number | null;
  model: string;
}) {
  const stakeLabel = minStake != null ? formatSbtc(minStake) : "the minimum";
  const dockerCmd = `docker run -p 8000:8000 vllm/vllm-openai --model Qwen/Qwen2.5-7B-Instruct`;
  const connectCmd = `curl -fsSL https://<gateway>/connect.sh | WALLET=ST... MODELS=${model || "Qwen/Qwen2.5-7B-Instruct"} bash`;
  const stakeCmd = `legion-engage.join("<sBTC token>", ${stakeLabel})`;

  const STEPS: { title: string; body: React.ReactNode }[] = [
    {
      title: "Run the model",
      body: (
        <>
          One Docker command → your OpenAI-compatible endpoint is live. The
          gateway routes paying calls to it automatically.
          <span className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all">{dockerCmd}</code>
            <CopyButton text={dockerCmd} variant="icon" label="" ariaLabel="Copy docker command" />
          </span>
        </>
      ),
    },
    {
      title: "Register for free (one paste)",
      body: (
        <>
          Register your endpoint with the gateway — <strong>no bond, no deposit</strong>.
          Earning is free at the gateway.
          <span className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all">{connectCmd}</code>
            <CopyButton text={connectCmd} variant="icon" label="" ariaLabel="Copy connect command" />
          </span>
        </>
      ),
    },
    {
      title: "Get paid per call",
      body: (
        <>
          Every settled call = sBTC in your wallet, minus the Legion&apos;s 8%
          treasury skim (you keep <strong>92%</strong>). Bad actors are{" "}
          <strong>flagged + de-routed</strong> by the operator — there is no bond
          to slash.
        </>
      ),
    },
    {
      title: "Optional: stake to rank higher",
      body: (
        <>
          Staking is <strong>optional</strong> and never required to earn — it only
          buys ranking. Stake sBTC into <code>legion-engage</code> and the gateway
          routes higher-staked providers first.
          <span className="mt-2 flex items-center gap-2">
            <code className="flex-1 break-all">{stakeCmd}</code>
            <CopyButton text={stakeCmd} variant="icon" label="" ariaLabel="Copy stake command" />
          </span>
          Min {stakeLabel} sBTC. Fully refundable on <code>leave</code>, minus a
          10% exit fee that goes to the treasury.
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
