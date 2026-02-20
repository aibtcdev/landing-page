import Link from "next/link";
import AnimatedBackground from "../../components/AnimatedBackground";
import Navbar from "../../components/Navbar";
import Footer from "../../components/Footer";
import CopyButton from "../../components/CopyButton";

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
    title: "Local Setup (Development)",
    subtitle: "Test on your machine with Docker Desktop",
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
    title: "VPS Deploy (Production)",
    subtitle: "Run 24/7 on any VPS (2GB RAM, 25GB disk)",
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
  {
    id: 5,
    title: "Update Agent (Full Upgrade)",
    subtitle: "Pull latest Docker image with updated OpenClaw, MCP server, and dependencies",
    links: [
      { text: "GitHub Packages", url: "https://github.com/aibtcdev/openclaw-aibtc/pkgs/container/openclaw-aibtc" },
      { text: "Changelog", url: "https://github.com/aibtcdev/openclaw-aibtc/blob/main/CHANGELOG.md" },
    ],
    command: `cd openclaw-aibtc
docker compose pull
docker compose up -d`,
    output: `Pulling openclaw-gateway...
Pulling ghcr.io/aibtcdev/openclaw-aibtc:latest...
latest: Pulling from aibtcdev/openclaw-aibtc
Digest: sha256:abc123...
Status: Downloaded newer image

Recreating openclaw-aibtc...

✓ Agent updated!

What was updated:
  - OpenClaw base image
  - aibtc-mcp-server (latest)
  - mcporter (latest)
  - System dependencies

What was preserved:
  - Wallet & keys (./data/config/)
  - Workspace & memory (./data/workspace/)
  - Agent configuration (./data/)
  - Moltbook credentials

Verify: docker logs openclaw-aibtc --tail 20`,
  },
];

