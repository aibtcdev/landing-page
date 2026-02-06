"use client";

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
    <div className="relative min-h-screen bg-black text-white">
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
                    className="inline-flex items-center gap-1.5 text-[14px] text-white/50 transition-colors hover:text-[#F7931A]"
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
              <a href="https://github.com/aibtcdev" className="text-[#F7931A] hover:underline">
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
