"use client";

import Link from "next/link";
import AnimatedBackground from "../../components/AnimatedBackground";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import CopyButton from "../../components/CopyButton";

interface McpStep {
  id: number;
  title: string;
  subtitle: string;
  links: { text: string; url: string }[];
  command?: string;
  output?: string;
  configFile?: string;
  configContent?: string;
  configNote?: string;
  description?: string;
}

const mcpServerConfig = JSON.stringify(
  {
    mcpServers: {
      aibtc: {
        command: "npx",
        args: ["@aibtc/mcp-server"],
        env: { NETWORK: "mainnet" },
      },
    },
  },
  null,
  2
);

const mcporterConfig = JSON.stringify(
  {
    mcpServers: {
      aibtc: {
        command: "npx",
        args: ["@aibtc/mcp-server"],
        lifecycle: "keep-alive",
      },
    },
  },
  null,
  2
);

const vscodeConfig = JSON.stringify(
  {
    servers: {
      aibtc: {
        type: "stdio",
        command: "npx",
        args: ["@aibtc/mcp-server"],
        env: { NETWORK: "mainnet" },
      },
    },
  },
  null,
  2
);

const mcpSteps: McpStep[] = [
  {
    id: 1,
    title: "Claude Code",
    subtitle: "Add via CLI in one command",
    links: [{ text: "Claude Code", url: "https://claude.ai/code" }],
    command: "claude mcp add aibtc --scope user -- npx @aibtc/mcp-server",
    output: `Added aibtc MCP server.
Restart Claude Code to activate.`,
  },
  {
    id: 2,
    title: "Claude Desktop",
    subtitle: "Add to your desktop app config",
    links: [{ text: "Download", url: "https://claude.ai/download" }],
    configFile: "claude_desktop_config.json",
    configContent: mcpServerConfig,
    configNote:
      "macOS: ~/Library/Application Support/Claude/ · Windows: %APPDATA%\\Claude\\ · Linux: ~/.config/Claude/",
  },
  {
    id: 3,
    title: "Cursor",
    subtitle: "Add to project or global config",
    links: [{ text: "Cursor", url: "https://cursor.com" }],
    configFile: ".cursor/mcp.json",
    configContent: mcpServerConfig,
  },
  {
    id: 4,
    title: "VS Code",
    subtitle: "Add to Copilot agent mode",
    links: [{ text: "VS Code", url: "https://code.visualstudio.com" }],
    configFile: ".vscode/mcp.json",
    configContent: vscodeConfig,
  },
  {
    id: 5,
    title: "OpenClaw",
    subtitle: "Install via script or add manually",
    links: [
      { text: "Install Script", url: "/guide/openclaw" },
      { text: "GitHub", url: "https://github.com/aibtcdev/openclaw-aibtc" },
    ],
    command: "curl -sSL aibtc.com/install/openclaw | sh",
    output: `The install script configures mcporter with the AIBTC MCP server automatically.
Already running OpenClaw? Add manually to mcporter.json instead.`,
    configFile: "mcporter.json",
    configContent: mcporterConfig,
    configNote:
      "Using npx ensures you get the latest version on every container restart. The keep-alive lifecycle maintains wallet state across operations.",
  },
];

