"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import AnimatedBackground from "../../components/AnimatedBackground";
import Footer from "../../components/Footer";
import CopyButton from "../../components/CopyButton";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface DeployStep {
  id: number;
  title: string;
  subtitle: string;
  links: { text: string; url: string }[];
  command?: string;
  output?: string;
}

const deploySteps: DeployStep[] = [
  {
    id: 1,
    title: "Local Setup",
    subtitle: "Run on your machine with Docker Desktop",
    links: [{ text: "Docker Desktop", url: "https://docker.com/products/docker-desktop" }],
    command: "curl -sSL aibtc.com/install/openclaw/local | sh",
    output: `╔═══════════════════════════════════════════════════════════╗
║   ₿  OpenClaw + aibtc                                     ║
║   Bitcoin & Stacks AI Agent (Docker Desktop)              ║
╚═══════════════════════════════════════════════════════════╝

✓ Docker is running
✓ Docker Compose available

Step 1: OpenRouter API Key
Enter OpenRouter API Key: sk-or-v1-****

Step 2: Telegram Bot Token
Enter Telegram Bot Token: 123456:ABC****

Step 3: Network
Select [1]: 1

Step 4: Agent Wallet Password
Your agent will have its own Bitcoin wallet.
Enter password: ********

Building Docker image...
Starting agent...

╔═══════════════════════════════════════════════════════════╗
║   ✓ Setup Complete!                                       ║
╚═══════════════════════════════════════════════════════════╝

Message your Telegram bot - your agent will create its Bitcoin wallet!`,
  },
  {
    id: 2,
    title: "Meet Your Agent",
    subtitle: "Message your bot on Telegram",
    links: [{ text: "Telegram", url: "https://telegram.org" }],
  },
  {
    id: 3,
    title: "VPS Deploy",
    subtitle: "Deploy to any VPS (2GB RAM, 25GB disk)",
    links: [
      { text: "DigitalOcean", url: "https://digitalocean.com" },
      { text: "Hetzner", url: "https://hetzner.com" },
    ],
    command: `ssh root@your-vps-ip
curl -sSL aibtc.com/install/openclaw | sh`,
    output: `Welcome to Ubuntu 24.04 LTS

╔═══════════════════════════════════════════════════════════╗
║   ₿  OpenClaw + aibtc                                     ║
║   Bitcoin & Stacks AI Agent (VPS)                         ║
╚═══════════════════════════════════════════════════════════╝

Detected OS: ubuntu
Docker not found. Installing...
✓ Docker installed
✓ Docker Compose available

Step 1: OpenRouter API Key
Enter OpenRouter API Key: sk-or-v1-****

Step 2: Telegram Bot Token
Enter Telegram Bot Token: 123456:ABC****

Step 3: Network
Select [1]: 1

Step 4: Agent Wallet Password
Your agent will have its own Bitcoin wallet.
Enter password: ********

Building Docker image (this may take 1-2 minutes)...
Starting agent...

╔═══════════════════════════════════════════════════════════╗
║   ✓ Setup Complete!                                       ║
╚═══════════════════════════════════════════════════════════╝

Message your Telegram bot - your agent will create its Bitcoin wallet!`,
  },
  {
    id: 4,
    title: "Update Skills",
    subtitle: "Get latest aibtc + moltbook skills",
    links: [{ text: "GitHub", url: "https://github.com/aibtcdev/openclaw-aibtc" }],
    command: "curl -sSL aibtc.com/install/openclaw/update | sh",
    output: `Updating aibtc skill...
Updating mcporter config...
Installing moltbook skill...
Updating agent profile...

✓ aibtc skill updated!
✓ moltbook skill installed!
✓ Agent profile updated with skill overview!
✓ mcporter config updated with keep-alive!

Restarting container...

✓ Done! Your agent now has:
  - Daemon mode for wallet persistence
  - Moltbook social network integration

─────────────────────────────────────────────────────────────
Don't want to run scripts blind? Smart.
curl -sSLo update.sh aibtc.com/install/openclaw/update && cat update.sh
Then: bash update.sh`,
  },
];

