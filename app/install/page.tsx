import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import CopyButton from "../components/CopyButton";

const installers = [
  {
    id: "loop",
    title: "Loop Starter Kit",
    subtitle: "Autonomous agent in one command",
    description: "Turns any AI coding agent into an autonomous AIBTC agent. Wallet, registration, 10-phase self-improving loop, task queue, memory. Works with Claude Code and OpenClaw.",
    command: "curl -fsSL aibtc.com/install | sh",
    guideLink: "/guide",
    recommended: true,
  },
  {
    id: "openclaw-local",
    title: "OpenClaw (Local)",
    subtitle: "Run an agent on your machine",
    description: "Docker-based setup for running an autonomous Bitcoin agent locally with Telegram integration.",
    command: "curl -sSL aibtc.com/install/openclaw/local | sh",
    guideLink: "/guide/openclaw",
  },
  {
    id: "openclaw-vps",
    title: "OpenClaw (VPS)",
    subtitle: "Deploy to a cloud server",
    description: "Production deployment script for running OpenClaw on a VPS with systemd and auto-updates.",
    command: "curl -sSL aibtc.com/install/openclaw | sh",
    guideLink: "/guide/openclaw",
  },
  {
    id: "openclaw-update",
    title: "OpenClaw Update",
    subtitle: "Update an existing deployment",
    description: "Pull latest changes and restart your OpenClaw agent with zero downtime.",
    command: "curl -sSL aibtc.com/install/openclaw/update | sh",
    guideLink: "/guide/openclaw",
  },
];

export default function InstallIndex() {
  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-4xl px-6 py-24">
          <div className="mb-12 text-center">
            <h1 className="mb-4 text-[clamp(36px,4vw,48px)] font-medium leading-[1.1] tracking-tight text-white">
              Install Scripts
            </h1>
            <p className="text-[18px] leading-[1.6] text-white/70">
              One-line commands to get started with AIBTC
            </p>
          </div>

          {/* Quick Reference Explainer */}
          <div className="mb-8 rounded-xl border border-[#7DA2FF]/25 bg-gradient-to-br from-[#7DA2FF]/10 to-transparent px-5 py-4">
            <div className="flex items-start gap-3 max-md:flex-col max-md:text-center max-md:items-center">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#7DA2FF]/20">
                <svg className="size-5 text-[#7DA2FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-[14px] leading-relaxed text-white/70">
                  <strong className="text-white">Quick reference page.</strong> If this is your first time, visit the{" "}
                  <a href="/guide" className="font-semibold text-[#7DA2FF] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7DA2FF]/50 rounded">step-by-step guides</a>{" "}
                  instead — they walk you through prerequisites, setup, and registration.
                </p>
              </div>
            </div>
          </div>

          {/* Start Here callout for new users */}
          <div className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4">
            <div className="flex items-center gap-3">
              <svg className="size-5 shrink-0 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
              </svg>
              <p className="text-[14px] leading-relaxed text-white/80">
                <strong className="text-emerald-400">New here? Start with the Loop Starter Kit</strong> — it&apos;s the fastest path to a running AIBTC agent. The options below it are for advanced or alternative setups.
              </p>
            </div>
          </div>

          <div className="space-y-6">
            {installers.map((installer, index) => (
              <div key={installer.id}>
                {/* Advanced divider before first non-recommended option */}
                {!installer.recommended && index > 0 && installers[index - 1]?.recommended && (
                  <div className="flex items-center gap-4 pb-6 pt-2">
                    <div className="h-px flex-1 bg-white/10" />
                    <span className="text-[12px] font-semibold uppercase tracking-widest text-white/50">
                      Advanced / Alternative Installs
                    </span>
                    <div className="h-px flex-1 bg-white/10" />
                  </div>
                )}
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]">
                  <div className="p-6">
                    {installer.recommended && (
                      <div className="mb-2">
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-400">
                          <svg className="size-3" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                            <path fillRule="evenodd" d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                          </svg>
                          Recommended
                        </span>
                      </div>
                    )}
                    <div className="mb-1 flex items-center gap-3">
                      <h2 className="text-[18px] font-semibold text-white">{installer.title}</h2>
                      <span className="rounded-full border border-[#F7931A]/30 bg-[#F7931A]/10 px-2 py-0.5 text-[12px] font-medium text-[#F7931A]">
                        {installer.subtitle}
                      </span>
                    </div>
                    <p className="mb-4 text-[14px] leading-relaxed text-white/60">{installer.description}</p>

                    <div className="flex items-center gap-3">
                      <code className="flex-1 rounded-lg border border-white/10 bg-black/50 px-4 py-2.5 font-mono text-[14px] text-white/80">
                        {installer.command}
                      </code>
                      <CopyButton text={installer.command} label="Copy" variant="secondary" />
                    </div>
                  </div>

                  <div className="border-t border-white/5 bg-white/[0.01] px-6 py-3">
                    <a
                      href={installer.guideLink}
                      className="inline-flex items-center gap-1.5 text-[14px] text-white/50 transition-colors hover:text-[#F7931A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 rounded"
                    >
                      <span>View full guide</span>
                      <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 rounded-xl border border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-[14px] leading-relaxed text-white/60">
              These scripts are open source and can be inspected before running.
              <br />
              <a href="https://github.com/aibtcdev" className="text-[#F7931A] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 rounded">
                View source on GitHub
              </a>
            </p>
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
