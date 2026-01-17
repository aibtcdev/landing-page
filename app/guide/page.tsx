"use client";

import { useState } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";

const steps = [
  {
    num: 1,
    title: "Setting Up Claude Code",
    time: "~5 min",
    navLabel: "Setup",
  },
  {
    num: 2,
    title: "Setting Up Your Agent's Bitcoin Wallet",
    time: "~5 min",
    navLabel: "Wallet",
  },
  {
    num: 3,
    title: "Creating an x402 Endpoint",
    time: "~15 min",
    navLabel: "x402",
  },
  {
    num: 4,
    title: "Putting It All Together",
    time: "~5 min",
    navLabel: "Build",
  },
];

const faqs = [
  {
    q: "Do I need to know how to code?",
    a: "Not really. Claude Code writes the code for you. Just describe what you want in plain English.",
  },
  {
    q: "Is this safe to use with real money?",
    a: "Start on testnet. Only move to mainnet once you understand what's happening. Always use a dedicated agent wallet, never your personal funds.",
  },
  {
    q: "What can I build with this?",
    a: null,
    list: [
      "Pay-per-query AI endpoints",
      "Premium content APIs",
      "Agent-to-agent payment flows",
      "Automated trading bots",
      "DAO participation tools",
    ],
  },
  {
    q: "What if something breaks?",
    a: "Ask Claude. Paste the error message and ask it to help you debug. That's the vibe coder way.",
  },
];

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <pre className="relative my-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#09090b] p-4 pr-12">
      <code className="font-mono text-[13px] leading-relaxed text-white/70">{children}</code>
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.05] text-white/40 transition-[color,border-color] hover:border-white/20 hover:text-white/70 max-md:size-10 max-md:opacity-100"
        aria-label="Copy code"
      >
        {copied ? (
          <svg className="size-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>
    </pre>
  );
}

function Callout({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="my-4 flex gap-3 rounded-xl border border-[#F7931A]/20 bg-[#F7931A]/[0.08] p-4 text-sm text-white/70">
      <span className="flex-shrink-0 text-base">{icon}</span>
      <div>{children}</div>
    </div>
  );
}