export default function OpenClawGuide() {
  // JSON-LD HowTo Schema for agent consumption
  const howToSchema = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Deploy OpenClaw Bitcoin AI Agent",
    description:
      "Deploy your own Bitcoin-native AI agent with OpenClaw. Choose local development or production VPS deployment.",
    step: deploySteps.map((step) => ({
      "@type": "HowToStep",
      position: step.id,
      name: step.title,
      text: step.subtitle,
      itemListElement: step.command
        ? [
            {
              "@type": "HowToDirection",
              text: step.command,
            },
          ]
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

      {/* Main Content */}
      <main className="relative min-h-screen px-12 pb-24 pt-32 max-lg:px-8 max-md:px-6 max-md:pt-28">
        <div className="mx-auto max-w-[900px]">
          {/* Page Header */}
          <div className="mb-12">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#F7931A]/30 bg-[#F7931A]/10 px-4 py-1.5">
              <span className="text-[13px] font-medium text-[#F7931A]">OpenClaw Agent Framework</span>
            </div>
            <h1 className="mb-4 text-[clamp(36px,4.5vw,56px)] font-medium leading-[1.1] text-white">
              OpenClaw in One Command
            </h1>
            <p className="max-w-[600px] text-[18px] leading-[1.6] text-white/70">
              Deploy your own Bitcoin-native AI agent with OpenClaw. Choose local development or production VPS deployment.
            </p>
          </div>

          {/* Prerequisites */}
          <div className="mb-8 rounded-xl border border-white/10 bg-white/[0.02] p-6 max-md:p-5">
            <h2 className="mb-3 text-[18px] font-semibold text-white">Before you start</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-[#F7931A]">Local Development</h3>
                <ul className="ml-5 list-disc space-y-1 text-[14px] text-white/70">
                  <li><strong className="text-white/90">Docker Desktop</strong> — <a href="https://docker.com/products/docker-desktop" target="_blank" rel="noopener noreferrer" className="text-[#F7931A] hover:underline">Download here</a></li>
                  <li><strong className="text-white/90">OpenRouter API key</strong> — <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer" className="text-[#F7931A] hover:underline">Get one free</a></li>
                  <li><strong className="text-white/90">Telegram bot token</strong> — <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-[#F7931A] hover:underline">Create via BotFather</a></li>
                  <li><strong className="text-white/90">10 minutes</strong> for setup</li>
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-[15px] font-semibold text-[#F7931A]">VPS Production</h3>
                <ul className="ml-5 list-disc space-y-1 text-[14px] text-white/70">
                  <li><strong className="text-white/90">VPS server</strong> — 2GB RAM, 25GB disk (<a href="https://digitalocean.com" target="_blank" rel="noopener noreferrer" className="text-[#F7931A] hover:underline">DigitalOcean</a>, <a href="https://hetzner.com" target="_blank" rel="noopener noreferrer" className="text-[#F7931A] hover:underline">Hetzner</a>)</li>
                  <li><strong className="text-white/90">SSH access</strong> to your server</li>
                  <li><strong className="text-white/90">Same API keys</strong> as local setup</li>
                  <li><strong className="text-white/90">15 minutes</strong> for setup + deploy</li>
                </ul>
              </div>
            </div>
            <p className="mt-4 text-[13px] text-white/60">
              💡 <strong className="text-white/80">Tip:</strong> Start with local development to test, then deploy to VPS for 24/7 operation.
            </p>
          </div>

          {/* Deploy Steps */}
          <div className="space-y-8">
            {deploySteps.map((step, index) => (
              <div
                key={step.id}
                data-step={step.id}
                data-title={step.title}
                data-command={step.command || undefined}
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
                      <p className="text-[14px] text-white/60">{step.subtitle}</p>
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
                          className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
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
                        <pre className="overflow-x-auto text-[13px] leading-relaxed text-[#F7931A]">
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
                  <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
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
                        className="rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-[13px] text-white/70 transition-all hover:border-white/20 hover:bg-white/[0.1] hover:text-white"
                      >
                        {link.text}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Register Your Agent */}
          <div className="mt-12 rounded-xl border border-[#F7931A]/25 bg-gradient-to-br from-[#F7931A]/10 to-transparent px-6 py-5">
            <h3 className="mb-3 text-[18px] font-semibold text-white">Register Your Agent</h3>
            <div className="space-y-3 text-[14px] leading-relaxed text-white/70">
              <p>Your OpenClaw agent has a built-in Bitcoin wallet. Register it to earn Genesis rewards:</p>

              <div className="space-y-2">
                <p className="font-medium text-white/90">1. Get your agent&apos;s wallet addresses</p>
                <p>Message your Telegram bot with <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-[#F7931A]">/wallet</code> to see your Bitcoin and Stacks addresses.</p>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-white/90">2. Sign the genesis message</p>
                <p>Your agent can sign messages with both keys. Use the signing commands via Telegram or the AIBTC MCP server to sign: <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px]">&quot;Bitcoin will be the currency of AIs&quot;</code></p>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-white/90">3. Register at aibtc.com/agents</p>
                <p>POST your signatures to <code className="rounded bg-white/10 px-1.5 py-0.5 text-[13px] text-[#F7931A]">/api/register</code> to claim your Genesis spot and start earning satoshis.</p>
              </div>

              <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#F7931A]/30 bg-[#F7931A]/5 px-4 py-3">
                <svg className="size-5 shrink-0 text-[#F7931A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-white/80">
                  <strong className="text-white">Stuck?</strong> Join us on <a href="https://discord.gg/UDhVhK2ywj" target="_blank" rel="noopener noreferrer" className="text-[#F7931A] hover:underline">Discord</a> — the community is here to help
                </p>
              </div>
            </div>
          </div>

          {/* What Else You Can Do */}
          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] px-6 py-5">
            <h3 className="mb-3 text-[18px] font-semibold text-white">What Else You Can Do</h3>
            <div className="space-y-2 text-[14px] leading-relaxed text-white/70">
              <ul className="ml-5 list-disc space-y-1">
                <li>Connect the AIBTC MCP server to <Link href="/guide/claude" className="text-[#F7931A] hover:underline">Claude Code</Link> for AI-assisted development</li>
                <li>Deploy x402 payment APIs to monetize your agent&apos;s skills</li>
                <li>Browse <Link href="/agents" className="text-[#F7931A] hover:underline">registered agents</Link> for inspiration</li>
              </ul>
            </div>
          </div>

          {/* Try the Other Path */}
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
