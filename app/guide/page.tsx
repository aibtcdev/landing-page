"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";

const steps = [
  {
    id: 1,
    title: "Install Claude Code",
    subtitle: "Get the AI coding assistant",
    commands: [
      { cmd: "npm install -g @anthropic-ai/claude-code", output: "added 1 package" },
      { cmd: "claude", output: "Welcome to Claude Code!\nAuthenticating..." },
    ],
  },
  {
    id: 2,
    title: "Add Wallet MCP",
    subtitle: "Give Claude a Bitcoin wallet",
    commands: [
      { cmd: "claude mcp add stx402 npx stx402-agent -e NETWORK=testnet", output: "✓ Added MCP server: stx402" },
    ],
  },
  {
    id: 3,
    title: "Create Wallet",
    subtitle: "Set up your agent's wallet",
    commands: [
      { cmd: '# In Claude, type:', output: null },
      { cmd: '"Create a secure Stacks wallet"', output: "Creating wallet...\n✓ Wallet created!\nAddress: ST1ABC...XYZ" },
    ],
  },
  {
    id: 4,
    title: "Fund Wallet",
    subtitle: "Get testnet STX",
    commands: [
      { cmd: '# Ask Claude for your address:', output: null },
      { cmd: '"What is my wallet address?"', output: "Your wallet address is:\nST1ABC...XYZ" },
      { cmd: "# Visit the Stacks faucet to get test STX", output: null },
    ],
  },
  {
    id: 5,
    title: "Build x402 Endpoint",
    subtitle: "Create a paid API",
    commands: [
      { cmd: "git clone https://github.com/aibtcdev/x402-api.git", output: "Cloning into 'x402-api'..." },
      { cmd: "cd x402-api && npm install", output: "added 42 packages" },
      { cmd: "npx wrangler deploy --env staging", output: "✓ Deployed to x402-api.workers.dev" },
    ],
  },
];