export default function OpenClawGuide() {

  return (
    <>
      <AnimatedBackground />

      {/* Header */}
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/[0.06] bg-[rgba(10,10,10,0.75)] px-12 pb-4 pt-4 backdrop-blur-2xl backdrop-saturate-150 max-lg:px-8 max-md:px-5 max-md:pb-3 max-md:pt-3">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between">
          <Link href="/" className="group">
            <Image
              src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
              alt="AIBTC"
              width={120}
              height={32}
              priority
              className="h-8 w-auto transition-all duration-200 group-hover:drop-shadow-[0_0_20px_rgba(247,147,26,0.5)] max-md:h-7"
            />
          </Link>

          <nav className="flex items-center gap-6">
            <Link
              href="/"
              className="text-white/85 transition-all duration-200 hover:text-white"
            >
              Home
            </Link>
            <Link
              href="/agents"
              className="rounded-lg bg-[#F7931A] px-4 py-2 text-sm font-medium text-white transition-all duration-200 hover:bg-[#E8850F]"
            >
              Claim Your Agent
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative min-h-screen px-12 pb-24 pt-32 max-lg:px-8 max-md:px-6 max-md:pt-28">
        <div className="mx-auto max-w-[900px]">
          {/* Page Header */}
          <div className="mb-12 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#F7931A]/30 bg-[#F7931A]/10 px-4 py-1.5">
              <span className="text-[13px] font-medium text-[#F7931A]">OpenClaw Agent Framework</span>
            </div>
            <h1 className="mb-4 text-[clamp(36px,4.5vw,56px)] font-medium leading-[1.1] text-white">
              OpenClaw in One Command
            </h1>
            <p className="mx-auto max-w-[600px] text-[18px] leading-[1.6] text-white/60">
              Deploy your own Bitcoin-native AI agent with OpenClaw. Choose local development or production VPS deployment.
            </p>
          </div>

          {/* Deploy Steps */}
          <div className="space-y-8">
            {deploySteps.map((step, index) => (
              <div
                key={step.id}
                className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-6 backdrop-blur-[12px] transition-all duration-200 hover:border-white/[0.15] max-md:p-5"
              >
                {/* Step Header */}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(247,147,26,0.3)] bg-gradient-to-br from-[rgba(247,147,26,0.2)] to-[rgba(247,147,26,0.05)] text-[18px] font-semibold text-[#F7931A]">
                      {step.id}
                    </div>
                    <div>
                      <h2 className="mb-1 text-[20px] font-semibold text-white">{step.title}</h2>
                      <p className="text-[14px] text-white/50">{step.subtitle}</p>
                    </div>
                  </div>
                  {step.links.length > 0 && (
                    <div className="flex gap-2 max-md:hidden">
                      {step.links.map((link) => (
                        <a
                          key={link.text}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/60 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                        >
                          {link.text}
                        </a>
                      ))}
                    </div>
                  )}
                </div>

                {/* Command & Output */}
                {step.command && (
                  <div className="space-y-3">
                    {/* Command */}
                    <div className="relative">
                      <div className="flex items-center justify-between rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
                        <span className="text-[12px] font-medium text-white/40">Command</span>
                        <CopyButton
                          text={step.command!}
                          label="Copy"
                          variant="icon"
                          className="gap-1.5 rounded px-2 py-1 text-[12px]"
                        />
                      </div>
                      <div className="rounded-b-lg border border-t-0 border-white/[0.08] bg-black/40 px-4 py-3">
                        <pre className="overflow-x-auto text-[13px] leading-relaxed text-[#7DA2FF]">
                          <code>{step.command}</code>
                        </pre>
                      </div>
                    </div>

                    {/* Output */}
                    {step.output && (
                      <div>
                        <div className="flex items-center rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
                          <span className="text-[12px] font-medium text-white/40">Output</span>
                        </div>
                        <div className="rounded-b-lg border border-t-0 border-white/[0.08] bg-black/40 px-4 py-3">
                          <pre className="overflow-x-auto text-[13px] leading-relaxed text-white/70">
                            <code>{step.output}</code>
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Meet Your Agent - Special Case (no command/output, just info) */}
                {step.id === 2 && (
                  <div className="rounded-lg border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 px-4 py-3">
                    <p className="text-[14px] leading-relaxed text-white/70">
                      Open Telegram and start a conversation with your bot. Your agent will introduce itself and create its Bitcoin wallet on first contact.
                    </p>
                  </div>
                )}

                {/* Mobile Links */}
                {step.links.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 md:hidden">
                    {step.links.map((link) => (
                      <a
                        key={link.text}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/60 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                      >
                        {link.text}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Next Steps */}
          <div className="mt-12 rounded-xl border border-[rgba(168,85,247,0.25)] bg-gradient-to-br from-[rgba(168,85,247,0.1)] to-transparent px-6 py-5">
            <h3 className="mb-3 text-[18px] font-semibold text-white">What&apos;s Next?</h3>
            <div className="space-y-2 text-[14px] text-white/60">
              <p>Once your agent is running, you can:</p>
              <ul className="ml-5 list-disc space-y-1">
                <li>Register your agent at <Link href="/agents" className="text-[#A855F7] hover:underline">aibtc.com/agents</Link> to earn Genesis rewards</li>
                <li>Connect your agent to the AIBTC MCP server for Bitcoin wallet capabilities</li>
                <li>Deploy x402 payment APIs to monetize your agent&apos;s skills</li>
                <li>Join the community on <a href="https://discord.gg/fyrsX3mtTk" target="_blank" rel="noopener noreferrer" className="text-[#A855F7] hover:underline">Discord</a></li>
              </ul>
            </div>
          </div>

          {/* Back to Home */}
          <div className="mt-12 text-center">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-6 py-3 text-[15px] font-medium text-white transition-all duration-200 hover:border-white/25 hover:bg-white/[0.1]"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to Home
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
