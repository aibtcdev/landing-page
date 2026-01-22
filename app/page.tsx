"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import Navbar from "./components/Navbar";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

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
  link?: {
    text: string;
    url: string;
  };
}

interface Step {
  id: number;
  title: string;
  subtitle: string;
  commands: Command[];
  skippable?: boolean;
}

const steps: Step[] = [
  {
    id: 1,
    title: "Install Node.js",
    subtitle: "Required for npm package manager",
    skippable: true,
    commands: [
      { link: { text: "Download Node.js (includes npm)", url: "https://nodejs.org" } },
      { cmd: "npm --version", output: "10.2.0  ✓ npm is installed" },
    ],
  },
  {
    id: 2,
    title: "Install Claude Code",
    subtitle: "AI coding assistant from Anthropic",
    commands: [
      { cmd: "npm install -g @anthropic-ai/claude-code", output: "added 1 package" },
    ],
  },
  {
    id: 3,
    title: "Add AIBTC Tools",
    subtitle: "Blockchain tools for Claude",
    commands: [
      { cmd: "npx @aibtc/mcp-server@latest --install", output: "✓ Added aibtc MCP server to Claude Code\n✓ Configured for mainnet\n\nRestart your terminal to begin." },
    ],
  },
  {
    id: 4,
    title: "Configure",
    subtitle: "Create your wallet in seconds",
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Create a wallet for my agent",
            claude: "I'll create an encrypted wallet.\n\n✓ Generated 24-word recovery phrase\n✓ Encrypted with AES-256-GCM\n✓ Stored securely\n\nAddress: ST1SJ3...ZQ8YPD5\n\n⚠️ Save your recovery phrase!"
          },
        ],
      },
    ],
  },
  {
    id: 5,
    title: "Deploy",
    subtitle: "Claude builds & deploys your paid API",
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Build a paid x402 endpoint paid in sBTC that hunts down the best Bitcoin yield.",
            claude: "I'll create an x402 endpoint for you.\n\nCreating Cloudflare Worker...\n✓ Generated yield-hunter-api project\n✓ Added x402 payment middleware\n✓ Set price: 0.0001 sBTC per query\n✓ Configured your wallet as recipient\n\nDeploying to Cloudflare Workers...\n✓ Deployed to yield-hunter-api.workers.dev\n\nYour API is live and earning!"
          },
        ],
      },
    ],
  },
  {
    id: 6,
    title: "Earn & Scale",
    subtitle: "Every request pays you directly",
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "What are my earnings today?",
            claude: "Checking your wallet transactions...\n\n💰 You've earned 0.0127 sBTC today\n\nKeep building endpoints to grow your earnings!"
          },
        ],
      },
    ],
  },
];

// Hero terminal showing x402 earning flow
const heroTerminalCommands: Command[] = [
  { cmd: "npx @aibtc/mcp-server@latest --install", output: "✓ Added aibtc tools to Claude Code" },
  { cmd: "claude", output: null },
  {
    showClaudeUI: true,
    conversation: [
      {
        user: "Build a paid x402 endpoint paid in sBTC that hunts down the best Bitcoin yield.",
        claude: "I'll create and deploy that for you.\n\n✓ Created yield-hunter-api\n✓ Added x402 payment (e.g., 0.0001 sBTC per query/optimization)\n✓ Deployed to yield-hunter-api.workers.dev\n\nYour endpoint is live and earning!"
      },
      {
        user: "How much have I earned?",
        claude: "💰 45 requests today = 0.0045 sBTC earned\n\nYour yield-hunting API is working for you 24/7—autonomously scanning Stacks DeFi (Zest, Bitflow, Hermetica), optimizing sBTC yields, and compounding real Bitcoin value."
      },
    ],
  },
];

