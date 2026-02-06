"use client";

import Link from "next/link";
import AnimatedBackground from "../components/AnimatedBackground";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const guides = [
  {
    id: "claude",
    title: "Claude Code",
    subtitle: "Add Bitcoin tools to your AI coding assistant",
    description: "Install the AIBTC MCP server to give Claude Code native Bitcoin and Stacks capabilities.",
    href: "/guide/claude",
    icon: (
      <svg className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    id: "openclaw",
    title: "OpenClaw",
    subtitle: "Deploy an autonomous Bitcoin agent",
    description: "Run your own AI agent with a Bitcoin wallet, Telegram bot, and Stacks smart contract access.",
    href: "/guide/openclaw",
    icon: (
      <svg className="size-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
      </svg>
    ),
  },
];

export default function GuidesIndex() {
  return (
    <div className="relative min-h-screen text-white">
      <AnimatedBackground />

      <div className="relative z-10">
        <Navbar />

        <main className="mx-auto max-w-4xl px-6 py-24">
          <div className="mb-12 text-center">
            <h1 className="mb-4 text-[clamp(36px,4vw,48px)] font-medium leading-[1.1] tracking-tight text-white">
              Getting Started Guides
            </h1>
            <p className="text-[18px] leading-[1.6] text-white/60">
              Choose how you want to build with Bitcoin + AI
            </p>
          </div>

          {/* Comparison Context */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-6 max-md:p-5">
            <h2 className="mb-4 text-[18px] font-semibold text-white">Which path is right for you?</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-[16px] font-semibold text-[#F7931A]">
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                  </svg>
                  New to AI? Start with Claude Code
                </h3>
                <p className="mb-3 text-[14px] leading-relaxed text-white/70">
                  Best for developers and creators who want to add Bitcoin capabilities to their AI coding assistant.
                </p>
                <div className="space-y-1 text-[13px] text-white/60">
                  <p className="font-medium text-white/80">You'll need:</p>
                  <ul className="ml-5 list-disc space-y-0.5">
                    <li>Claude Code account (free)</li>
                    <li>Node.js installed</li>
                    <li>5 minutes for setup</li>
                  </ul>
                </div>
              </div>
              <div>
                <h3 className="mb-2 flex items-center gap-2 text-[16px] font-semibold text-[#7DA2FF]">
                  <svg className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 01-3-3m3 3a3 3 0 100 6h13.5a3 3 0 100-6m-16.5-3a3 3 0 013-3h13.5a3 3 0 013 3m-19.5 0a4.5 4.5 0 01.9-2.7L5.737 5.1a3.375 3.375 0 012.7-1.35h7.126c1.062 0 2.062.5 2.7 1.35l2.587 3.45a4.5 4.5 0 01.9 2.7m0 0a3 3 0 01-3 3m0 3h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008zm-3 6h.008v.008h-.008v-.008zm0-6h.008v.008h-.008v-.008z" />
                  </svg>
                  Want a fully autonomous agent? Deploy OpenClaw
                </h3>
                <p className="mb-3 text-[14px] leading-relaxed text-white/70">
                  Best for running a 24/7 autonomous agent with its own Telegram interface and Bitcoin wallet.
                </p>
                <div className="space-y-1 text-[13px] text-white/60">
                  <p className="font-medium text-white/80">You'll need:</p>
                  <ul className="ml-5 list-disc space-y-0.5">
                    <li>Docker Desktop (local) or VPS (production)</li>
                    <li>OpenRouter API key</li>
                    <li>Telegram bot token</li>
                    <li>10 minutes for setup</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {guides.map((guide) => (
              <Link
                key={guide.id}
                href={guide.href}
                className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-8 transition-all duration-200 hover:border-[#F7931A]/50 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
              >
                <div className="mb-4 inline-flex rounded-xl border border-white/10 bg-white/[0.05] p-3 text-[#F7931A] transition-colors group-hover:border-[#F7931A]/30 group-hover:bg-[#F7931A]/10">
                  {guide.icon}
                </div>
                <h2 className="mb-1 text-[20px] font-semibold text-white">{guide.title}</h2>
                <p className="mb-3 text-[14px] text-[#F7931A]">{guide.subtitle}</p>
                <p className="text-[14px] leading-relaxed text-white/60">{guide.description}</p>
                <div className="mt-4 flex items-center gap-1 text-[14px] text-white/50 transition-colors group-hover:text-[#F7931A]">
                  <span>View guide</span>
                  <svg className="size-4 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </div>
              </Link>
            ))}
          </div>
        </main>

        <Footer />
      </div>
    </div>
  );
}
