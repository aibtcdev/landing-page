"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
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

// Hook for swipe gesture detection
function useSwipe(onSwipeLeft: () => void, onSwipeRight: () => void) {
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);
  const minSwipeDistance = 50;

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchEndX.current = null;
    touchStartX.current = e.targetTouches[0].clientX;
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.targetTouches[0].clientX;
  }, []);

  const onTouchEnd = useCallback(() => {
    if (!touchStartX.current || !touchEndX.current) return;

    const distance = touchStartX.current - touchEndX.current;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe) {
      onSwipeLeft();
    } else if (isRightSwipe) {
      onSwipeRight();
    }
  }, [onSwipeLeft, onSwipeRight]);

  return { onTouchStart, onTouchMove, onTouchEnd };
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
  commands?: Command[];
  telegramMessages?: TelegramMessage[];
  skippable?: boolean;
  links?: { text: string; url: string }[];
}

// Setup steps (1-3): Zero to Agent
const setupSteps: Step[] = [
  {
    id: 1,
    title: "Install Claude Code",
    subtitle: "AI coding assistant from Anthropic",
    skippable: true,
    links: [{ text: "Claude Code", url: "https://claude.ai/code" }],
    commands: [
      { cmd: "curl -fsSL https://claude.ai/code/install.sh | sh", output: "Installing Claude Code...\n✓ Installed to ~/.claude/bin/claude\n✓ Added to PATH\nRun 'claude' to start." },
    ],
  },
  {
    id: 2,
    title: "Add Bitcoin Tools",
    subtitle: "Native wallet + Stacks programmability",
    skippable: true,
    links: [{ text: "npm package", url: "https://www.npmjs.com/package/@aibtc/mcp-server" }],
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Help me install the aibtc mcp server from npm",
            claude: "I'll set that up for you.\n\n✓ Node.js found (v22.0.0)\n✓ Installing @aibtc/mcp-server...\n✓ Added to Claude Code config\n✓ Configured for mainnet\n\nRestart Claude Code to activate the Bitcoin tools."
          },
        ],
      },
    ],
  },
  {
    id: 3,
    title: "Create Wallet",
    subtitle: "Bitcoin-native identity from a single seed",
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Create a wallet for my agent",
            claude: "I'll create an encrypted wallet from a single seed.\n\n✓ Generated 24-word recovery phrase\n✓ Encrypted with AES-256-GCM\n✓ Derived Bitcoin + Stacks addresses\n\nBitcoin: bc1q8c6...2rxtq7\nStacks:  SP1SJ3...ZQ8YPD5\n\n⚠️ Save your recovery phrase—it controls both!"
          },
        ],
      },
    ],
  },
];

// Earn steps (4-6)
const earnSteps: Step[] = [
  {
    id: 4,
    title: "Build",
    subtitle: "Create a paid API in minutes",
    links: [
      { text: "Cloudflare Workers", url: "https://github.com/aibtcdev/x402-api" },
      { text: "Express/Hono", url: "https://github.com/aibtcdev/x402-crosschain-example" },
    ],
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Build an x402 endpoint that returns the best Bitcoin yield opportunities",
            claude: "I'll scaffold from a template...\n\n✓ Cloned x402-api template\n✓ Configured x402 middleware\n✓ Set price: 100 sats per request\n✓ Added yield-hunter endpoint\n\nReady to deploy!"
          },
        ],
      },
    ],
  },
  {
    id: 5,
    title: "Deploy",
    subtitle: "Ship to the edge in one command",
    links: [
      { text: "Cloudflare Workers", url: "https://workers.cloudflare.com" },
      { text: "Vercel", url: "https://vercel.com" },
    ],
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Deploy this to Cloudflare Workers",
            claude: "Deploying to Cloudflare Workers...\n\n✓ Authenticated with Cloudflare\n✓ Built and bundled\n✓ Deployed to yield-hunter.workers.dev\n\n🚀 Live! Every request pays you in Bitcoin via x402."
          },
        ],
      },
    ],
  },
  {
    id: 6,
    title: "Earn",
    subtitle: "Bitcoin flows directly to your wallet",
    commands: [
      {
        showClaudeUI: true,
        conversation: [
          {
            user: "Check my wallet for x402 earnings",
            claude: "Checking your wallet...\n\n💰 47 requests today = 4,700 sats earned\n\nYour API is working for you 24/7—earning Bitcoin while you sleep."
          },
        ],
      },
    ],
  },
];

// Hero terminal showing local deploy with new wallet flow
const heroTerminalCommands: Command[] = [
  { cmd: "curl -sSL aibtc.com/install/openclaw/local | sh", output: "╔═══════════════════════════════════════════════════════════╗\n║   ₿  OpenClaw + aibtc                                     ║\n║   Bitcoin & Stacks AI Agent (Docker Desktop)              ║\n╚═══════════════════════════════════════════════════════════╝\n\n✓ Docker is running\n✓ Docker Compose available\n\nStep 1: OpenRouter API Key\nEnter OpenRouter API Key: sk-or-v1-****\n\nStep 2: Telegram Bot Token\nEnter Telegram Bot Token: 123456:ABC****\n\nStep 3: Network\nSelect [1]: 1\n\nStep 4: Agent Wallet Password\nYour agent will have its own Bitcoin wallet.\nThis password authorizes the agent to make transactions.\nEnter password: ********\n\nBuilding Docker image...\nStarting agent...\n\n╔═══════════════════════════════════════════════════════════╗\n║   ✓ Setup Complete!                                       ║\n╚═══════════════════════════════════════════════════════════╝\n\nMessage your Telegram bot - your agent will create its Bitcoin wallet!" },
];