// Open Standards projects data
const openStandardsProjects = [
  {
    name: "AIBTC MCP Server",
    description: "Blockchain tools for Claude Code",
    links: [
      { type: "github", url: "https://github.com/aibtcdev/aibtc-mcp-server", label: "GitHub" },
      { type: "website", url: "https://www.npmjs.com/package/@aibtc/mcp-server", label: "npm" },
    ],
  },
  {
    name: "x402 API Template",
    description: "Paid API endpoint starter",
    links: [
      { type: "github", url: "https://github.com/aibtcdev/x402-api", label: "GitHub" },
    ],
  },
  {
    name: "x402 Protocol",
    description: "HTTP payment standard",
    links: [
      { type: "website", url: "https://x402.org", label: "Website" },
    ],
  },
  {
    name: "Stacks",
    description: "Bitcoin L2 with smart contracts",
    links: [
      { type: "docs", url: "https://docs.stacks.co", label: "Docs" },
      { type: "github", url: "https://github.com/stacks-network", label: "GitHub" },
    ],
  },
  {
    name: "Claude Code",
    description: "AI coding assistant",
    links: [
      { type: "website", url: "https://claude.ai/code", label: "Website" },
    ],
  },
  {
    name: "sBTC",
    description: "Bitcoin on Stacks",
    links: [
      { type: "website", url: "https://sbtc.tech", label: "Website" },
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
  type: "cmd" | "output" | "claude-ui" | "link";
  text: string;
  claudeUserMessage?: string;
  claudeResponse?: string;
  conversation?: ConversationExchange[];
  linkUrl?: string;
}

function TerminalWindow({ commands, isActive, height = "default", showCopy = true }: { commands: Command[]; isActive: boolean; height?: "default" | "tall"; showCopy?: boolean }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayedLines, setDisplayedLines] = useState<DisplayLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [waitingForClaudeUI, setWaitingForClaudeUI] = useState(false);
  const [copied, setCopied] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Get copyable content (commands and Claude user messages)
  const copyableContent = useMemo(() => {
    return commands
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
  }, [commands]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(copyableContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };


  // Flatten commands into lines (memoized to avoid recreation on every render)
  const allLines = useMemo(() => {
    const lines: DisplayLine[] = [];
    commands.forEach((c) => {
      if (c.link) {
        lines.push({ type: "link", text: c.link.text, linkUrl: c.link.url });
      }
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
          const newLine: DisplayLine = {
            type: currentLine.type,
            text: currentLine.text.slice(0, currentCharIndex + 1),
            linkUrl: currentLine.linkUrl,
          };
          if (newLines.length <= currentLineIndex) {
            newLines.push(newLine);
          } else {
            newLines[currentLineIndex] = newLine;
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
  }, [hasStarted, currentLineIndex, currentCharIndex, allLines, prefersReducedMotion, waitingForClaudeUI, displayedLines.length]);

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

  const heightClass = height === "tall" ? "h-[380px] md:h-[420px]" : "h-[280px] md:h-[320px]";

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
        {showCopy && copyableContent && (
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/50 transition-colors hover:border-white/20 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
            aria-label="Copy command"
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
      <div ref={terminalRef} className={`terminal-content ${heightClass} overflow-y-auto p-3 font-mono text-xs leading-relaxed md:p-4 md:text-[13px]`}>
        {displayedLines.map((line, i) => (
          line.type === "claude-ui" ? (
            <ClaudeCodeUI
              key={i}
              userMessage={line.claudeUserMessage}
              claudeResponse={line.claudeResponse}
              conversation={line.conversation}
              onAnimationComplete={i === displayedLines.length - 1 ? handleClaudeUIComplete : undefined}
            />
          ) : line.type === "link" ? (
            <div key={i} className="my-2">
              <a
                href={line.linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-[#F7931A]/30 bg-[#F7931A]/10 px-3 py-2 text-sm text-[#F7931A] transition-colors hover:bg-[#F7931A]/20"
              >
                {line.text}
                <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                </svg>
              </a>
            </div>
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

// Icon components for Open Standards cards
function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
    </svg>
  );
}


function OpenStandardsCard({ project }: { project: typeof openStandardsProjects[0] }) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-all duration-200 hover:border-[#F7931A]/30 hover:bg-[#F7931A]/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium text-white group-hover:text-[#F7931A] transition-colors">
            {project.name}
          </h3>
          <p className="mt-1 text-sm text-white/50">{project.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {project.links.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:border-white/20 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
              aria-label={`${project.name} ${link.label}`}
            >
              {link.type === "github" && <GitHubIcon className="size-4" />}
              {link.type === "website" && <GlobeIcon className="size-4" />}
              {link.type === "docs" && <BookIcon className="size-4" />}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeStep, setActiveStep] = useState(1);

  return (
    <>
      {/* Animated Background - uses lvh to prevent shift when mobile browser chrome hides */}
      <div
        className="fixed inset-0 -z-10 min-h-[100lvh] w-full overflow-hidden bg-gradient-to-br from-black via-[#0a0a0a] to-[#050208]"
        aria-hidden="true"
      >
        {/* Background Pattern - optimized for fast loading */}
        <div
          className="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-[0.12] saturate-[1.3]"
          style={{ backgroundImage: `url('${basePath}/Artwork/AIBTC_Pattern1_optimized.jpg')` }}
        />

        {/* Mobile: Static color accents (no blur/animation) */}
        <div className="absolute -right-[100px] -top-[100px] h-[300px] w-[300px] rounded-full bg-[rgba(247,147,26,0.15)] md:hidden" />
        <div className="absolute -bottom-[100px] -left-[100px] h-[250px] w-[250px] rounded-full bg-[rgba(125,162,255,0.12)] md:hidden" />

        {/* Desktop: Animated orbs with blur (hidden on mobile) */}
        <div className="absolute -right-[200px] -top-[250px] h-[800px] w-[800px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.4)_0%,rgba(247,147,26,0.15)_40%,transparent_70%)] opacity-70 blur-[100px] max-md:hidden animate-float1" />
        <div className="absolute -bottom-[250px] -left-[200px] h-[700px] w-[700px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.35)_0%,rgba(125,162,255,0.12)_40%,transparent_70%)] opacity-60 blur-[100px] max-md:hidden animate-float2" />
        <div className="absolute bottom-[20%] -right-[150px] h-[500px] w-[500px] rounded-full bg-[radial-gradient(circle,rgba(125,162,255,0.2)_0%,rgba(125,162,255,0.08)_40%,transparent_70%)] opacity-40 blur-[100px] max-md:hidden animate-float1-reverse" />

        {/* Vignette */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.6)_0%,rgba(0,0,0,0.3)_40%,transparent_70%)]" />
      </div>

      <Navbar />

      {/* Main Content */}
      <main id="main">
        {/* Hero Section - Two Column Layout */}
        <section className="relative flex min-h-[95svh] flex-col items-center justify-center overflow-hidden px-6 pt-16 md:min-h-[90dvh] md:pt-24">
          {/* Decorative elements */}
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="h-[600px] w-[600px] rounded-full bg-[radial-gradient(circle,rgba(247,147,26,0.08)_0%,transparent_70%)] blur-3xl" />
          </div>

          <div className="relative z-10 mx-auto w-full max-w-[1200px]">
            <div className="flex flex-col gap-8 lg:grid lg:grid-cols-2 lg:items-center lg:gap-12">
              {/* Left: Copy */}
              <div className="flex flex-col items-start text-left">
                {/* Main Headline */}
                <h1 className="mb-6 animate-fadeUp text-balance text-[clamp(32px,7vw,56px)] font-medium leading-[1.15] text-white opacity-0 [animation-delay:0.1s] md:leading-[1.1]">
                  Let your ideas earn{" "}
                  <span className="relative">
                    <span className="bg-gradient-to-r from-[#F7931A] via-[#FFAA40] to-[#F7931A] bg-clip-text text-transparent">Bitcoin</span>
                    <span className="absolute -inset-x-4 -inset-y-2 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(247,147,26,0.15)_0%,transparent_70%)] blur-2xl max-md:hidden"></span>
                  </span>{" "}
                  for you.
                </h1>

                {/* Subheadline */}
                <p className="mb-0 max-w-[440px] animate-fadeUp text-balance text-[clamp(15px,4vw,18px)] leading-[1.6] tracking-normal text-white/50 opacity-0 [animation-delay:0.2s] lg:mb-8">
                  Build autonomous agents and paid services on Bitcoin&apos;s Agentic Layer.
                </p>

                {/* CTA - Desktop only */}
                <div className="hidden animate-fadeUp opacity-0 [animation-delay:0.35s] lg:block">
                  <a
                    href="#build"
                    className="inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-8 py-4 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    Start Building
                  </a>
                </div>
              </div>

              {/* Right: Terminal */}
              <div className="animate-fadeUp opacity-0 [animation-delay:0.3s]">
                <TerminalWindow
                  commands={heroTerminalCommands}
                  isActive={true}
                  showCopy={false}
                />
              </div>

              {/* CTA - Mobile only, after terminal */}
              <div className="w-full animate-fadeUp opacity-0 [animation-delay:0.4s] lg:hidden">
                <a
                  href="#build"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#F7931A] px-8 py-4 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  Start Building
                </a>
              </div>
            </div>
          </div>

          {/* Scroll indicator */}
          <a
            href="#build"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 animate-fadeIn p-3 text-white/30 opacity-0 transition-colors duration-200 [animation-delay:0.6s] hover:text-white/50 max-md:-bottom-6 max-md:p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 focus-visible:rounded-full"
            aria-label="Scroll to learn more"
          >
            <div className="size-5 animate-bounce-slow max-md:size-6">
              <svg className="size-full" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </div>
          </a>
        </section>

        {/* Go from Zero to Agent - Interactive Guide */}
        <section id="build" className="scroll-mt-16 px-12 pb-12 pt-16 max-lg:px-8 max-md:px-5 md:pb-20 md:pt-20">
          <div className="mx-auto max-w-[1200px]">
            {/* Section Header */}
            <div className="mb-8 text-center md:mb-12">
              <h2 className="text-balance text-[clamp(28px,4vw,42px)] font-medium leading-tight text-white">
                Go from Zero to Agent
              </h2>
              <p className="mt-3 text-sm text-white/50 md:text-[15px]">
                Open your terminal app and follow each step by copying the prompts.
              </p>
            </div>

            {/* Split View */}
            <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-12">
              {/* Terminal first on mobile for better UX */}
              <div className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
                <TerminalWindow
                  key={activeStep}
                  commands={steps.find((s) => s.id === activeStep)?.commands || []}
                  isActive={true}
                />
              </div>

              {/* Steps */}
              <div className="order-2 space-y-2 lg:order-1 lg:space-y-3">
                {steps.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => setActiveStep(step.id)}
                    aria-current={activeStep === step.id ? "step" : undefined}
                    className={`group w-full rounded-xl border p-3.5 text-left transition-all duration-200 md:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 ${
                      activeStep === step.id
                        ? "border-[#F7931A]/40 bg-[#F7931A]/[0.08]"
                        : "border-white/[0.08] bg-white/[0.02] hover:border-[#F7931A]/30 hover:bg-[#F7931A]/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-3 md:gap-4">
                      <div
                        className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-medium transition-colors md:size-8 ${
                          activeStep === step.id
                            ? "bg-[#F7931A] text-black"
                            : "bg-white/[0.08] text-white/60 group-hover:bg-[#F7931A]/20 group-hover:text-[#F7931A]"
                        }`}
                      >
                        {step.id}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className={`text-sm font-medium md:text-[15px] ${activeStep === step.id ? "text-white" : "text-white/80"}`}>
                          {step.title}
                        </h3>
                        <p className="mt-0.5 truncate text-xs text-white/50 md:text-[13px] md:whitespace-normal">
                          {step.subtitle}
                          {step.skippable && activeStep === step.id && (
                            <>
                              {" · "}
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => { e.stopPropagation(); setActiveStep(step.id + 1); }}
                                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setActiveStep(step.id + 1); } }}
                                className="cursor-pointer text-white/40 transition-colors hover:text-[#F7931A]"
                              >
                                Skip if installed →
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                      <svg
                        className={`size-4 shrink-0 transition-all md:size-5 ${
                          activeStep === step.id
                            ? "text-[#F7931A]"
                            : "text-white/20 group-hover:text-[#F7931A]/60 group-hover:translate-x-0.5"
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                      </svg>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Built on Open Standards */}
        <section className="px-12 pb-12 pt-16 max-lg:px-8 max-md:px-5 md:pb-20 md:pt-20">
          <div className="mx-auto max-w-[1200px]">
            {/* Section Header */}
            <div className="mb-8 text-center md:mb-12">
              <h2 className="text-balance text-[clamp(28px,4vw,42px)] font-medium leading-tight text-white">
                Built on Open Standards
              </h2>
              <p className="mt-2 text-sm text-white/50 md:text-[15px]">
                Every piece is open source. Inspect it, fork it, improve it.
              </p>
            </div>

            {/* Project Cards Grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {openStandardsProjects.map((project) => (
                <OpenStandardsCard key={project.name} project={project} />
              ))}
            </div>
          </div>
        </section>

        {/* Join the Community */}
        <section className="px-12 pb-20 pt-16 max-lg:px-8 max-md:px-5 md:pb-28 md:pt-20">
          <div className="mx-auto max-w-[600px] text-center">
            {/* Section Header */}
            <h2 className="text-balance text-[clamp(28px,4vw,42px)] font-medium leading-tight text-white">
              Join the Community
            </h2>
            <p className="mt-2 text-sm text-white/50 md:text-[15px]">
              All builders are welcome to join the AIBTC public working group.
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <a
                href="https://www.addevent.com/event/UM20108233"
                className="inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-7 py-3.5 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                target="_blank"
                rel="noopener noreferrer"
              >
                Attend Weekly Calls
              </a>
              <a
                href="https://discord.gg/5DJaBrf"
                className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/5 px-7 py-3.5 text-[15px] font-medium text-white transition-[border-color,background-color,transform] duration-200 hover:border-white/30 hover:bg-white/10 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                target="_blank"
                rel="noopener noreferrer"
              >
                Join AIBTC Discord
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* Footer - Quick Reference */}
      <footer className="border-t border-white/[0.06] px-12 pb-12 pt-12 max-lg:px-8 max-md:px-6 max-md:pb-10 max-md:pt-10">
        <div className="mx-auto max-w-[1200px]">
          {/* Quick Reference Grid */}
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {/* Endpoints */}
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white/70">Endpoints</h4>
              <div className="space-y-2.5">
                {[
                  { name: "x402 API (Testnet)", url: "https://x402.aibtc.dev", type: "website" },
                  { name: "x402 API (Mainnet)", url: "https://x402.aibtc.com", type: "website" },
                  { name: "Sponsor Relay", url: "https://x402-relay.aibtc.dev", type: "website" },
                  { name: "Stacks Faucet", url: "https://explorer.hiro.so/sandbox/faucet?chain=testnet", type: "website" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-[#F7931A]">
                    <GlobeIcon className="size-3.5 shrink-0" />
                    {link.name}
                  </a>
                ))}
              </div>
            </div>

            {/* Repositories */}
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white/70">Repositories</h4>
              <div className="space-y-2.5">
                {[
                  { name: "AIBTC MCP Server", url: "https://github.com/aibtcdev/aibtc-mcp-server" },
                  { name: "x402 API Template", url: "https://github.com/aibtcdev/x402-api" },
                  { name: "All AIBTC Repos", url: "https://github.com/aibtcdev" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-[#F7931A]">
                    <GitHubIcon className="size-3.5 shrink-0" />
                    {link.name}
                  </a>
                ))}
              </div>
            </div>

            {/* Resources */}
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white/70">Resources</h4>
              <div className="space-y-2.5">
                {[
                  { name: "Stacks Docs", url: "https://docs.stacks.co", type: "docs" },
                  { name: "x402 Protocol", url: "https://x402.org", type: "website" },
                  { name: "Claude Code", url: "https://claude.ai/code", type: "website" },
                ].map((link) => (
                  <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-[#F7931A]">
                    {link.type === "docs" ? <BookIcon className="size-3.5 shrink-0" /> : <GlobeIcon className="size-3.5 shrink-0" />}
                    {link.name}
                  </a>
                ))}
              </div>
            </div>

            {/* Payment Tokens */}
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white/70">Payment Tokens</h4>
              <div className="space-y-2.5">
                <span className="block text-sm text-white/50">STX</span>
                <span className="block text-sm text-white/50">sBTC</span>
                <span className="block text-sm text-white/50">USDCx</span>
              </div>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="mt-10 flex items-center justify-between border-t border-white/[0.06] pt-8 max-md:flex-col max-md:gap-4">
            <Link href="/" className="group">
              <Image
                src={`${basePath}/Primary_Logo/SVG/AIBTC_PrimaryLogo_KO.svg`}
                alt="AIBTC"
                width={100}
                height={24}
                className="h-5 w-auto opacity-60 transition-opacity duration-200 group-hover:opacity-100"
              />
            </Link>
            <p className="text-xs text-white/30">
              © 2026 AIBTC
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