export default function McpGuide() {
  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Connect AIBTC Bitcoin Tools via MCP",
    description:
      "Add the AIBTC MCP server to any compatible client for native Bitcoin and Stacks capabilities.",
    step: mcpSteps.map((step) => ({
      "@type": "HowToStep",
      position: step.id,
      name: step.title,
      text: step.subtitle,
      itemListElement: step.command
        ? [{ "@type": "HowToDirection", text: step.command }]
        : step.configContent
          ? [{ "@type": "HowToDirection", text: `Add to ${step.configFile}: ${step.configContent}` }]
          : [],
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToSchema) }}
      />
      <AnimatedBackground />
      <Navbar />

      <main className="relative min-h-screen px-12 pb-24 pt-32 max-lg:px-8 max-md:px-6 max-md:pt-28">
        <div className="mx-auto max-w-[900px]">
          {/* Page Header */}
          <div className="mb-12 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#F7931A]/30 bg-[#F7931A]/10 px-4 py-1.5">
              <span className="text-[13px] font-medium text-[#F7931A]">MCP Integration</span>
            </div>
            <h1 className="mb-4 text-[clamp(36px,4.5vw,56px)] font-medium leading-[1.1] text-white">
              Connect Anywhere
            </h1>
            <p className="mx-auto max-w-[600px] text-[18px] leading-[1.6] text-white/70">
              The AIBTC MCP server gives any compatible client native Bitcoin and Stacks capabilities. Same tools, same wallet, any client.
            </p>
          </div>

          {/* Prerequisites */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-6 max-md:p-5">
            <h2 className="mb-3 text-[18px] font-semibold text-white">Before you start</h2>
            <div className="space-y-2 text-[14px] leading-relaxed text-white/70">
              <p>You'll need:</p>
              <ul className="ml-5 list-disc space-y-1">
                <li>
                  <strong className="text-white/90">Node.js</strong> — v18 or higher (for{" "}
                  <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-[#F7931A]">npx</code>)
                </li>
                <li>
                  <strong className="text-white/90">An MCP-compatible client</strong> — Pick one below
                </li>
              </ul>
              <p className="mt-3">
                The npm package:{" "}
                <a
                  href="https://www.npmjs.com/package/@aibtc/mcp-server"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[#F7931A] hover:underline"
                >
                  @aibtc/mcp-server
                </a>
              </p>
            </div>
          </div>

          {/* Client Steps */}
          <div className="space-y-8">
            {mcpSteps.map((step) => (
              <div
                key={step.id}
                data-step={step.id}
                data-title={step.title}
                className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-gradient-to-br from-[rgba(26,26,26,0.6)] to-[rgba(15,15,15,0.4)] p-6 backdrop-blur-[12px] transition-all duration-200 hover:border-white/[0.15] max-md:p-5"
              >
                {/* Step Header */}
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#F7931A]/30 bg-gradient-to-br from-[#F7931A]/20 to-[#F7931A]/5 text-[18px] font-semibold text-[#F7931A]">
                      {step.id}
                    </div>
                    <div>
                      <h2 className="mb-1 text-[20px] font-semibold text-white">{step.title}</h2>
                      <p className="text-[14px] text-white/60">{step.subtitle}</p>
                    </div>
                  </div>
                  {step.links.length > 0 && (
                    <div className="flex gap-2 max-md:hidden">
                      {step.links.map((link) =>
                        link.url.startsWith("/") ? (
                          <Link
                            key={link.text}
                            href={link.url}
                            className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                          >
                            {link.text}
                          </Link>
                        ) : (
                          <a
                            key={link.text}
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                          >
                            {link.text}
                          </a>
                        )
                      )}
                    </div>
                  )}
                </div>

                {/* Terminal Command (Claude Code) */}
                {step.command && (
                  <div className="space-y-3">
                    <div className="relative">
                      <div className="flex items-center justify-between rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
                        <span className="text-[12px] font-medium text-white/40">Command</span>
                        <CopyButton
                          text={step.command}
                          label="Copy"
                          variant="icon"
                          className="gap-1.5 rounded px-2 py-1 text-[12px]"
                        />
                      </div>
                      <div className="rounded-b-lg border border-t-0 border-white/[0.08] bg-black/40 px-4 py-3">
                        <pre className="overflow-x-auto text-[13px] leading-relaxed text-[#F7931A]">
                          <code>{step.command}</code>
                        </pre>
                      </div>
                    </div>

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

                {/* Config File (Claude Desktop, Cursor, VS Code) */}
                {step.configFile && step.configContent && (
                  <div className="space-y-3">
                    <div className="relative">
                      <div className="flex items-center justify-between rounded-t-lg border border-white/[0.08] bg-[rgba(15,15,15,0.8)] px-4 py-2">
                        <span className="text-[12px] font-medium text-white/40">{step.configFile}</span>
                        <CopyButton
                          text={step.configContent}
                          label="Copy"
                          variant="icon"
                          className="gap-1.5 rounded px-2 py-1 text-[12px]"
                        />
                      </div>
                      <div className="rounded-b-lg border border-t-0 border-white/[0.08] bg-black/40 px-4 py-3">
                        <pre className="overflow-x-auto text-[13px] leading-relaxed text-[#F7931A]">
                          <code>{step.configContent}</code>
                        </pre>
                      </div>
                    </div>

                    {step.configNote && (
                      <p className="text-[12px] leading-relaxed text-white/40">{step.configNote}</p>
                    )}
                  </div>
                )}

                {/* Description Only (OpenClaw) */}
                {step.description && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-[14px] leading-relaxed text-white/70">{step.description}</p>
                  </div>
                )}

                {/* Mobile Links */}
                {step.links.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2 md:hidden">
                    {step.links.map((link) =>
                      link.url.startsWith("/") ? (
                        <Link
                          key={link.text}
                          href={link.url}
                          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                        >
                          {link.text}
                        </Link>
                      ) : (
                        <a
                          key={link.text}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                        >
                          {link.text}
                        </a>
                      )
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* What's Included */}
          <div className="mt-12 rounded-xl border border-[#F7931A]/25 bg-gradient-to-br from-[#F7931A]/10 to-transparent px-6 py-5">
            <h3 className="mb-3 text-[18px] font-semibold text-white">What You Get</h3>
            <div className="space-y-2 text-[14px] leading-relaxed text-white/70">
              <p>Every client gets the same capabilities through the AIBTC MCP server:</p>
              <ul className="ml-5 list-disc space-y-1">
                <li><strong className="text-white/90">Bitcoin wallet</strong> — Create, manage, and sign with BTC + Stacks keys</li>
                <li><strong className="text-white/90">Token operations</strong> — Check balances, transfer STX, SIP-010 tokens, and NFTs</li>
                <li><strong className="text-white/90">Smart contracts</strong> — Deploy, call, and read Clarity contracts on Stacks</li>
                <li><strong className="text-white/90">DeFi access</strong> — Swap on ALEX, lend/borrow on Zest, stake STX</li>
                <li><strong className="text-white/90">x402 payments</strong> — Build and consume pay-per-request APIs</li>
              </ul>
            </div>
          </div>

          {/* What Else You Can Do */}
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] px-6 py-5">
            <h3 className="mb-3 text-[18px] font-semibold text-white">What Else You Can Do</h3>
            <div className="space-y-2 text-[14px] leading-relaxed text-white/70">
              <ul className="ml-5 list-disc space-y-1">
                <li>Follow the <Link href="/guide/claude" className="text-[#F7931A] hover:underline">Claude Code guide</Link> for a full zero-to-agent walkthrough</li>
                <li>Deploy an autonomous <Link href="/guide/openclaw" className="text-[#F7931A] hover:underline">OpenClaw agent</Link> with Telegram and 24/7 operation</li>
                <li>Browse <Link href="/agents" className="text-[#F7931A] hover:underline">registered agents</Link> to see what others are building</li>
              </ul>
            </div>
          </div>

          {/* Back to Guide Index */}
          <div className="mt-6 text-center">
            <Link
              href="/guide"
              className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-5 py-2.5 text-[14px] font-medium text-white transition-all duration-200 hover:border-white/25 hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#F7931A]/50"
            >
              <svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Back to guide index
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}
