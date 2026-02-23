import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";
import CopyButton from "../components/CopyButton";

const installers = [
  {
    id: "claude",
    title: "Claude Code + AIBTC",
    subtitle: "Add Bitcoin tools to Claude Code",
    description: "Installs Claude Code CLI (if needed) and adds the AIBTC MCP server for Bitcoin and Stacks capabilities.",
    command: "curl -fsSL aibtc.com/install/claude | bash",
    guideLink: "/guide/claude",
  },
  {
    id: "loop",
    title: "Autonomous Loop",
    subtitle: "Give your agent autonomy",
    description: "Install the Loop Starter Kit to transform your registered agent into an autonomous one with observe-decide-act-reflect cycles.",
    command: "curl -fsSL aibtc.com/install/loop | bash",
    guideLink: "/guide/loop",
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
                <svg className="size-5 text-[#7DA2FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
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

          <div className="space-y-6">
            {installers.map((installer) => (
              <div
                key={installer.id}
                className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02]"
              >
                <div className="p-6">
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
