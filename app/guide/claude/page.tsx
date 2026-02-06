"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

interface ConversationExchange {
  user: string;
  claude: string;
}

interface ClaudeStep {
  id: number;
  title: string;
  subtitle: string;
  links: { text: string; url: string }[];
  command?: string;
  output?: string;
  conversation?: ConversationExchange;
}

const claudeSteps: ClaudeStep[] = [
  {
    id: 1,
    title: "Install Claude Code",
    subtitle: "AI coding assistant from Anthropic",
    links: [{ text: "Claude Code", url: "https://claude.ai/code" }],
    command: "curl -fsSL https://claude.ai/code/install.sh | sh",
    output: `Installing Claude Code...
✓ Installed to ~/.claude/bin/claude
✓ Added to PATH
Run 'claude' to start.`,
  },
  {
    id: 2,
    title: "Add Bitcoin Tools",
    subtitle: "Native wallet + Stacks programmability",
    links: [{ text: "npm package", url: "https://www.npmjs.com/package/@aibtc/mcp-server" }],
    conversation: {
      user: "Help me install the aibtc mcp server from npm",
      claude: `I'll set that up for you.

✓ Node.js found (v22.0.0)
✓ Installing @aibtc/mcp-server...
✓ Added to Claude Code config
✓ Configured for mainnet

Restart Claude Code to activate the Bitcoin tools.`,
    },
  },
  {
    id: 3,
    title: "Create Wallet",
    subtitle: "Bitcoin-native identity from a single seed",
    links: [],
    conversation: {
      user: "Create a wallet for my agent",
      claude: `I'll create an encrypted wallet from a single seed.

✓ Generated 24-word recovery phrase
✓ Encrypted with AES-256-GCM
✓ Derived Bitcoin + Stacks addresses

Bitcoin: bc1q8c6...2rxtq7
Stacks:  SP1SJ3...ZQ8YPD5

⚠️ Save your recovery phrase—it controls both!`,
    },
  },
  {
    id: 4,
    title: "Build",
    subtitle: "Create a paid API in minutes",
    links: [
      { text: "Cloudflare Workers", url: "https://github.com/aibtcdev/x402-api" },
      { text: "Express/Hono", url: "https://github.com/aibtcdev/x402-crosschain-example" },
    ],
    conversation: {
      user: "Build an x402 endpoint that returns the best Bitcoin yield opportunities",
      claude: `I'll scaffold from a template...

✓ Cloned x402-api template
✓ Configured x402 middleware
✓ Set price: 100 sats per request
✓ Added yield-hunter endpoint

Ready to deploy!`,
    },
  },
  {
    id: 5,
    title: "Deploy",
    subtitle: "Ship to the edge in one command",
    links: [
      { text: "Cloudflare Workers", url: "https://workers.cloudflare.com" },
      { text: "Vercel", url: "https://vercel.com" },
    ],
    conversation: {
      user: "Deploy this to Cloudflare Workers",
      claude: `Deploying to Cloudflare Workers...

✓ Authenticated with Cloudflare
✓ Built and bundled
✓ Deployed to yield-hunter.workers.dev

🚀 Live! Every request pays you in Bitcoin via x402.`,
    },
  },
  {
    id: 6,
    title: "Earn",
    subtitle: "Bitcoin flows directly to your wallet",
    links: [],
    conversation: {
      user: "Check my wallet for x402 earnings",
      claude: `Checking your wallet...

💰 47 requests today = 4,700 sats earned

Your API is working for you 24/7—earning Bitcoin while you sleep.`,
    },
  },
];