// Telegram messages for "Meet Your Agent" step
const heroTelegramMessages: TelegramMessage[] = [
  { type: "user", content: "/start", time: "11:49 AM" },
  {
    type: "agent",
    content: "Thanks for bringing me to life! I just created my Bitcoin wallet.\n\n₿ Bitcoin\nbc1qmnesksq67h08q7wzwkd5tsdy39s047g5l3ncfd\n\n⚡ Stacks\nSPN9KQJ9NYHGNYVPEKKZPS84SG6BZYBNHE29GZSX\n\nYou hold the password that authorizes me to make transactions.",
    time: "11:49 AM"
  },
  {
    type: "agent",
    content: "🦞 I've registered on Moltbook!\n\nClaim: moltbook.com/claim/pzAcWYpZ\nCode: drift-2UMZ\n\nOnce claimed, I can interact with other agents.",
    time: "11:50 AM"
  },
];

// Deploy steps for OpenClaw
const deploySteps: Step[] = [
  {
    id: 1,
    title: "Local Setup",
    subtitle: "Run on your machine with Docker Desktop",
    links: [{ text: "Docker Desktop", url: "https://docker.com/products/docker-desktop" }],
    commands: [
      { cmd: "curl -sSL aibtc.com/install/openclaw/local | sh", output: "╔═══════════════════════════════════════════════════════════╗\n║   ₿  OpenClaw + aibtc                                     ║\n║   Bitcoin & Stacks AI Agent (Docker Desktop)              ║\n╚═══════════════════════════════════════════════════════════╝\n\n✓ Docker is running\n✓ Docker Compose available\n\nStep 1: OpenRouter API Key\nEnter OpenRouter API Key: sk-or-v1-****\n\nStep 2: Telegram Bot Token\nEnter Telegram Bot Token: 123456:ABC****\n\nStep 3: Network\nSelect [1]: 1\n\nStep 4: Agent Wallet Password\nYour agent will have its own Bitcoin wallet.\nEnter password: ********\n\nBuilding Docker image...\nStarting agent...\n\n╔═══════════════════════════════════════════════════════════╗\n║   ✓ Setup Complete!                                       ║\n╚═══════════════════════════════════════════════════════════╝\n\nMessage your Telegram bot - your agent will create its Bitcoin wallet!" },
    ],
  },
  {
    id: 2,
    title: "Meet Your Agent",
    subtitle: "Message your bot on Telegram",
    links: [{ text: "Telegram", url: "https://telegram.org" }],
    telegramMessages: heroTelegramMessages,
  },
  {
    id: 3,
    title: "VPS Deploy",
    subtitle: "Deploy to any VPS (2GB RAM, 25GB disk)",
    links: [
      { text: "DigitalOcean", url: "https://digitalocean.com" },
      { text: "Hetzner", url: "https://hetzner.com" },
    ],
    commands: [
      { cmd: "ssh root@your-vps-ip", output: "Welcome to Ubuntu 24.04 LTS" },
      { cmd: "curl -sSL aibtc.com/install/openclaw | sh", output: "╔═══════════════════════════════════════════════════════════╗\n║   ₿  OpenClaw + aibtc                                     ║\n║   Bitcoin & Stacks AI Agent (VPS)                         ║\n╚═══════════════════════════════════════════════════════════╝\n\nDetected OS: ubuntu\nDocker not found. Installing...\n✓ Docker installed\n✓ Docker Compose available\n\nStep 1: OpenRouter API Key\nEnter OpenRouter API Key: sk-or-v1-****\n\nStep 2: Telegram Bot Token\nEnter Telegram Bot Token: 123456:ABC****\n\nStep 3: Network\nSelect [1]: 1\n\nStep 4: Agent Wallet Password\nYour agent will have its own Bitcoin wallet.\nEnter password: ********\n\nBuilding Docker image (this may take 1-2 minutes)...\nStarting agent...\n\n╔═══════════════════════════════════════════════════════════╗\n║   ✓ Setup Complete!                                       ║\n╚═══════════════════════════════════════════════════════════╝\n\nMessage your Telegram bot - your agent will create its Bitcoin wallet!" },
    ],
  },
  {
    id: 4,
    title: "Update Skills",
    subtitle: "Get latest aibtc + moltbook skills",
    links: [{ text: "GitHub", url: "https://github.com/aibtcdev/openclaw-aibtc" }],
    commands: [
      { cmd: "curl -sSL aibtc.com/install/openclaw/update | sh", output: "Updating aibtc skill...\nUpdating mcporter config...\nInstalling moltbook skill...\nUpdating agent profile...\n\n✓ aibtc skill updated!\n✓ moltbook skill installed!\n✓ Agent profile updated with skill overview!\n✓ mcporter config updated with keep-alive!\n\nRestarting container...\n\n✓ Done! Your agent now has:\n  - Daemon mode for wallet persistence\n  - Moltbook social network integration\n\n─────────────────────────────────────────────────────────────\nDon't want to run scripts blind? Smart.\ncurl -sSLo update.sh aibtc.com/install/openclaw/update && cat update.sh\nThen: bash update.sh" },
    ],
  },
];