function TerminalWindow({ commands, isActive }: { commands: typeof steps[0]["commands"]; isActive: boolean }) {
  const [displayedLines, setDisplayedLines] = useState<{ type: "cmd" | "output"; text: string }[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Flatten commands into lines
  const allLines: { type: "cmd" | "output"; text: string }[] = [];
  commands.forEach((c) => {
    allLines.push({ type: "cmd", text: c.cmd });
    if (c.output) {
      c.output.split("\n").forEach((line) => {
        allLines.push({ type: "output", text: line });
      });
    }
  });

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      setDisplayedLines([]);
      setCurrentLineIndex(0);
      setCurrentCharIndex(0);
    }
  }, [isActive, hasStarted]);

  useEffect(() => {
    if (!hasStarted || currentLineIndex >= allLines.length) return;

    const currentLine = allLines[currentLineIndex];
    const isCommand = currentLine.type === "cmd";
    const speed = isCommand ? 40 : 5; // Commands type slower, output appears faster

    if (currentCharIndex < currentLine.text.length) {
      const timeout = setTimeout(() => {
        setDisplayedLines((prev) => {
          const newLines = [...prev];
          if (newLines.length <= currentLineIndex) {
            newLines.push({ type: currentLine.type, text: currentLine.text.slice(0, currentCharIndex + 1) });
          } else {
            newLines[currentLineIndex] = { type: currentLine.type, text: currentLine.text.slice(0, currentCharIndex + 1) };
          }
          return newLines;
        });
        setCurrentCharIndex((prev) => prev + 1);
      }, speed);
      return () => clearTimeout(timeout);
    } else {
      // Move to next line
      const timeout = setTimeout(() => {
        setCurrentLineIndex((prev) => prev + 1);
        setCurrentCharIndex(0);
      }, isCommand ? 500 : 100);
      return () => clearTimeout(timeout);
    }
  }, [hasStarted, currentLineIndex, currentCharIndex, allLines]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [displayedLines]);

  const isTyping = currentLineIndex < allLines.length;
  const currentLineIsCommand = currentLineIndex < allLines.length && allLines[currentLineIndex].type === "cmd";

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.1] bg-[#0d0d0d] shadow-2xl">
      {/* macOS Title Bar */}
      <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#1a1a1a] px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="size-3 rounded-full bg-[#ff5f57]" />
          <div className="size-3 rounded-full bg-[#febc2e]" />
          <div className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="flex-1 text-center text-xs text-white/40">Terminal — zsh</span>
        <div className="w-14" />
      </div>

      {/* Terminal Content */}
      <div ref={terminalRef} className="h-[320px] overflow-y-auto p-4 font-mono text-[13px] leading-relaxed">
        {displayedLines.map((line, i) => (
          <div key={i} className={`${line.type === "cmd" ? "flex" : ""}`}>
            {line.type === "cmd" && <span className="mr-2 text-[#28c840]">❯</span>}
            <span className={line.type === "cmd" ? "text-white" : "text-white/50"}>
              {line.text}
            </span>
          </div>
        ))}
        {isTyping && currentLineIsCommand && (
          <span className="ml-6 inline-block h-[1.1em] w-[2px] animate-blink bg-white/70" />
        )}
        {!isTyping && displayedLines.length > 0 && (
          <div className="flex">
            <span className="mr-2 text-[#28c840]">❯</span>
            <span className="inline-block h-[1.1em] w-[2px] animate-blink bg-white/70" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function GuidePage() {
  const [activeStep, setActiveStep] = useState(1);

  return (
    <div className="min-h-dvh bg-[#09090b] text-white">
      <Navbar />

      {/* Hero */}
      <section className="px-6 pb-8 pt-28 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/[0.08] px-3.5 py-1.5 text-xs text-[#F7931A]">
          <span className="size-1.5 rounded-full bg-[#F7931A] motion-safe:animate-pulse" />
          Interactive Guide
        </div>
        <h1 className="mt-4 text-balance text-[clamp(1.75rem,4vw,2.25rem)] font-medium text-white">
          Build Bitcoin Agents in 5 Steps
        </h1>
        <p className="mt-2 text-[15px] text-white/50">
          Follow along with the terminal on the right
        </p>
      </section>

      {/* Split View */}
      <section className="mx-auto max-w-6xl px-6 pb-20">
        <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
          {/* Left: Steps */}
          <div className="space-y-3">
            {steps.map((step) => (
              <button
                key={step.id}
                onClick={() => setActiveStep(step.id)}
                className={`w-full rounded-xl border p-5 text-left transition-[border-color,background-color] duration-200 ${
                  activeStep === step.id
                    ? "border-[#F7931A]/40 bg-[#F7931A]/[0.08]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-medium ${
                      activeStep === step.id
                        ? "bg-[#F7931A] text-black"
                        : "bg-white/[0.08] text-white/60"
                    }`}
                  >
                    {step.id}
                  </div>
                  <div>
                    <h3 className={`text-[15px] font-medium ${activeStep === step.id ? "text-white" : "text-white/80"}`}>
                      {step.title}
                    </h3>
                    <p className="mt-0.5 text-[13px] text-white/50">{step.subtitle}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Right: Terminal */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <TerminalWindow
              key={activeStep}
              commands={steps.find((s) => s.id === activeStep)?.commands || []}
              isActive={true}
            />
            <p className="mt-4 text-center text-xs text-white/30">
              Click a step to see the commands
            </p>
          </div>
        </div>
      </section>

      {/* Resources */}
      <section className="border-t border-white/[0.06] px-6 py-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-8 text-center text-xl font-medium">Quick Reference</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {/* Endpoints */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">Endpoints</h4>
              <div className="space-y-2">
                {[
                  { name: "x402 API (Testnet)", url: "https://x402.aibtc.dev" },
                  { name: "x402 API (Mainnet)", url: "https://x402.aibtc.com" },
                  { name: "Sponsor Relay", url: "https://x402-relay.aibtc.dev" },
                  { name: "Stacks Faucet", url: "https://explorer.hiro.so/sandbox/faucet?chain=testnet" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" className="flex items-center justify-between text-sm text-white/70 transition-colors hover:text-[#F7931A]">
                    {link.name}
                    <svg className="size-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Repositories */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">Repositories</h4>
              <div className="space-y-2">
                {[
                  { name: "stx402-agent MCP", url: "https://www.npmjs.com/package/stx402-agent" },
                  { name: "x402 API Template", url: "https://github.com/aibtcdev/x402-api" },
                  { name: "Sponsor Relay", url: "https://github.com/aibtcdev/x402-sponsor-relay" },
                  { name: "All AIBTC Repos", url: "https://github.com/aibtcdev" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" className="flex items-center justify-between text-sm text-white/70 transition-colors hover:text-[#F7931A]">
                    {link.name}
                    <svg className="size-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Payment Tokens */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">Payment Tokens</h4>
              <div className="space-y-2.5">
                {[
                  { badge: "STX", desc: "Native Stacks token" },
                  { badge: "sBTC", desc: "Bitcoin on Stacks" },
                  { badge: "USDCx", desc: "USDC bridged to Stacks" },
                ].map((token) => (
                  <div key={token.badge} className="flex items-center gap-2.5">
                    <span className="rounded bg-[#F7931A]/10 px-2 py-0.5 font-mono text-xs font-medium text-[#F7931A]">{token.badge}</span>
                    <span className="text-sm text-white/50">{token.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Get Help */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
              <h4 className="mb-3 text-xs font-medium uppercase tracking-wider text-white/40">Get Help</h4>
              <div className="space-y-2">
                {[
                  { name: "AIBTC Discord", url: "https://discord.gg/fyrsX3mtTk" },
                  { name: "Stacks Docs", url: "https://docs.stacks.co" },
                  { name: "x402 Protocol", url: "https://x402.org" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" className="flex items-center justify-between text-sm text-white/70 transition-colors hover:text-[#F7931A]">
                    {link.name}
                    <svg className="size-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/[0.06] px-6 py-16">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-xl font-medium">Ready to build?</h2>
          <p className="mt-2 text-[15px] text-white/50">Join the community and share what you create.</p>
          <a
            href="https://discord.gg/fyrsX3mtTk"
            target="_blank"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-7 py-3.5 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98]"
          >
            Join AIBTC Discord
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between text-xs text-white/40">
          <Link href="/" className="transition-colors hover:text-white">← Back to home</Link>
          <span>© 2026 AIBTC</span>
        </div>
      </footer>
    </div>
  );
}