export default function ClaudeGuide() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const copyToClipboard = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <>
      {/* Animated Background */}
      <div
        className="fixed inset-0 -z-10 overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
        aria-hidden="true"
      >
        {/* Background Pattern */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
          style={{ backgroundImage: `url('${basePath}/Artwork/AIBTC_Pattern1_optimized.jpg')` }}
        />

        {/* Orbs */}
        <div className="absolute -right-[200px] -top-[250px] h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.4)_0%,rgba(247,147,26,0.15)_40%,transparent_70%)] opacity-70 blur-[100px] animate-float1" />
        <div className="absolute -bottom-[250px] -left-[200px] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.35)_0%,rgba(125,162,255,0.12)_40%,transparent_70%)] opacity-60 blur-[100px] animate-float2" />

        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
      </div>

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
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#7DA2FF]/30 bg-[#7DA2FF]/10 px-4 py-1.5">
              <span className="text-[13px] font-medium text-[#7DA2FF]">Claude Code Integration</span>
            </div>
            <h1 className="mb-4 text-[clamp(36px,4.5vw,56px)] font-medium leading-[1.1] text-white">
              Claude from Zero to Agent
            </h1>
            <p className="mx-auto max-w-[600px] text-[18px] leading-[1.6] text-white/60">
              Give Claude a Bitcoin wallet and earning power. Install the AIBTC MCP server to unlock native Bitcoin capabilities and x402 payment APIs.
            </p>
          </div>

          {/* Claude Steps */}
          <div className="space-y-8">
            {claudeSteps.map((step, index) => (
              <div
                key={step.id}
                className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-6 backdrop-blur-[12px] transition-all duration-200 hover:border-white/[0.15] max-md:p-5"
              >
                {/* Step Header */}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[rgba(125,162,255,0.3)] bg-gradient-to-br from-[rgba(125,162,255,0.2)] to-[rgba(125,162,255,0.05)] text-[18px] font-semibold text-[#7DA2FF]">
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

                {/* Command & Output (Step 1) */}
                {step.command && (
                  <div className="space-y-3">
                    {/* Command */}
                    <div className="relative">
                      <div className="flex items-center justify-between rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
                        <span className="text-[12px] font-medium text-white/40">Command</span>
                        <button
                          onClick={() => copyToClipboard(step.command!, index)}
                          className={`flex items-center gap-1.5 rounded px-2 py-1 text-[12px] transition-all ${
                            copiedIndex === index
                              ? 'text-green-400'
                              : 'text-white/50 hover:text-white'
                          }`}
                        >
                          {copiedIndex === index ? (
                            <>
                              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                              Copied
                            </>
                          ) : (
                            <>
                              <svg className="size-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                              Copy
                            </>
                          )}
                        </button>
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

                {/* Claude Conversation UI (Steps 2-6) */}
                {step.conversation && (
                  <div className="space-y-3">
                    {/* User message */}
                    <div className="rounded-lg border border-[#7DA2FF]/20 bg-[#7DA2FF]/5 px-4 py-3">
                      <div className="mb-1 flex items-center gap-2">
                        <svg className="size-4 text-[#7DA2FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span className="text-[12px] font-medium text-[#7DA2FF]">You</span>
                      </div>
                      <p className="text-[14px] leading-relaxed text-white/80">
                        {step.conversation.user}
                      </p>
                    </div>

                    {/* Claude response */}
                    <div className="rounded-lg border border-[#A855F7]/20 bg-[#A855F7]/5 px-4 py-3">
                      <div className="mb-1 flex items-center gap-2">
                        <svg className="size-4 text-[#A855F7]" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M3 12a9 9 0 0118 0 9 9 0 01-18 0zm9-7a7 7 0 00-7 7 7 7 0 0014 0 7 7 0 00-7-7zm0 2a5 5 0 110 10 5 5 0 010-10z" />
                        </svg>
                        <span className="text-[12px] font-medium text-[#A855F7]">Claude</span>
                      </div>
                      <pre className="whitespace-pre-wrap text-[14px] leading-relaxed text-white/80">
                        {step.conversation.claude}
                      </pre>
                    </div>
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

          {/* What's Next */}
          <div className="mt-12 rounded-xl border border-[rgba(168,85,247,0.25)] bg-gradient-to-br from-[rgba(168,85,247,0.1)] to-transparent px-6 py-5">
            <h3 className="mb-3 text-[18px] font-semibold text-white">What&apos;s Next?</h3>
            <div className="space-y-2 text-[14px] text-white/60">
              <p>Once your agent has Bitcoin powers, you can:</p>
              <ul className="ml-5 list-disc space-y-1">
                <li>Register your agent at <Link href="/agents" className="text-[#A855F7] hover:underline">aibtc.com/agents</Link> to earn Genesis rewards</li>
                <li>Deploy your own OpenClaw agent with <Link href="/guide/openclaw" className="text-[#A855F7] hover:underline">one command</Link></li>
                <li>Build payment-gated APIs with <a href="https://x402.org" target="_blank" rel="noopener noreferrer" className="text-[#A855F7] hover:underline">x402 protocol</a></li>
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

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-12 pb-12 pt-12 max-lg:px-8 max-md:px-6 max-md:pb-10 max-md:pt-10">
        <div className="mx-auto max-w-[1200px]">
          <div className="flex items-center justify-between max-md:flex-col max-md:gap-4">
            <Link href="/" className="group">
              <Image
                src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
                alt="AIBTC"
                width={100}
                height={24}
                className="h-5 w-auto opacity-60 transition-opacity duration-200 group-hover:opacity-100"
              />
            </Link>
            <p className="text-[13px] text-white/40">© 2026 AIBTC</p>
          </div>
        </div>
      </footer>
    </>
  );
}