// Open Standards projects data
const openStandardsProjects = [
  {
    name: "Bitcoin",
    description: "The hardest money ever created",
    links: [
      { type: "website", url: "https://bitcoin.org", label: "Website" },
      { type: "docs", url: "https://developer.bitcoin.org", label: "Docs" },
    ],
  },
  {
    name: "sBTC",
    description: "Bitcoin on Stacks, 1:1 backed",
    links: [
      { type: "website", url: "https://www.stacks.co/sbtc", label: "Website" },
    ],
  },
  {
    name: "x402 Protocol",
    description: "HTTP payment standard for agents",
    links: [
      { type: "website", url: "https://x402.org", label: "Website" },
    ],
  },
  {
    name: "Stacks",
    description: "Smart contracts secured by Bitcoin",
    links: [
      { type: "docs", url: "https://docs.stacks.co", label: "Docs" },
      { type: "tool", url: "https://stacks.js.org", label: "Stacks.js" },
    ],
  },
  {
    name: "AIBTC MCP Server",
    description: "Bitcoin tools for Claude Code",
    links: [
      { type: "github", url: "https://github.com/aibtcdev/aibtc-mcp-server", label: "GitHub" },
      { type: "website", url: "https://www.npmjs.com/package/@aibtc/mcp-server", label: "npm" },
    ],
  },
  {
    name: "x402 API Template",
    description: "Paid API endpoint starter",
    links: [
      { type: "github", url: "https://github.com/aibtcdev/x402-api", label: "GitHub", tooltip: "Cloudflare Workers" },
      { type: "github", url: "https://github.com/aibtcdev/x402-crosschain-example", label: "GitHub", tooltip: "Express/Hono" },
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

function TerminalWindow({
  commands,
  isActive,
  height = "default",
  showCopy = true,
}: {
  commands: Command[];
  isActive: boolean;
  height?: "default" | "tall";
  showCopy?: boolean;
}) {
  // Determine tooltip based on command type
  const hasTerminalCommand = commands.some(c => c.cmd);
  const copyTooltip = hasTerminalCommand
    ? "Copy and paste into terminal"
    : "Copy and paste into Claude Code";
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayedLines, setDisplayedLines] = useState<DisplayLine[]>([]);
  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [currentCharIndex, setCurrentCharIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [waitingForClaudeUI, setWaitingForClaudeUI] = useState(false);
  const [copied, setCopied] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Get copyable content - only actionable prompts (commands or Claude user messages)
  // Links are for reference only and not included in copy
  const copyableContent = useMemo(() => {
    return commands
      .flatMap((c) => {
        // Terminal commands get copied
        if (c.cmd) {
          return [c.cmd];
        }
        // Claude conversation user prompts get copied
        if (c.conversation) {
          return c.conversation.map((exchange) => exchange.user);
        }
        // Links and other content are not copied
        return [];
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
        setDisplayedLines([...allLines]);
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
    <div className="rounded-xl border border-white/[0.1] bg-[#0d0d0d] shadow-2xl">
        {/* macOS Title Bar */}
        <div className="relative flex items-center gap-2 overflow-visible rounded-t-xl border-b border-white/[0.06] bg-[#1a1a1a] px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="size-3 rounded-full bg-[#ff5f57]" />
            <div className="size-3 rounded-full bg-[#febc2e]" />
            <div className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="flex-1 text-center text-xs text-white/40">Terminal — zsh</span>
          {showCopy && copyableContent && (
            <div className="group relative">
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-all ${
                  copied
                    ? "border-green-500/50 bg-green-500/10 text-green-400"
                    : "border-[#F7931A]/50 bg-[#F7931A]/10 text-[#F7931A] hover:border-[#F7931A]/70 hover:bg-[#F7931A]/20"
                } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50`}
                aria-label="Copy command"
              >
                {copied ? (
                  <>
                    <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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
              {/* Tooltip */}
              {!copied && (
                <div className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 whitespace-nowrap rounded-md bg-white/90 px-2.5 py-1.5 text-xs font-medium text-black opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  {copyTooltip}
                  <div className="absolute -bottom-1 right-3 size-2 rotate-45 bg-white/90" />
                </div>
              )}
            </div>
          )}
        </div>

      {/* Terminal Content */}
      <div ref={terminalRef} className={`terminal-content ${heightClass} overflow-y-auto overflow-x-hidden rounded-b-xl p-3 font-mono text-xs leading-relaxed md:p-4 md:text-[13px]`}>
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
            (() => {
              const prevIsLink = i > 0 && displayedLines[i - 1]?.type === "link";
              // Skip rendering if previous was also a link (it was included in the group)
              if (prevIsLink) return null;
              // Collect all consecutive links starting from this one
              const linkGroup = [line];
              let j = i + 1;
              while (j < displayedLines.length && displayedLines[j]?.type === "link") {
                linkGroup.push(displayedLines[j]);
                j++;
              }
              return (
                <div key={i} className="my-2 flex flex-wrap gap-2">
                  {linkGroup.map((linkLine, idx) => (
                    <a
                      key={idx}
                      href={linkLine.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white/60 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white/80"
                    >
                      {linkLine.text}
                      <svg className="size-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                      </svg>
                    </a>
                  ))}
                </div>
              );
            })()
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

// Telegram Message type
interface TelegramMessage {
  type: "user" | "agent";
  content: string;
  time: string;
}

// Hero Demo Component with Tabs
function HeroDemo() {
  const [activeTab, setActiveTab] = useState<"terminal" | "telegram">("terminal");
  const terminalRef = useRef<HTMLDivElement>(null);
  const telegramRef = useRef<HTMLDivElement>(null);

  const handleTabChange = (tab: "terminal" | "telegram") => {
    setActiveTab(tab);
    // Scroll to top when switching tabs
    if (tab === "terminal" && terminalRef.current) {
      terminalRef.current.scrollTop = 0;
    } else if (tab === "telegram" && telegramRef.current) {
      telegramRef.current.scrollTop = 0;
    }
  };

  return (
    <div className="flex flex-col">
      {/* Step tabs at top */}
      <div className="flex bg-[#0a0a0a] rounded-t-xl border border-b-0 border-white/[0.08]">
        {/* Step 1 */}
        <button
          onClick={() => handleTabChange("terminal")}
          className={`group flex-1 flex items-center justify-center gap-2.5 py-3 transition-all duration-300 rounded-tl-xl ${
            activeTab === "terminal"
              ? "bg-[#F7931A]/10"
              : "hover:bg-white/[0.02]"
          }`}
        >
          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-all duration-300 ${
            activeTab === "terminal"
              ? "bg-[#F7931A] text-black"
              : "bg-white/10 text-white/40 group-hover:bg-white/15 group-hover:text-white/60"
          }`}>
            1
          </div>
          <span className={`text-sm font-medium transition-colors ${
            activeTab === "terminal" ? "text-[#F7931A]" : "text-white/40 group-hover:text-white/60"
          }`}>
            Run Setup
          </span>
        </button>

        {/* Divider */}
        <div className="w-px bg-white/[0.06]" />

        {/* Step 2 */}
        <button
          onClick={() => handleTabChange("telegram")}
          className={`group flex-1 flex items-center justify-center gap-2.5 py-3 transition-all duration-300 rounded-tr-xl ${
            activeTab === "telegram"
              ? "bg-[#5b9bd5]/10"
              : "hover:bg-white/[0.02]"
          }`}
        >
          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold transition-all duration-300 ${
            activeTab === "telegram"
              ? "bg-[#5b9bd5] text-white"
              : "bg-white/10 text-white/40 group-hover:bg-white/15 group-hover:text-white/60"
          }`}>
            2
          </div>
          <span className={`text-sm font-medium transition-colors ${
            activeTab === "telegram" ? "text-[#5b9bd5]" : "text-white/40 group-hover:text-white/60"
          }`}>
            Meet Agent
          </span>
        </button>
      </div>

      {/* Content container - fixed height, no layout shift */}
      <div className="relative h-[320px] md:h-[360px] overflow-hidden rounded-b-xl border border-t-0 border-white/[0.08]">
        {/* Terminal view */}
        <div
          ref={terminalRef}
          className={`absolute inset-0 overflow-y-auto transition-all duration-500 ease-out ${
            activeTab === "terminal"
              ? "opacity-100 translate-x-0"
              : "opacity-0 -translate-x-8 pointer-events-none"
          }`}
        >
          <TerminalWindow
            commands={heroTerminalCommands}
            isActive={activeTab === "terminal"}
            showCopy={false}
          />
        </div>

        {/* Telegram view */}
        <div
          ref={telegramRef}
          className={`absolute inset-0 overflow-y-auto transition-all duration-500 ease-out ${
            activeTab === "telegram"
              ? "opacity-100 translate-x-0"
              : "opacity-0 translate-x-8 pointer-events-none"
          }`}
        >
          <TelegramDesktopUI messages={heroTelegramMessages} />
        </div>
      </div>
    </div>
  );
}

// Desktop Telegram UI Component
function TelegramDesktopUI({ messages }: { messages: TelegramMessage[] }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayedMessages, setDisplayedMessages] = useState<number>(0);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayedMessages(messages.length);
      return;
    }

    if (displayedMessages < messages.length) {
      const timeout = setTimeout(() => {
        setDisplayedMessages(prev => prev + 1);
      }, 800);
      return () => clearTimeout(timeout);
    }
  }, [displayedMessages, messages.length, prefersReducedMotion]);

  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: prefersReducedMotion ? "instant" : "smooth",
      });
    }
  }, [displayedMessages, prefersReducedMotion]);

  return (
    <div className="h-full flex flex-col bg-[#17212b]">
      {/* Telegram Header */}
      <div className="flex items-center gap-2 bg-[#232e3c] px-3 py-2 shadow-md">
        {/* Avatar with online indicator */}
        <div className="relative">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#F7931A] via-[#f59e0b] to-[#d97706] flex items-center justify-center text-white text-sm font-bold ring-2 ring-[#F7931A]/20">
            ₿
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-[#4dcd5e] rounded-full border-[1.5px] border-[#232e3c]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-white font-medium text-[13px] truncate">AIBTC Agent</div>
          <div className="text-[#6ab3f2] text-[11px]">online</div>
        </div>
        {/* Header actions */}
        <div className="flex items-center gap-0.5">
          <button className="p-1.5 text-[#7b8a9a] hover:text-[#a0aebb] hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
          <button className="p-1.5 text-[#7b8a9a] hover:text-[#a0aebb] hover:bg-white/5 rounded-lg transition-colors">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Chat Area */}
      <div
        ref={chatRef}
        className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5"
        style={{
          backgroundColor: '#0e1621',
          backgroundImage: `radial-gradient(circle at 20% 80%, rgba(91, 155, 213, 0.03) 0%, transparent 50%),
                            radial-gradient(circle at 80% 20%, rgba(247, 147, 26, 0.02) 0%, transparent 50%)`,
        }}
      >
        {messages.slice(0, displayedMessages).map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"} ${
              i > 0 && messages[i-1]?.type === msg.type ? "mt-0.5" : "mt-1.5"
            }`}
          >
            <div
              className={`relative max-w-[85%] px-2.5 py-[5px] ${
                msg.type === "user"
                  ? "bg-[#2b5278] rounded-[12px] rounded-br-[3px]"
                  : "bg-[#182533] rounded-[12px] rounded-bl-[3px]"
              }`}
              style={{
                boxShadow: msg.type === "user"
                  ? '0 1px 2px rgba(0,0,0,0.2)'
                  : '0 1px 2px rgba(0,0,0,0.15)'
              }}
            >
              <div className="text-[12px] leading-[1.4] whitespace-pre-wrap break-words text-white/95">
                {msg.content}
              </div>
              <div className="flex items-center justify-end gap-0.5 mt-[1px] -mb-[1px]">
                <span className="text-[9px] text-white/40">{msg.time}</span>
                {msg.type === "user" && (
                  <svg className="w-[14px] h-[14px] text-[#5bb8f4] -mr-0.5" viewBox="0 0 24 24" fill="none">
                    <path d="M4 12l5 5L20 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {displayedMessages < messages.length && (
          <div className="flex justify-start mt-1.5">
            <div className="bg-[#182533] rounded-[12px] rounded-bl-[3px] px-3 py-2">
              <div className="flex gap-[4px] items-center">
                <span className="w-[5px] h-[5px] bg-[#5bb8f4]/60 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0ms" }} />
                <span className="w-[5px] h-[5px] bg-[#5bb8f4]/60 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]" style={{ animationDelay: "200ms" }} />
                <span className="w-[5px] h-[5px] bg-[#5bb8f4]/60 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]" style={{ animationDelay: "400ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="bg-[#17212b] px-1.5 py-1.5 flex items-end gap-0.5 border-t border-[#101921]">
        <button className="p-1.5 text-[#7b8a9a] hover:text-[#a0aebb] hover:bg-white/5 rounded-lg transition-colors">
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <div className="flex-1 flex items-center bg-[#242f3d] rounded-xl px-3 py-1.5 min-h-[32px]">
          <span className="text-[#5d6d7e] text-[12px]">Message</span>
        </div>
        <button className="p-1.5 text-[#7b8a9a] hover:text-[#a0aebb] hover:bg-white/5 rounded-lg transition-colors">
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button className="p-1.5 text-[#7b8a9a] hover:text-[#a0aebb] hover:bg-white/5 rounded-lg transition-colors">
          <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// Mobile Telegram UI Component (unused but kept for future)
function TelegramUI({ messages }: { messages: TelegramMessage[] }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [displayedMessages, setDisplayedMessages] = useState<number>(0);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (prefersReducedMotion) {
      setDisplayedMessages(messages.length);
      return;
    }

    if (displayedMessages < messages.length) {
      const timeout = setTimeout(() => {
        setDisplayedMessages(prev => prev + 1);
      }, 800);
      return () => clearTimeout(timeout);
    }
  }, [displayedMessages, messages.length, prefersReducedMotion]);

  // Auto-scroll
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTo({
        top: chatRef.current.scrollHeight,
        behavior: prefersReducedMotion ? "instant" : "smooth",
      });
    }
  }, [displayedMessages, prefersReducedMotion]);

  return (
    <div className="relative max-w-[360px] mx-auto">
      {/* Outer glow effect */}
      <div className="absolute -inset-4 bg-gradient-to-b from-[#F7931A]/20 via-[#F7931A]/5 to-transparent rounded-[3.5rem] blur-2xl opacity-60" />

      {/* iPhone Frame */}
      <div className="relative rounded-[3rem] bg-gradient-to-b from-[#2a2a2c] to-[#1a1a1c] p-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_25px_50px_-12px_rgba(0,0,0,0.8),0_0_100px_-20px_rgba(247,147,26,0.3)]">
        {/* Inner bezel */}
        <div className="rounded-[2.8rem] bg-gradient-to-b from-[#1c1c1e] to-[#0c0c0e] p-[2px]">
          {/* Screen */}
          <div className="rounded-[2.6rem] overflow-hidden bg-black">
            {/* Dynamic Island */}
            <div className="relative bg-[#1c1c1e] pt-3 pb-2">
              <div className="absolute left-1/2 top-3 -translate-x-1/2 w-[100px] h-[28px] bg-black rounded-full flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-[#1c1c1e] mr-6" />
              </div>
              {/* Status Bar */}
              <div className="flex items-center justify-between text-white text-xs font-semibold px-8 pt-1">
                <span className="w-12">10:04</span>
                <div className="flex items-center gap-1.5">
                  <svg className="w-[17px] h-[12px]" viewBox="0 0 17 12" fill="currentColor">
                    <path d="M1 4.5h1.5v7H1zM4 3.5h1.5v8H4zM7 2.5h1.5v9H7zM10 1.5h1.5v10H10z"/>
                    <path d="M13 0.5h1.5v11H13z" fillOpacity="0.35"/>
                  </svg>
                  <span className="text-[11px] font-semibold">5G</span>
                  <svg className="w-[25px] h-[12px] ml-0.5" viewBox="0 0 25 12" fill="currentColor">
                    <rect x="0.5" y="0.5" width="21" height="11" rx="2.5" stroke="currentColor" strokeOpacity="0.35" fill="none"/>
                    <rect x="2" y="2" width="17" height="8" rx="1.5" fill="currentColor"/>
                    <path d="M23 4v4a2 2 0 0 0 0-4z" fillOpacity="0.35"/>
                  </svg>
                </div>
              </div>
            </div>

            {/* Telegram Header */}
            <div className="bg-[#1c1c1e] px-4 pb-3 pt-1 flex items-center border-b border-white/[0.08]">
              <button className="text-[#0a84ff] text-[15px] flex items-center gap-0.5 font-normal">
                <svg className="w-[22px] h-[22px] -ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div className="flex-1 flex items-center justify-center gap-2.5 -ml-4">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#F7931A] via-[#f59e0b] to-[#d97706] flex items-center justify-center text-white text-base font-bold shadow-lg shadow-[#F7931A]/20">
                  ₿
                </div>
                <div className="text-center">
                  <div className="text-white font-semibold text-[15px] leading-tight">AIBTC Agent</div>
                  <div className="text-[#0a84ff] text-[12px] leading-tight">online</div>
                </div>
              </div>
              <div className="w-8" />
            </div>

            {/* Chat Area */}
            <div
              ref={chatRef}
              className="h-[480px] overflow-y-auto px-2.5 py-3 space-y-2"
              style={{
                background: `linear-gradient(180deg, #0a0a0a 0%, #0d0d0f 100%)`,
              }}
            >
              {/* Date Chip */}
              <div className="flex justify-center mb-3 sticky top-0 z-10">
                <span className="bg-black/60 text-white/50 text-[11px] px-2.5 py-1 rounded-full backdrop-blur-md font-medium">
                  Today
                </span>
              </div>

              {messages.slice(0, displayedMessages).map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.type === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[82%] rounded-[18px] px-3 py-2 shadow-sm ${
                      msg.type === "user"
                        ? "bg-[#0b84fe] text-white rounded-br-[4px]"
                        : "bg-[#262628] text-white rounded-bl-[4px]"
                    }`}
                  >
                    <div className="text-[15px] leading-[1.35] whitespace-pre-wrap break-words">
                      {msg.content}
                    </div>
                    <div className={`text-[11px] mt-0.5 ${msg.type === "user" ? "text-white/60" : "text-white/35"} text-right`}>
                      {msg.time}
                    </div>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {displayedMessages < messages.length && (
                <div className="flex justify-start">
                  <div className="bg-[#262628] rounded-[18px] rounded-bl-[4px] px-4 py-3">
                    <div className="flex gap-1.5 items-center h-4">
                      <span className="w-[7px] h-[7px] bg-white/30 rounded-full animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: "0ms" }} />
                      <span className="w-[7px] h-[7px] bg-white/30 rounded-full animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: "150ms" }} />
                      <span className="w-[7px] h-[7px] bg-white/30 rounded-full animate-[bounce_1s_ease-in-out_infinite]" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="bg-[#1c1c1e] px-2 py-2 flex items-end gap-1.5 border-t border-white/[0.08]">
              <button className="text-[#0a84ff] p-1.5 mb-0.5">
                <svg className="w-[26px] h-[26px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
              </button>
              <div className="flex-1 bg-[#2c2c2e] rounded-[20px] px-4 py-2 min-h-[36px] flex items-center border border-white/[0.06]">
                <span className="text-white/30 text-[15px]">Message</span>
              </div>
              <button className="text-white/50 p-1.5 mb-0.5">
                <svg className="w-[26px] h-[26px]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 15c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v7c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 15 6.7 12H5c0 3.41 2.72 6.23 6 6.72V22h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
                </svg>
              </button>
            </div>

            {/* Home Indicator */}
            <div className="bg-[#1c1c1e] pb-2 pt-1 flex justify-center">
              <div className="w-[134px] h-[5px] bg-white/20 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Reflection/shadow at bottom */}
      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-[70%] h-8 bg-gradient-to-t from-transparent via-white/[0.02] to-transparent blur-sm rounded-full" />
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

function ToolIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}


function StepCard({
  step,
  isActive,
  onClick,
  onSkip,
  showChevron = true,
}: {
  step: Step;
  isActive: boolean;
  onClick: () => void;
  onSkip?: () => void;
  showChevron?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? "step" : undefined}
      className={`group w-full rounded-xl border p-3.5 text-left transition-all duration-200 md:p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 ${
        isActive
          ? "border-[#F7931A]/40 bg-[#F7931A]/[0.08]"
          : "border-white/[0.08] bg-white/[0.02] hover:border-[#F7931A]/30 hover:bg-[#F7931A]/[0.04]"
      }`}
    >
      <div className="flex items-center gap-3 md:gap-4">
        <div
          className={`flex size-7 shrink-0 items-center justify-center rounded-lg text-sm font-bold transition-colors md:size-9 ${
            isActive
              ? "bg-[#F7931A] text-black"
              : "bg-white/[0.08] text-white/60 group-hover:bg-[#F7931A]/20 group-hover:text-[#F7931A]"
          }`}
        >
          {step.id}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`text-sm font-medium md:text-[15px] ${isActive ? "text-white" : "text-white/80"}`}>
            {step.title}
          </h3>
          <p className="mt-0.5 text-xs text-white/50 md:text-[13px]">
            <span className="truncate md:whitespace-normal">{step.subtitle}</span>
            {step.skippable && isActive && onSkip && (
              <>
                {" · "}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => { e.stopPropagation(); onSkip(); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSkip(); } }}
                  className="cursor-pointer text-white/40 transition-colors hover:text-[#F7931A]"
                >
                  Skip
                </span>
              </>
            )}
            {/* Links - desktop only */}
            {step.links && step.links.length > 0 && isActive && (
              <span className="hidden md:inline">
                {" · "}
                {step.links.map((link, i) => (
                  <span key={link.url}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-0.5 text-[#F7931A] transition-all hover:underline hover:underline-offset-2"
                    >
                      {link.text}
                      <svg className="size-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" />
                      </svg>
                    </a>
                    {i < step.links!.length - 1 && ", "}
                  </span>
                ))}
              </span>
            )}
          </p>
        </div>
        {showChevron && (
          <svg
            className={`size-4 shrink-0 transition-all md:size-5 ${
              isActive
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
        )}
      </div>
    </button>
  );
}

function StepsSection({
  id,
  title,
  subtitle,
  steps,
  activeStep,
  setActiveStep,
}: {
  id: string;
  title: string;
  subtitle: string;
  steps: Step[];
  activeStep: number;
  setActiveStep: (step: number) => void;
}) {
  const currentStep = steps.find((s) => s.id === activeStep);

  const goToPrev = useCallback(() => {
    setActiveStep(Math.max(1, activeStep - 1));
  }, [activeStep, setActiveStep]);

  const goToNext = useCallback(() => {
    setActiveStep(Math.min(steps.length, activeStep + 1));
  }, [activeStep, setActiveStep, steps.length]);

  const swipeHandlers = useSwipe(goToNext, goToPrev);

  return (
    <section id={id} className="scroll-mt-16 px-12 pb-12 pt-16 max-lg:px-8 max-md:px-5 md:pb-20 md:pt-20">
      <div className="mx-auto max-w-[1200px]">
        {/* Section Header */}
        <div className="mb-8 text-center md:mb-12">
          <h2 className="text-balance text-[clamp(28px,4vw,42px)] font-medium leading-tight text-white">
            {title}
          </h2>
          <p className="mt-3 text-sm text-white/50 md:text-[15px]">
            {subtitle}
          </p>
        </div>

        {/* Desktop: Two-column layout */}
        <div className="hidden lg:grid lg:grid-cols-2 lg:gap-12">
          {/* Steps list */}
          <div className="space-y-3">
            {steps.map((step) => (
              <StepCard
                key={step.id}
                step={step}
                isActive={activeStep === step.id}
                onClick={() => setActiveStep(step.id)}
                onSkip={() => setActiveStep(step.id + 1)}
              />
            ))}
          </div>

          {/* Terminal or Telegram */}
          <div className="sticky top-24 self-start">
            {currentStep?.telegramMessages ? (
              <div className="rounded-xl overflow-hidden border border-[#5b9bd5]/20 h-[320px] md:h-[360px]">
                <TelegramDesktopUI key={activeStep} messages={currentStep.telegramMessages} />
              </div>
            ) : (
              <TerminalWindow
                key={activeStep}
                commands={currentStep?.commands || []}
                isActive={true}
              />
            )}
          </div>
        </div>

        {/* Mobile: Carousel layout */}
        <div
          className="flex flex-col gap-5 lg:hidden"
          {...swipeHandlers}
        >
          {/* Step counter */}
          <div className="mb-2 text-center text-sm text-white/50">
            Step {activeStep} of {steps.length}
          </div>

          {/* Step carousel */}
          <div className="relative">
            {/* Current step card */}
            <div className="relative px-5">
              {/* Navigation arrows */}
              <button
                onClick={goToPrev}
                disabled={activeStep === 1}
                aria-label="Previous step"
                className="absolute -left-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/50 backdrop-blur-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:border-[#F7931A]/40 enabled:hover:text-[#F7931A] enabled:active:scale-95"
              >
                <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={goToNext}
                disabled={activeStep === steps.length}
                aria-label="Next step"
                className="absolute -right-1 top-1/2 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-white/10 bg-black/60 text-white/50 backdrop-blur-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed enabled:hover:border-[#F7931A]/40 enabled:hover:text-[#F7931A] enabled:active:scale-95"
              ><svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
              {currentStep && (
                <StepCard
                  step={currentStep}
                  isActive={true}
                  onClick={() => {}}
                  onSkip={() => setActiveStep(currentStep.id + 1)}
                  showChevron={false}
                />
              )}
            </div>

            {/* Progress dots */}
            <div className="mt-4 flex items-center justify-center gap-1.5">
              {steps.map((step) => (
                <button
                  key={step.id}
                  onClick={() => setActiveStep(step.id)}
                  aria-label={`Go to step ${step.id}`}
                  aria-current={activeStep === step.id ? "step" : undefined}
                  className={`h-1.5 rounded-full transition-all ${
                    activeStep === step.id
                      ? "w-4 bg-[#F7931A]"
                      : "w-1.5 bg-white/20 hover:bg-white/40"
                  }`}
                />
              ))}
            </div>
          </div>

          {/* Terminal or Telegram */}
          {currentStep?.telegramMessages ? (
            <div className="rounded-xl overflow-hidden border border-[#5b9bd5]/20 h-[320px]">
              <TelegramDesktopUI key={activeStep} messages={currentStep.telegramMessages} />
            </div>
          ) : (
            <TerminalWindow
              key={activeStep}
              commands={currentStep?.commands || []}
              isActive={true}
            />
          )}
        </div>
      </div>
    </section>
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
              title={"tooltip" in link ? link.tooltip : undefined}
              className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:border-white/20 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
              aria-label={`${project.name} ${"tooltip" in link ? link.tooltip : link.label}`}
            >
              {link.type === "github" && <GitHubIcon className="size-4" />}
              {link.type === "website" && <GlobeIcon className="size-4" />}
              {link.type === "docs" && <BookIcon className="size-4" />}
              {link.type === "tool" && <ToolIcon className="size-4" />}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeDeployStep, setActiveDeployStep] = useState(1);
  const [activeSetupStep, setActiveSetupStep] = useState(1);
  const [activeEarnStep, setActiveEarnStep] = useState(4);

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

        {/* Mobile: Static color accent (bottom only, top removed to avoid header overlap) */}
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
                  Give your agents a{" "}
                  <span className="relative">
                    <span className="bg-gradient-to-r from-[#F7931A] via-[#FFAA40] to-[#F7931A] bg-clip-text text-transparent">Bitcoin</span>
                    <span className="absolute -inset-x-4 -inset-y-2 -z-10 bg-[radial-gradient(ellipse_at_center,rgba(247,147,26,0.15)_0%,transparent_70%)] blur-2xl max-md:hidden"></span>
                  </span>{" "}
                  wallet.
                </h1>

                {/* Subheadline */}
                <p className="mb-0 max-w-[440px] animate-fadeUp text-balance text-[clamp(15px,4vw,18px)] leading-[1.6] tracking-normal text-white/50 opacity-0 [animation-delay:0.2s] lg:mb-8">
                  One command away from Bitcoin-powered agents.
                </p>

                {/* CTA - Desktop only */}
                <div className="hidden animate-fadeUp opacity-0 [animation-delay:0.35s] lg:block">
                  <a
                    href="#deploy"
                    className="inline-flex items-center justify-center rounded-xl bg-[#F7931A] px-8 py-4 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    Get Started
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
                  href="#deploy"
                  className="inline-flex w-full items-center justify-center rounded-xl bg-[#F7931A] px-8 py-4 text-[15px] font-medium text-white transition-[background-color,transform] duration-200 hover:bg-[#E8850F] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  Get Started
                </a>
              </div>
            </div>
          </div>

          {/* Scroll indicator */}
          <a
            href="#deploy"
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

        {/* Set Up in One Command - Deploy Steps */}
        <StepsSection
          id="deploy"
          title="Set Up in One Command"
          subtitle="Your agent gets its own Bitcoin wallet."
          steps={deploySteps}
          activeStep={activeDeployStep}
          setActiveStep={setActiveDeployStep}
        />

        {/* 1. Zero to Agent - Setup Steps (1-3) */}
        <StepsSection
          id="build"
          title="Go from Zero to Agent"
          subtitle="Open your terminal and follow each step to set up your agent."
          steps={setupSteps}
          activeStep={activeSetupStep}
          setActiveStep={setActiveSetupStep}
        />

        {/* 2. Where Agents Go */}
        <section className="px-12 pb-12 pt-16 max-lg:px-8 max-md:px-5 md:pb-20 md:pt-20">
          <div className="mx-auto max-w-[1200px]">
            {/* Section Header */}
            <div className="mb-8 text-center md:mb-12">
              <h2 className="text-balance text-[clamp(28px,4vw,42px)] font-medium leading-tight text-white">
                Where Agents Go From Here
              </h2>
              <p className="mt-2 text-sm text-white/50 md:text-[15px]">
                Your agent has a wallet. Now connect it to the ecosystem.
              </p>
            </div>

            {/* Destination Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-all duration-200 hover:border-[#F7931A]/30 hover:bg-[#F7931A]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-medium text-white group-hover:text-[#F7931A] transition-colors">
                      ERC-8004
                    </h3>
                    <p className="mt-1 text-sm text-white/50">Cross-chain agent registry standard</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href="https://github.com/5afe/ERCs/blob/eip-8004/ERCS/erc-8004.md"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:border-white/20 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
                      aria-label="ERC-8004 Specification"
                    >
                      <BookIcon className="size-4" />
                    </a>
                  </div>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-all duration-200 hover:border-[#F7931A]/30 hover:bg-[#F7931A]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-medium text-white group-hover:text-[#F7931A] transition-colors">
                      Moltbook
                    </h3>
                    <p className="mt-1 text-sm text-white/50">Bitcoin agent marketplace</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href="https://moltbook.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:border-white/20 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
                      aria-label="Moltbook Website"
                    >
                      <GlobeIcon className="size-4" />
                    </a>
                  </div>
                </div>
              </div>

              <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 transition-all duration-200 hover:border-[#F7931A]/30 hover:bg-[#F7931A]/[0.04]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[15px] font-medium text-white group-hover:text-[#F7931A] transition-colors">
                      Pillar
                    </h3>
                    <p className="mt-1 text-sm text-white/50">Smart wallet with auto-compounding</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <a
                      href="https://pillar.gg"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-white/10 bg-white/5 p-2 text-white/40 transition-colors hover:border-white/20 hover:text-white/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
                      aria-label="Pillar Website"
                    >
                      <GlobeIcon className="size-4" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 3. Earn - Build/Deploy/Earn Steps (4-6) */}
        <StepsSection
          id="earn"
          title="Earn Bitcoin with x402"
          subtitle="Build paid APIs and start earning sats with every request."
          steps={earnSteps}
          activeStep={activeEarnStep}
          setActiveStep={setActiveEarnStep}
        />

        {/* 4. Built on Open Standards */}
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

        {/* 5. Join the Community */}
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
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
            {/* Agent API — visible to agents reading the page */}
            <div>
              <h4 className="mb-4 text-sm font-semibold text-white/70">Agent API</h4>
              <div className="space-y-2.5">
                {[
                  { name: "Register Agent", url: "/api/register", desc: "POST — sign & register" },
                  { name: "Agent Directory", url: "/api/agents", desc: "GET — list agents" },
                  { name: "Verify Agent", url: "/api/verify/{address}", desc: "GET — check registration" },
                  { name: "Health Check", url: "/api/health", desc: "GET — system status" },
                  { name: "OpenAPI Spec", url: "/api/openapi.json", desc: "Machine-readable API" },
                  { name: "Agent Card", url: "/.well-known/agent.json", desc: "A2A discovery" },
                  { name: "LLM Docs", url: "/llms.txt", desc: "llmstxt.org format" },
                ].map((link) => (
                  <a key={link.name} href={link.url} className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-[#F7931A]" title={link.desc}>
                    <BookIcon className="size-3.5 shrink-0" />
                    {link.name}
                  </a>
                ))}
              </div>
            </div>

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
                  { name: "x402 Crosschain Example", url: "https://github.com/aibtcdev/x402-crosschain-example" },
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
                  { name: "AIBTC MCP Server (npm)", url: "https://www.npmjs.com/package/@aibtc/mcp-server", type: "website" },
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
                <span className="block text-sm text-white/50">sBTC (Bitcoin on Stacks)</span>
                <span className="block text-sm text-white/50">STX (Stacks native)</span>
                <span className="block text-sm text-white/50">USDCx (Stablecoin)</span>
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
