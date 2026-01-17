"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import Navbar from "../components/Navbar";

// Hook to detect reduced motion preference
function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mediaQuery.matches);

    const handler = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener("change", handler);
    return () => mediaQuery.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}

interface ConversationExchange {
  user: string;
  claude: string;
}

interface Command {
  cmd?: string;
  output?: string | null;
  showClaudeUI?: boolean;
  claudeUserMessage?: string;
  claudeResponse?: string;
  conversation?: ConversationExchange[];
}

interface Step {
  id: number;
  title: string;
  subtitle: string;
  commands: Command[];
}

const steps: Step[] = [
  {
    id: 1,
    title: "Install Claude Code",
    subtitle: "Get the AI coding assistant",
    commands: [
      { cmd: "npm install -g @anthropic-ai/claude-code", output: "added 1 package" },
      { cmd: "claude", output: null, showClaudeUI: true },
    ],
  },
  {
    id: 2,
    title: "Add Wallet MCP",
    subtitle: "Give Claude blockchain capabilities",
    commands: [
      { cmd: "claude mcp add stx402 -- npx stx402-agent@latest -e NETWORK=testnet", output: "✓ Added MCP server: stx402" },
      {
        showClaudeUI: true,
        claudeUserMessage: "What can you do now?",
        claudeResponse: "I now have 50+ blockchain tools:\n\n• Wallet Management - create, import, unlock wallets\n• Token Operations - send STX, sBTC, SIP-010 tokens\n• NFT Support - view holdings, transfer NFTs\n• DeFi Trading - ALEX swaps, Zest lending\n• BNS Domains - resolve .btc names\n• Smart Contracts - deploy and call functions\n• x402 Payments - auto-pay for paid APIs"
      },
    ],
  },
  {
    id: 3,
    title: "Create Wallet",
    subtitle: "Generate encrypted credentials",
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Create a secure stacks wallet",
            claude: "I'll create a new encrypted wallet for you.\n\nPlease provide a secure password (min 8 characters):"
          },
          {
            user: "MySecureP@ss123",
            claude: "Creating wallet...\n\n✓ Generated 24-word recovery phrase\n✓ Encrypted with AES-256-GCM + Scrypt\n✓ Stored in ~/.stx402/wallets/\n\nAddress: ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5\n\n⚠️ Save your recovery phrase - it's only shown once!"
          },
        ],
      },
    ],
  },
  {
    id: 4,
    title: "Fund & Transact",
    subtitle: "Get testnet STX and start building",
    commands: [
      {
        showClaudeUI: true,
        claudeUserMessage: "How much STX do you have?",
        claudeResponse: "Let me check my balance...\n\nBalance: 0 STX\n\nTo get testnet STX, visit the Stacks faucet:\nhttps://explorer.hiro.so/sandbox/faucet?chain=testnet\n\nOnce funded, I can:\n• Send tokens to any address\n• Swap on ALEX DEX\n• Deploy smart contracts\n• Pay for x402 API calls"
      },
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

function ClaudeCodeUI({
  userMessage,
  claudeResponse,
  conversation,
  onAnimationComplete
}: {
  userMessage?: string;
  claudeResponse?: string;
  conversation?: ConversationExchange[];
  onAnimationComplete?: () => void;
}) {
  const prefersReducedMotion = usePrefersReducedMotion();

  // Normalize to conversation array
  const exchanges: ConversationExchange[] = conversation ||
    (userMessage ? [{ user: userMessage, claude: claudeResponse || "" }] : []);

  const [currentExchangeIndex, setCurrentExchangeIndex] = useState(0);
  const [phase, setPhase] = useState<"welcome" | "typing" | "response">("welcome");
  const [typedMessage, setTypedMessage] = useState("");
  // Track how many exchanges are fully displayed (including response)
  const [displayedCount, setDisplayedCount] = useState(0);

  const currentExchange = exchanges[currentExchangeIndex];
  const isLastExchange = currentExchangeIndex >= exchanges.length - 1;
  const hasExchanges = exchanges.length > 0;

  // Skip animations if user prefers reduced motion
  useEffect(() => {
    if (prefersReducedMotion && hasExchanges) {
      setDisplayedCount(exchanges.length);
      setPhase("response");
      onAnimationComplete?.();
      return;
    }
  }, [prefersReducedMotion, hasExchanges, exchanges.length, onAnimationComplete]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    if (!hasExchanges) {
      const timeout = setTimeout(() => {
        onAnimationComplete?.();
      }, 500);
      return () => clearTimeout(timeout);
    }

    const startTyping = setTimeout(() => {
      setPhase("typing");
    }, 800);

    return () => clearTimeout(startTyping);
  }, [hasExchanges, onAnimationComplete, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (phase !== "typing" || !currentExchange) return;

    if (typedMessage.length < currentExchange.user.length) {
      const timeout = setTimeout(() => {
        setTypedMessage(currentExchange.user.slice(0, typedMessage.length + 1));
      }, 35);
      return () => clearTimeout(timeout);
    } else {
      const timeout = setTimeout(() => {
        setPhase("response");
      }, 400);
      return () => clearTimeout(timeout);
    }
  }, [phase, typedMessage, currentExchange, prefersReducedMotion]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (phase !== "response" || !currentExchange) return;

    const timeout = setTimeout(() => {
      if (isLastExchange) {
        // Mark final exchange as displayed before completing
        setDisplayedCount(currentExchangeIndex + 1);
        onAnimationComplete?.();
      } else {
        // Mark current as displayed, then move to next
        setDisplayedCount(currentExchangeIndex + 1);
        setCurrentExchangeIndex((prev) => prev + 1);
        setTypedMessage("");
        setPhase("typing");
      }
    }, 1000);

    return () => clearTimeout(timeout);
  }, [phase, currentExchange, isLastExchange, currentExchangeIndex, onAnimationComplete, prefersReducedMotion]);

  return (
    <div className="mt-3">
      {/* Claude Code Header */}
      <div className="mb-3 flex items-center gap-2">
        <div className="text-[#D97757]">╭─</div>
        <div className="flex items-center gap-1.5">
          <svg className="size-3.5 text-[#D97757]" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="m3.127 10.604 3.135-1.76.053-.153-.053-.085H6.11l-.525-.032-1.791-.048-1.554-.065-1.505-.08-.38-.081L0 7.832l.036-.234.32-.214.455.04 1.009.069 1.513.105 1.097.064 1.626.17h.259l.036-.105-.089-.065-.068-.064-1.566-1.062-1.695-1.121-.887-.646-.48-.327-.243-.306-.104-.67.435-.48.585.04.15.04.593.456 1.267.981 1.654 1.218.242.202.097-.068.012-.049-.109-.181-.9-1.626-.96-1.655-.428-.686-.113-.411a2 2 0 0 1-.068-.484l.496-.674L4.446 0l.662.089.279.242.411.94.666 1.48 1.033 2.014.302.597.162.553.06.17h.105v-.097l.085-1.134.157-1.392.154-1.792.052-.504.25-.605.497-.327.387.186.319.456-.045.294-.19 1.23-.37 1.93-.243 1.29h.142l.161-.16.654-.868 1.097-1.372.484-.545.565-.601.363-.287h.686l.505.751-.226.775-.707.895-.585.759-.839 1.13-.524.904.048.072.125-.012 1.897-.403 1.024-.186 1.223-.21.553.258.06.263-.218.536-1.307.323-1.533.307-2.284.54-.028.02.032.04 1.029.098.44.024h1.077l2.005.15.525.346.315.424-.053.323-.807.411-3.631-.863-.872-.218h-.12v.073l.726.71 1.331 1.202 1.667 1.55.084.383-.214.302-.226-.032-1.464-1.101-.565-.497-1.28-1.077h-.084v.113l.295.432 1.557 2.34.08.718-.112.234-.404.141-.444-.08-.911-1.28-.94-1.44-.759-1.291-.093.053-.448 4.821-.21.246-.484.186-.403-.307-.214-.496.214-.98.258-1.28.21-1.016.19-1.263.112-.42-.008-.028-.092.012-.953 1.307-1.448 1.957-1.146 1.227-.274.109-.477-.247.045-.44.266-.39 1.586-2.018.956-1.25.617-.723-.004-.105h-.036l-4.212 2.736-.75.096-.324-.302.04-.496.154-.162 1.267-.871z"/>
          </svg>
          <span className="text-sm font-medium text-[#D97757]">Claude Code</span>
        </div>
      </div>

      <div className="space-y-3">
        {/* Welcome message */}
        {phase === "welcome" && !hasExchanges && (
          <>
            <div className="text-white/60">Welcome to Claude Code! How can I help you today?</div>
            <div className="flex items-start gap-2">
              <span className="text-[#6B9EFF]">❯</span>
              <span className="inline-block h-4 w-1.5 animate-blink bg-white/70" />
            </div>
          </>
        )}

        {/* All exchanges up to displayedCount (fully shown) */}
        {exchanges.slice(0, displayedCount).map((exchange, i) => (
          <div key={i} className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-[#6B9EFF]">❯</span>
              <span className="min-w-0 break-words text-white">{exchange.user}</span>
            </div>
            <div className="ml-4 whitespace-pre-wrap break-words text-white/70">{exchange.claude}</div>
          </div>
        ))}

        {/* Current exchange being animated (only if not yet in displayedCount) */}
        {currentExchange && phase !== "welcome" && currentExchangeIndex >= displayedCount && (
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="shrink-0 text-[#6B9EFF]">❯</span>
              {phase === "typing" && (
                <>
                  <span className="min-w-0 break-words text-white">{typedMessage}</span>
                  <span className="shrink-0 inline-block h-4 w-1.5 animate-blink bg-white/70" />
                </>
              )}
              {phase === "response" && (
                <span className="min-w-0 break-words text-white">{currentExchange.user}</span>
              )}
            </div>
            {phase === "response" && (
              <div className="ml-4 whitespace-pre-wrap break-words text-white/70">{currentExchange.claude}</div>
            )}
          </div>
        )}
      </div>

      {/* Bottom border */}
      <div className="mt-3 text-[#D97757]">╰─</div>
    </div>
  );
}

interface DisplayLine {
  type: "cmd" | "output" | "claude-ui";
  text: string;
  claudeUserMessage?: string;
  claudeResponse?: string;
  conversation?: ConversationExchange[];
}

function TerminalWindow({ commands, isActive }: { commands: Command[]; isActive: boolean }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayedLines, setDisplayedLines] = useState<DisplayLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [waitingForClaudeUI, setWaitingForClaudeUI] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Get copyable content (commands and Claude user messages)
  const copyableContent = commands
    .flatMap((c) => {
      const items: string[] = [];
      if (c.cmd && !c.cmd.startsWith("#") && !c.cmd.startsWith('"')) {
        items.push(c.cmd);
      }
      if (c.claudeUserMessage) {
        items.push(c.claudeUserMessage);
      }
      if (c.conversation) {
        c.conversation.forEach((exchange) => items.push(exchange.user));
      }
      return items;
    })
    .join("\n");

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyableContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Flatten commands into lines (memoized to avoid recreation on every render)
  const allLines = useMemo(() => {
    const lines: DisplayLine[] = [];
    commands.forEach((c) => {
      if (c.cmd) {
        lines.push({ type: "cmd", text: c.cmd });
      }
      if (c.output) {
        c.output.split("\n").forEach((line) => {
          lines.push({ type: "output", text: line });
        });
      }
      if (c.showClaudeUI) {
        lines.push({
          type: "claude-ui",
          text: "",
          claudeUserMessage: c.claudeUserMessage,
          claudeResponse: c.claudeResponse,
          conversation: c.conversation,
        });
      }
    });
    return lines;
  }, [commands]);

  useEffect(() => {
    if (isActive && !hasStarted) {
      setHasStarted(true);
      // If user prefers reduced motion, show all lines immediately
      if (prefersReducedMotion) {
        setDisplayedLines(allLines.map(line =>
          line.type === "claude-ui" ? line : { ...line, text: line.text }
        ));
        setCurrentLineIndex(allLines.length);
      } else {
        setDisplayedLines([]);
        setCurrentLineIndex(0);
        setCurrentCharIndex(0);
      }
    }
  }, [isActive, hasStarted, prefersReducedMotion, allLines]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    if (!hasStarted || currentLineIndex >= allLines.length || waitingForClaudeUI) return;

    const currentLine = allLines[currentLineIndex];
    const isCommand = currentLine.type === "cmd";
    const isClaudeUI = currentLine.type === "claude-ui";
    const speed = isCommand ? 40 : 5; // Commands type slower, output appears faster

    // Handle claude-ui lines - add and wait for animation callback
    if (isClaudeUI) {
      // Only add if not already added (prevents infinite loop from re-renders)
      if (displayedLines.length <= currentLineIndex) {
        setDisplayedLines((prev) => [...prev, currentLine]);
        setWaitingForClaudeUI(true);
      }
      return;
    }

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
  }, [hasStarted, currentLineIndex, currentCharIndex, allLines, prefersReducedMotion, waitingForClaudeUI]);

  // Auto-scroll terminal smoothly
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTo({
        top: terminalRef.current.scrollHeight,
        behavior: prefersReducedMotion ? "instant" : "smooth",
      });
    }
  }, [displayedLines, prefersReducedMotion]);

  const handleClaudeUIComplete = () => {
    setWaitingForClaudeUI(false);
    setCurrentLineIndex((prev) => prev + 1);
    setCurrentCharIndex(0);
  };

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
        {copyableContent && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/50 transition-colors hover:border-white/20 hover:text-white/70"
            aria-label="Copy commands"
          >
            {copied ? (
              <>
                <svg className="size-3.5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy
              </>
            )}
          </button>
        )}
      </div>

      {/* Terminal Content */}
      <div ref={terminalRef} className="terminal-content h-[280px] overflow-y-auto p-3 font-mono text-xs leading-relaxed md:h-[320px] md:p-4 md:text-[13px]">
        {displayedLines.map((line, i) => (
          line.type === "claude-ui" ? (
            <ClaudeCodeUI
              key={i}
              userMessage={line.claudeUserMessage}
              claudeResponse={line.claudeResponse}
              conversation={line.conversation}
              onAnimationComplete={i === displayedLines.length - 1 ? handleClaudeUIComplete : undefined}
            />
          ) : (
            <div key={i} className={`${line.type === "cmd" ? "flex" : ""}`}>
              {line.type === "cmd" && <span className="mr-2 shrink-0 text-[#28c840]">❯</span>}
              <span className={`break-all ${line.type === "cmd" ? "text-white" : "text-white/50"}`}>
                {line.text}
              </span>
            </div>
          )
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
      <section className="px-12 pb-6 pt-24 max-lg:px-8 max-md:px-5 md:pb-8 md:pt-28">
        <div className="mx-auto max-w-[1200px] text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-[#F7931A]/20 bg-[#F7931A]/[0.08] px-3 py-1 text-xs text-[#F7931A]">
          <span className="size-1.5 rounded-full bg-[#F7931A] motion-safe:animate-pulse" />
          Interactive Guide
        </div>
        <h1 className="mt-3 text-balance text-[clamp(1.5rem,5vw,2.25rem)] font-medium leading-tight text-white md:mt-4">
          Build Bitcoin Agents in 5 Steps
        </h1>
        <p className="mt-2 text-sm text-white/50 md:text-[15px]">
          <span className="hidden lg:inline">Follow along with the terminal on the right</span>
          <span className="lg:hidden">Tap a step to see the commands</span>
        </p>
        </div>
      </section>

      {/* Split View */}
      <section className="px-12 pb-12 max-lg:px-8 max-md:px-5 md:pb-20">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-12">
          {/* Terminal first on mobile for better UX */}
          <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
            <TerminalWindow
              key={activeStep}
              commands={steps.find((s) => s.id === activeStep)?.commands || []}
              isActive={true}
            />
            <p className="mt-3 text-center text-xs text-white/30 lg:mt-4">
              <span className="hidden lg:inline">Click a step to see the commands</span>
              <span className="lg:hidden">Tap a step below to switch</span>
            </p>
          </div>

          {/* Steps */}
          <div className="order-2 space-y-2 lg:order-1 lg:space-y-3">
            {steps.map((step) => (
              <button
                key={step.id}
                onClick={() => setActiveStep(step.id)}
                className={`w-full rounded-xl border p-3.5 text-left transition-[border-color,background-color] duration-200 md:p-5 ${
                  activeStep === step.id
                    ? "border-[#F7931A]/40 bg-[#F7931A]/[0.08]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15] hover:bg-white/[0.04]"
                }`}
              >
                <div className="flex items-center gap-3 md:items-start md:gap-4">
                  <div
                    className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-medium md:size-8 ${
                      activeStep === step.id
                        ? "bg-[#F7931A] text-black"
                        : "bg-white/[0.08] text-white/60"
                    }`}
                  >
                    {step.id}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className={`text-sm font-medium md:text-[15px] ${activeStep === step.id ? "text-white" : "text-white/80"}`}>
                      {step.title}
                    </h3>
                    <p className="mt-0.5 truncate text-xs text-white/50 md:text-[13px] md:whitespace-normal">{step.subtitle}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Resources */}
      <section className="border-t border-white/[0.06] px-12 py-10 max-lg:px-8 max-md:px-5 md:py-16">
        <div className="mx-auto max-w-[1200px]">
          <h2 className="mb-6 text-balance text-center text-lg font-medium md:mb-8 md:text-xl">Quick Reference</h2>
          <div className="grid gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
            {/* Endpoints */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40 md:mb-3">Endpoints</h4>
              <div className="space-y-2">
                {[
                  { name: "x402 API (Testnet)", url: "https://x402.aibtc.dev" },
                  { name: "x402 API (Mainnet)", url: "https://x402.aibtc.com" },
                  { name: "Sponsor Relay", url: "https://x402-relay.aibtc.dev" },
                  { name: "Stacks Faucet", url: "https://explorer.hiro.so/sandbox/faucet?chain=testnet" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between text-sm text-white/70 transition-colors hover:text-[#F7931A]">
                    {link.name}
                    <svg className="size-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Repositories */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40 md:mb-3">Repositories</h4>
              <div className="space-y-2">
                {[
                  { name: "stx402-agent MCP", url: "https://github.com/biwasxyz/stx402-agent" },
                  { name: "x402 API Template", url: "https://github.com/aibtcdev/x402-api" },
                  { name: "Sponsor Relay", url: "https://github.com/aibtcdev/x402-sponsor-relay" },
                  { name: "All AIBTC Repos", url: "https://github.com/aibtcdev" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between text-sm text-white/70 transition-colors hover:text-[#F7931A]">
                    {link.name}
                    <svg className="size-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </a>
                ))}
              </div>
            </div>

            {/* Payment Tokens */}
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40 md:mb-3">Payment Tokens</h4>
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
            <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 md:p-5">
              <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-white/40 md:mb-3">Get Help</h4>
              <div className="space-y-2">
                {[
                  { name: "AIBTC Discord", url: "https://discord.gg/fyrsX3mtTk" },
                  { name: "Stacks Docs", url: "https://docs.stacks.co" },
                  { name: "x402 Protocol", url: "https://x402.org" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between text-sm text-white/70 transition-colors hover:text-[#F7931A]">
                    {link.name}
                    <svg className="size-3.5 shrink-0 text-white/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7V17" /></svg>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/[0.06] px-12 py-10 max-lg:px-8 max-md:px-5 md:py-16">
        <div className="mx-auto max-w-[1200px] text-center">
          <h2 className="text-balance text-lg font-medium md:text-xl">Ready to build?</h2>
          <p className="mt-2 text-sm text-white/50 md:text-[15px]">Join the community and share what you create.</p>
          <a
            href="https://discord.gg/fyrsX3mtTk"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-6 py-3 text-sm font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98] md:mt-6 md:px-7 md:py-3.5 md:text-[15px]"
          >
            Join AIBTC Discord
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-12 py-6 max-lg:px-8 max-md:px-5 md:py-8">
        <div className="mx-auto flex max-w-[1200px] items-center justify-between text-xs text-white/40">
          <Link href="/" className="transition-colors hover:text-white">← Back to home</Link>
          <span>© 2026 AIBTC</span>
        </div>
      </footer>
    </div>
  );
}