export default function GuidePage() {
  const [openStep, setOpenStep] = useState(1);
  const [allExpanded, setAllExpanded] = useState(false);
  const [openFaqs, setOpenFaqs] = useState<number[]>([]);

  const toggleStep = (num: number) => {
    if (allExpanded) return;
    setOpenStep(openStep === num ? 0 : num);
  };

  const toggleAllSteps = () => {
    setAllExpanded(!allExpanded);
  };

  const toggleFaq = (idx: number) => {
    setOpenFaqs((prev) =>
      prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx]
    );
  };

  const isStepOpen = (num: number) => allExpanded || openStep === num;

  return (
    <div className="min-h-dvh bg-[#09090b] font-[system-ui,-apple-system,sans-serif] text-white">
      <Navbar />

      {/* Hero */}
      <section className="relative px-6 pb-12 pt-28 text-center">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[300px] w-full max-w-[600px] -translate-x-1/2 bg-[radial-gradient(ellipse_at_center_top,rgba(247,147,26,0.08)_0%,transparent_70%)]" />
        <div className="relative">
          <div className="mb-5 inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/[0.08] px-3.5 py-1.5 text-xs text-[#F7931A]">
            <span className="size-1.5 motion-safe:animate-pulse rounded-full bg-[#F7931A]" />
            Guide
          </div>
          <h1 className="mb-4 text-balance bg-gradient-to-br from-white to-[#F7931A] bg-clip-text text-[clamp(1.875rem,5vw,2.5rem)] font-medium leading-tight text-transparent">
            Vibe Coding with Bitcoin Agents
          </h1>
          <p className="mx-auto max-w-[460px] text-[17px] leading-relaxed text-white/60">
            Build AI agents with their own Bitcoin wallets and payment-gated APIs. No coding experience required.
          </p>
        </div>
      </section>

      {/* Overview Cards */}
      <section className="px-6 pb-12">
        <div className="mx-auto max-w-[900px]">
          <p className="mb-4 text-center text-[11px] font-medium uppercase tracking-widest text-white/40">
            What you'll build
          </p>
          <div className="grid gap-3 md:grid-cols-3">
            {/* Claude Code Card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-white/[0.15]">
              <div className="mb-3.5 flex size-10 items-center justify-center rounded-lg bg-[#D97757]/[0.12]">
                <svg className="size-5 text-[#D97757]" viewBox="0 0 16 16" fill="currentColor">
                  <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
                </svg>
              </div>
              <h3 className="mb-1.5 text-balance text-[15px] font-medium">Claude Code Setup</h3>
              <p className="mb-3 text-[13px] leading-relaxed text-white/50">An AI coding assistant that writes and runs code in your terminal.</p>
              <p className="text-[13px] font-medium text-[#F7931A]">Build in hours what used to take weeks.</p>
            </div>

            {/* Agent Wallet Card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-white/[0.15]">
              <div className="mb-3.5 flex size-10 items-center justify-center rounded-lg bg-[#F7931A]/[0.12]">
                <svg className="size-5 text-[#F7931A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="6" width="20" height="14" rx="2" />
                  <path d="M22 10H2" />
                  <path d="M6 14h4" />
                </svg>
              </div>
              <h3 className="mb-1.5 text-balance text-[15px] font-medium">Agent Wallet</h3>
              <p className="mb-3 text-[13px] leading-relaxed text-white/50">Your AI gets its own Stacks wallet to hold and send funds.</p>
              <p className="text-[13px] font-medium text-[#F7931A]">Give your agent a secure wallet to earn and spend on your behalf.</p>
            </div>

            {/* x402 Endpoints Card */}
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5 transition-[transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-white/[0.15]">
              <div className="mb-3.5 flex size-10 items-center justify-center rounded-lg bg-[#B4CCFF]/[0.12]">
                <svg className="size-5 text-[#B4CCFF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                </svg>
              </div>
              <h3 className="mb-1.5 text-balance text-[15px] font-medium">x402 Endpoints</h3>
              <p className="mb-3 text-[13px] leading-relaxed text-white/50">Payment-gated APIs that accept STX, sBTC, or USDCx.</p>
              <p className="text-[13px] font-medium text-[#F7931A]">Monetize your agent's work while you sleep.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto h-px w-[200px] bg-gradient-to-r from-transparent via-white/[0.15] to-transparent" />

      {/* Guide Steps */}
      <section className="px-6 py-12" id="guide">
        <div className="mx-auto max-w-[720px]">
          <div className="mb-10 text-center">
            <h2 className="mb-2 text-balance text-2xl font-normal">The Guide</h2>
            <p className="text-[15px] text-white/60">
              Follow the steps below. Click each section to expand.{" "}
              <span className="font-medium text-[#F7931A]">~30 min total</span>
            </p>
          </div>

          {/* Progress Nav */}
          <nav className="mb-8 flex flex-wrap justify-center gap-2">
            {steps.map((step) => (
              <button
                key={step.num}
                onClick={() => {
                  setAllExpanded(false);
                  setOpenStep(step.num);
                }}
                className={`flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] transition-[color,background-color,border-color] ${
                  openStep === step.num && !allExpanded
                    ? "border-[#F7931A] bg-[#F7931A]/[0.08] text-[#F7931A]"
                    : "border-white/[0.08] text-white/50 hover:border-white/[0.15] hover:text-white/70"
                }`}
              >
                <span
                  className={`flex size-5 items-center justify-center rounded-full text-[11px] font-medium ${
                    openStep === step.num && !allExpanded ? "bg-[#F7931A] text-[#09090b]" : "bg-white/[0.08]"
                  }`}
                >
                  {step.num}
                </span>
                {step.navLabel}
              </button>
            ))}
            <button
              onClick={toggleAllSteps}
              className="rounded px-2 py-1 text-[13px] text-white/50 transition-colors hover:bg-white/[0.05] hover:text-white/70"
            >
              {allExpanded ? "Collapse all" : "Expand all"}
            </button>
          </nav>

          {/* Step 1 */}
          <div className={`mb-4 overflow-hidden rounded-2xl border transition-colors ${isStepOpen(1) ? "border-[#F7931A]/30" : "border-white/[0.08] hover:border-white/[0.15]"} bg-[#18181b]`}>
            <button onClick={() => toggleStep(1)} className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center gap-3.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-[#F7931A]/[0.15] text-[13px] font-medium text-[#F7931A]">1</div>
                <h3 className="text-balance text-base font-normal">Setting Up Claude Code</h3>
                <span className="rounded-full bg-[#09090b] px-2 py-1 text-[11px] text-white/50">~5 min</span>
              </div>
              <svg className={`size-5 text-white/50 transition-transform ${isStepOpen(1) ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isStepOpen(1) && (
              <div className="border-t border-white/[0.08] px-5 pb-5 pt-5">
                <p className="mb-4 text-[15px] text-white/60">Claude Code lets you build with AI that can read, write, and run code. Choose whichever setup works best for you.</p>

                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Option A: Claude App (Easiest)</h4>
                <p className="mb-3 text-[15px] text-white/60">If you have the Claude desktop app, Claude Code is built right in. Just open a project folder and start building.</p>
                <ol className="mb-4 list-decimal space-y-2 pl-5 text-[15px] text-white/60">
                  <li>Download <a href="https://claude.ai/download" target="_blank" className="text-[#60A5FA] hover:underline">Claude for Desktop</a> if you don't have it</li>
                  <li>Open a project folder (or create a new one)</li>
                  <li>Start chatting — Claude can now read and edit files in that folder</li>
                </ol>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Option B: Terminal</h4>
                <p className="mb-3 text-[15px] text-white/60">Prefer the command line? Install Claude Code globally via npm.</p>

                <p className="text-[15px] text-white/60"><strong className="text-white">Step 1: Install Node.js</strong></p>
                <p className="mb-3 text-[15px] text-white/60">Go to <a href="https://nodejs.org" target="_blank" className="text-[#60A5FA] hover:underline">nodejs.org</a> and download the LTS version.</p>

                <p className="text-[15px] text-white/60"><strong className="text-white">Step 2: Open a new Terminal window</strong></p>
                <p className="mb-3 text-[15px] text-white/60">Close Terminal and open it again. This ensures Node.js is ready to use.</p>

                <p className="text-[15px] text-white/60"><strong className="text-white">Step 3: Install Claude Code</strong></p>
                <CodeBlock>npm install -g @anthropic-ai/claude-code</CodeBlock>

                <p className="text-[15px] text-white/60"><strong className="text-white">Step 4: Run it</strong></p>
                <CodeBlock>claude</CodeBlock>

                <p className="mb-4 text-[15px] text-white/60">The first time you run it, Claude Code will ask you to log in with your Anthropic account.</p>

                <Callout icon="💡">Once you're set up, try asking: <strong className="text-[#F7931A]">"What can you help me build?"</strong></Callout>
              </div>
            )}
          </div>

          {/* Step 2 */}
          <div className={`mb-4 overflow-hidden rounded-2xl border transition-colors ${isStepOpen(2) ? "border-[#F7931A]/30" : "border-white/[0.08] hover:border-white/[0.15]"} bg-[#18181b]`}>
            <button onClick={() => toggleStep(2)} className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center gap-3.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-[#F7931A]/[0.15] text-[13px] font-medium text-[#F7931A]">2</div>
                <h3 className="text-balance text-base font-normal">Setting Up Your Agent's Bitcoin Wallet</h3>
                <span className="rounded-full bg-[#09090b] px-2 py-1 text-[11px] text-white/50">~5 min</span>
              </div>
              <svg className={`size-5 text-white/50 transition-transform ${isStepOpen(2) ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isStepOpen(2) && (
              <div className="border-t border-white/[0.08] px-5 pb-5 pt-5">
                <p className="mb-4 text-[15px] text-white/60">Your AI agent needs its own wallet to send and receive payments. We'll use the stx402 MCP to give Claude wallet capabilities.</p>

                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Step 1: Add the Wallet Capability to Claude</h4>
                <p className="mb-2 text-[15px] text-white/60">Copy and paste this command into Claude Code:</p>
                <CodeBlock>claude mcp add stx402 npx stx402-agent -e NETWORK=mainnet</CodeBlock>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Step 2: Create Your Agent's Wallet</h4>
                <p className="mb-2 text-[15px] text-white/60">Type this to Claude:</p>
                <CodeBlock>"Create a secure Stacks wallet"</CodeBlock>
                <p className="mb-4 text-[15px] text-white/60">Claude will ask you to set a password. Choose a strong password and remember it — this encrypts your wallet locally. <strong className="text-white">That's it. Your agent now has a wallet.</strong></p>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Step 3: Fund the Wallet</h4>
                <p className="mb-2 text-[15px] text-white/60">Ask Claude:</p>
                <CodeBlock>"What is my wallet address?"</CodeBlock>
                <p className="mb-4 text-[15px] text-white/60">Send STX or sBTC to this address to fund your agent's wallet.</p>

                <Callout icon="🧪"><strong className="text-[#F7931A]">Want to practice first?</strong> Use <code className="rounded bg-[#F7931A]/[0.08] px-1.5 py-0.5 text-[13px] text-[#F7931A]">NETWORK=testnet</code> in step 1, then get free test STX from the <a href="https://explorer.hiro.so/sandbox/faucet?chain=testnet" target="_blank" className="text-[#60A5FA] hover:underline">Stacks faucet</a>.</Callout>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />What Your Agent Can Do Now</h4>
                <ul className="mb-4 list-disc space-y-1 pl-5 text-[15px] text-white/60">
                  <li>Hold and transfer STX and sBTC</li>
                  <li>Interact with Stacks smart contracts</li>
                  <li>Pay for x402 API services automatically</li>
                  <li>Trade on ALEX DEX</li>
                  <li>Use Zest Protocol for lending/borrowing</li>
                </ul>

                <Callout icon="🔒"><strong className="text-[#F7931A]">Security tips:</strong> Your wallet is encrypted and stored locally (<code className="rounded bg-[#F7931A]/[0.08] px-1.5 py-0.5 text-[13px] text-[#F7931A]">~/.stx402/</code>). Never share your password or mnemonic phrase.</Callout>
              </div>
            )}
          </div>

          {/* Step 3 */}
          <div className={`mb-4 overflow-hidden rounded-2xl border transition-colors ${isStepOpen(3) ? "border-[#F7931A]/30" : "border-white/[0.08] hover:border-white/[0.15]"} bg-[#18181b]`}>
            <button onClick={() => toggleStep(3)} className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center gap-3.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-[#F7931A]/[0.15] text-[13px] font-medium text-[#F7931A]">3</div>
                <h3 className="text-balance text-base font-normal">Creating an x402 Endpoint</h3>
                <span className="rounded-full bg-[#09090b] px-2 py-1 text-[11px] text-white/50">~15 min</span>
              </div>
              <svg className={`size-5 text-white/50 transition-transform ${isStepOpen(3) ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isStepOpen(3) && (
              <div className="border-t border-white/[0.08] px-5 pb-5 pt-5">
                <p className="mb-4 text-[15px] text-white/60">x402 lets you charge for API access using crypto. When someone hits your endpoint without paying, they get a 402 "Payment Required" response. Once they pay, they get the content.</p>

                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />The AIBTC x402 Stack</h4>
                <ul className="mb-4 list-disc space-y-1 pl-5 text-[15px] text-white/60">
                  <li><strong className="text-white">x402.aibtc.dev</strong> (testnet) — The API host</li>
                  <li><strong className="text-white">x402-sponsor-relay</strong> — Gasless transactions for agents</li>
                  <li><strong className="text-white">Supported tokens:</strong> STX, sBTC, USDCx</li>
                </ul>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Option A: Use Existing x402 API</h4>
                <p className="mb-2 text-[15px] text-white/60">The easiest path — consume AIBTC's existing endpoints:</p>
                <CodeBlock>{`# This returns 402 with payment requirements
curl https://x402.aibtc.dev/inference/chat`}</CodeBlock>
                <p className="mb-4 text-[15px] text-white/60">Ask Claude: <strong className="text-white">"Help me write a script that calls x402.aibtc.dev and handles the payment flow."</strong></p>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Option B: Deploy Your Own Endpoint</h4>
                <p className="mb-2 text-[15px] text-white/60">Create your own payment-gated API:</p>
                <CodeBlock>{`# Clone the x402-api template
git clone https://github.com/aibtcdev/x402-api.git
cd x402-api
npm install`}</CodeBlock>
                <p className="mb-2 text-[15px] text-white/60">Ask Claude: <strong className="text-white">"Help me add an endpoint that charges 0.001 STX to return a joke."</strong></p>
                <CodeBlock>{`# Deploy to Cloudflare
npx wrangler login
npx wrangler deploy --env staging`}</CodeBlock>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Option C: Gasless Transactions</h4>
                <p className="mb-2 text-[15px] text-white/60">Use the sponsor relay so your agent doesn't need STX for gas:</p>
                <CodeBlock>POST https://x402-relay.aibtc.dev/relay</CodeBlock>
              </div>
            )}
          </div>

          {/* Step 4 */}
          <div className={`mb-4 overflow-hidden rounded-2xl border transition-colors ${isStepOpen(4) ? "border-[#F7931A]/30" : "border-white/[0.08] hover:border-white/[0.15]"} bg-[#18181b]`}>
            <button onClick={() => toggleStep(4)} className="flex w-full items-center justify-between p-5 text-left transition-colors hover:bg-white/[0.02]">
              <div className="flex items-center gap-3.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-[#F7931A]/[0.15] text-[13px] font-medium text-[#F7931A]">4</div>
                <h3 className="text-balance text-base font-normal">Putting It All Together</h3>
                <span className="rounded-full bg-[#09090b] px-2 py-1 text-[11px] text-white/50">~5 min</span>
              </div>
              <svg className={`size-5 text-white/50 transition-transform ${isStepOpen(4) ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            {isStepOpen(4) && (
              <div className="border-t border-white/[0.08] px-5 pb-5 pt-5">
                <p className="mb-4 text-[15px] text-white/60">Now you have all the pieces. Here's the complete flow:</p>
                <ol className="mb-4 list-decimal space-y-2 pl-5 text-[15px] text-white/60">
                  <li><strong className="text-white">Your agent</strong> has a wallet with testnet STX</li>
                  <li><strong className="text-white">Someone calls your x402 endpoint</strong> and gets a 402 response</li>
                  <li><strong className="text-white">They pay</strong> in STX, sBTC, or USDCx</li>
                  <li><strong className="text-white">Your endpoint verifies</strong> and returns the content</li>
                  <li><strong className="text-white">Payment goes to your agent's wallet</strong></li>
                </ol>

                <h4 className="mb-3 mt-7 flex items-center gap-2 text-sm font-medium"><span className="h-3.5 w-0.5 rounded bg-[#F7931A]" />Example: AI Advice Agent</h4>
                <p className="mb-2 text-[15px] text-white/60">Ask Claude:</p>
                <Callout icon="🚀"><strong className="text-[#F7931A]">"Help me create an x402 endpoint that charges 0.01 STX for AI-generated advice. Deploy it on Cloudflare Workers."</strong></Callout>
                <p className="text-[15px] text-white/60">Claude will help you set up routes, connect to an LLM, handle payments, and deploy.</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Divider */}
      <div className="mx-auto h-px w-[200px] bg-gradient-to-r from-transparent via-white/[0.15] to-transparent" />

      {/* Resources */}
      <section className="px-6 py-12" id="resources">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-8 text-center">
            <h2 className="mb-1.5 text-balance text-xl font-normal">Quick Reference</h2>
            <p className="text-[15px] text-white/60">Everything you need in one place.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5">
              <h4 className="mb-3.5 text-xs font-normal uppercase tracking-wider text-white/50">Endpoints</h4>
              {[
                { name: "x402 API (Testnet)", url: "https://x402.aibtc.dev" },
                { name: "x402 API (Mainnet)", url: "https://x402.aibtc.com" },
                { name: "Sponsor Relay", url: "https://x402-relay.aibtc.dev" },
                { name: "Stacks Faucet", url: "https://explorer.hiro.so/sandbox/faucet?chain=testnet" },
              ].map((link, i) => (
                <a key={i} href={link.url} target="_blank" className="flex items-center justify-between border-b border-white/[0.08] py-2.5 text-sm text-white transition-colors last:border-0 hover:text-[#F7931A]">
                  {link.name}
                  <svg className="size-3.5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                </a>
              ))}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5">
              <h4 className="mb-3.5 text-xs font-normal uppercase tracking-wider text-white/50">Repositories</h4>
              {[
                { name: "Stacks MCP Server", url: "https://github.com/Stack-AI-MCP/stacks-mcp-server" },
                { name: "x402 API Template", url: "https://github.com/aibtcdev/x402-api" },
                { name: "Sponsor Relay", url: "https://github.com/aibtcdev/x402-sponsor-relay" },
                { name: "All AIBTC Repos", url: "https://github.com/aibtcdev" },
              ].map((link, i) => (
                <a key={i} href={link.url} target="_blank" className="flex items-center justify-between border-b border-white/[0.08] py-2.5 text-sm text-white transition-colors last:border-0 hover:text-[#F7931A]">
                  {link.name}
                  <svg className="size-3.5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                </a>
              ))}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5">
              <h4 className="mb-3.5 text-xs font-normal uppercase tracking-wider text-white/50">Payment Tokens</h4>
              {[
                { badge: "STX", desc: "Native Stacks token" },
                { badge: "sBTC", desc: "Bitcoin on Stacks" },
                { badge: "USDCx", desc: "USDC bridged to Stacks" },
              ].map((token, i) => (
                <div key={i} className="flex items-center gap-3 border-b border-white/[0.08] py-2.5 last:border-0">
                  <span className="rounded-md bg-[#F7931A]/[0.08] px-2.5 py-1 font-mono text-xs font-medium text-[#F7931A]">{token.badge}</span>
                  <span className="text-sm text-white/60">{token.desc}</span>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-white/[0.08] bg-[#18181b] p-5">
              <h4 className="mb-3.5 text-xs font-normal uppercase tracking-wider text-white/50">Get Help</h4>
              {[
                { name: "AIBTC Discord", url: "https://discord.gg/ZZPeck5P" },
                { name: "Stacks Documentation", url: "https://docs.stacks.co" },
                { name: "AIBTC Docs", url: "https://github.com/aibtcdev/aibtcdev-docs" },
              ].map((link, i) => (
                <a key={i} href={link.url} target="_blank" className="flex items-center justify-between border-b border-white/[0.08] py-2.5 text-sm text-white transition-colors last:border-0 hover:text-[#F7931A]">
                  {link.name}
                  <svg className="size-3.5 text-white/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M7 17L17 7M17 7H7M17 7V17" />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-[720px]">
          <h2 className="mb-8 text-balance text-center text-xl font-normal">Common Questions</h2>
          {faqs.map((faq, idx) => (
            <div key={idx} className="border-b border-white/[0.08] py-4 first:border-t max-md:py-5">
              <button onClick={() => toggleFaq(idx)} className="flex w-full items-center justify-between gap-4 text-left text-[15px]">
                {faq.q}
                <svg className={`size-5 flex-shrink-0 text-white/50 transition-transform ${openFaqs.includes(idx) ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
              {openFaqs.includes(idx) && (
                <div className="pt-3 text-[15px] text-white/60">
                  {faq.a}
                  {faq.list && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {faq.list.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-6 py-12">
        <div className="mx-auto max-w-[720px]">
          <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-gradient-to-br from-[#18181b] to-[#0f0f11] p-10 text-center">
            <div className="absolute left-1/2 top-0 h-px w-full -translate-x-1/2 bg-gradient-to-r from-transparent via-[#F7931A] to-transparent" />
            <h2 className="mb-2 text-balance text-[22px] font-normal">Join the Community</h2>
            <p className="mb-6 text-[15px] text-white/60">Share what you build, get help, and connect with other builders.</p>
            <a
              href="https://discord.gg/ZZPeck5P"
              target="_blank"
              className="inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-7 py-3.5 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98]"
            >
              Join AIBTC Discord
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.08] px-6 py-8">
        <div className="mx-auto flex max-w-[900px] flex-wrap items-center justify-between gap-4 max-sm:flex-col max-sm:text-center">
          <div className="flex gap-6">
            <a href="https://aibtc.dev" className="text-[13px] text-white/50 transition-colors hover:text-white">AIBTC</a>
            <a href="https://github.com/aibtcdev" target="_blank" className="text-[13px] text-white/50 transition-colors hover:text-white">GitHub</a>
            <a href="https://discord.gg/ZZPeck5P" target="_blank" className="text-[13px] text-white/50 transition-colors hover:text-white">Discord</a>
            <a href="https://x.com/aibtcdev" target="_blank" className="text-[13px] text-white/50 transition-colors hover:text-white">X</a>
          </div>
          <div className="text-[13px] text-white/50">Built for the AIBTC community</div>
        </div>
      </footer>
    </div>
  );
}
