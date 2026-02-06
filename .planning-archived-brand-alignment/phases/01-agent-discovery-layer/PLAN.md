# Phase 1: Agent Discovery Layer

Make aibtc.com discoverable by AI agents through standard machine-readable files.

```xml
<plan>
  <goal>
    Add robots.txt, sitemap.xml, spec-compliant llms.txt, llms-full.txt, and
    .well-known/agent.json so that AI agents (and search engines) can discover
    aibtc.com through standard protocols. All five files must be served at their
    canonical URLs and pass basic validation.
  </goal>

  <context>
    ## Codebase layout

    - Next.js 15 App Router with TypeScript, deployed to Cloudflare Workers via OpenNext
    - Existing routes: `/` (landing), `/agents` (registry page), `/skills` (301 -> /llms.txt)
    - API routes: `POST /api/register`, `GET /api/agents`
    - Static assets live in `public/`; the current `public/llms.txt` is served as a
      static file and does NOT follow the llmstxt.org spec
    - Middleware (`middleware.ts`) intercepts CLI user-agents on specific paths and
      proxies shell scripts from GitHub
    - Tests use vitest with files in `__tests__/` directories adjacent to source
    - The `app/robots.ts` and `app/sitemap.ts` files are Next.js metadata conventions
      that auto-generate `/robots.txt` and `/sitemap.xml`
    - For `.well-known/agent.json`, we use a Next.js route handler at
      `app/.well-known/agent.json/route.ts` (the directory name includes the dot-prefix
      and the `agent.json` segment, and `route.ts` handles GET)
    - The base URL is `https://aibtc.com` (set in layout.tsx metadataBase)

    ## Standards referenced

    - **robots.txt**: Next.js MetadataRoute.Robots convention (app/robots.ts)
    - **sitemap.xml**: Next.js MetadataRoute.Sitemap convention (app/sitemap.ts)
    - **llms.txt**: llmstxt.org spec — H1 title, optional blockquote, markdown body,
      H2-delimited sections with `[title](url): description` link lists
    - **llms-full.txt**: Extended version of llms.txt with full inline documentation
      (not a formal spec, but widely adopted as the "expanded" companion)
    - **.well-known/agent.json**: Google A2A Agent Card format — JSON with name,
      description, url, provider, version, capabilities, skills, authentication,
      defaultInputModes, defaultOutputModes

    ## Deployment note

    Cloudflare Workers via OpenNext serves both static assets (from .open-next/assets)
    and dynamic routes (from the worker). Next.js metadata file conventions
    (robots.ts, sitemap.ts) generate dynamic routes handled by the worker. Route
    handlers under `app/` are also handled by the worker. Static files in `public/`
    are served from the asset binding.
  </context>

  <!-- ================================================================ -->
  <!-- TASK 1: robots.txt, sitemap.xml, and .well-known/agent.json      -->
  <!-- ================================================================ -->
  <task id="1">
    <name>Add robots.txt, sitemap.xml, and .well-known/agent.json</name>
    <files>
      app/robots.ts (new)
      app/sitemap.ts (new)
      app/.well-known/agent.json/route.ts (new)
    </files>
    <action>
      ### 1a. Create `app/robots.ts`

      Create the file `/Users/biwas/repos/contrib/landing-page/app/robots.ts` with
      the following content:

      ```ts
      import type { MetadataRoute } from "next";

      export default function robots(): MetadataRoute.Robots {
        return {
          rules: [
            {
              userAgent: "*",
              allow: "/",
              disallow: ["/api/"],
            },
          ],
          sitemap: "https://aibtc.com/sitemap.xml",
          host: "https://aibtc.com",
        };
      }
      ```

      Key decisions:
      - Allow all crawlers to index the site
      - Disallow `/api/` paths (the registration endpoint should not be crawled)
      - Point to the sitemap at the canonical domain
      - Set host to canonical domain

      ### 1b. Create `app/sitemap.ts`

      Create the file `/Users/biwas/repos/contrib/landing-page/app/sitemap.ts` with
      the following content:

      ```ts
      import type { MetadataRoute } from "next";

      export default function sitemap(): MetadataRoute.Sitemap {
        return [
          {
            url: "https://aibtc.com",
            lastModified: new Date(),
            changeFrequency: "weekly",
            priority: 1,
          },
          {
            url: "https://aibtc.com/agents",
            lastModified: new Date(),
            changeFrequency: "daily",
            priority: 0.8,
          },
          {
            url: "https://aibtc.com/llms.txt",
            lastModified: new Date(),
            changeFrequency: "monthly",
            priority: 0.7,
          },
        ];
      }
      ```

      Key decisions:
      - The landing page is the highest priority
      - `/agents` changes daily (agents register over time)
      - `/llms.txt` is included for agent discovery
      - API routes are not included (they are not browsable pages)

      ### 1c. Create `app/.well-known/agent.json/route.ts`

      Create the directory structure and file at
      `/Users/biwas/repos/contrib/landing-page/app/.well-known/agent.json/route.ts`:

      ```ts
      import { NextResponse } from "next/server";

      /**
       * Agent Card following the A2A (Agent-to-Agent) protocol convention.
       * Served at GET /.well-known/agent.json
       *
       * This describes the AIBTC platform's capabilities so that visiting
       * AI agents can discover what services are available and how to
       * interact with them.
       *
       * Reference: https://google.github.io/A2A/#/documentation?id=agent-card
       */
      export function GET() {
        const agentCard = {
          name: "AIBTC",
          description:
            "AI x Bitcoin platform. Provides MCP tools for AI agents to interact " +
            "with Bitcoin and Stacks blockchains. Agents can register, get wallets, " +
            "and access DeFi operations.",
          url: "https://aibtc.com",
          provider: {
            organization: "AIBTC Working Group",
            url: "https://aibtc.com",
          },
          version: "1.0.0",
          documentationUrl: "https://aibtc.com/llms.txt",
          capabilities: {
            streaming: false,
            pushNotifications: false,
            stateTransitionHistory: false,
          },
          authentication: {
            schemes: [],
            credentials: null,
          },
          defaultInputModes: ["application/json"],
          defaultOutputModes: ["application/json"],
          skills: [
            {
              id: "agent-registration",
              name: "Agent Registration",
              description:
                "Register as a verified agent by signing a message with both " +
                "Bitcoin and Stacks keys. POST to /api/register with " +
                "bitcoinSignature and stacksSignature fields. The message to " +
                'sign is: "Bitcoin will be the currency of AIs"',
              tags: ["registration", "verification", "identity"],
              examples: [
                "Register my agent with Bitcoin and Stacks signatures",
                "Verify my agent identity",
              ],
              inputModes: ["application/json"],
              outputModes: ["application/json"],
            },
            {
              id: "agent-directory",
              name: "Agent Directory",
              description:
                "Browse all registered agents in the AIBTC ecosystem. " +
                "GET /api/agents returns a JSON array of verified agents " +
                "sorted by registration date (newest first).",
              tags: ["directory", "agents", "listing"],
              examples: [
                "List all registered agents",
                "Show me verified agents in the ecosystem",
              ],
              inputModes: ["application/json"],
              outputModes: ["application/json"],
            },
            {
              id: "mcp-tools",
              name: "MCP Bitcoin and Stacks Tools",
              description:
                "Install Bitcoin and Stacks blockchain tools via MCP " +
                "(Model Context Protocol). Run: npx @aibtc/mcp-server. " +
                "Provides wallet management, token transfers, DeFi operations, " +
                "BNS naming, inscriptions, and smart contract interaction.",
              tags: ["mcp", "bitcoin", "stacks", "tools", "blockchain"],
              examples: [
                "Install AIBTC MCP tools",
                "Set up Bitcoin wallet for my agent",
              ],
            },
          ],
        };

        return NextResponse.json(agentCard, {
          headers: {
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
          },
        });
      }
      ```

      Key decisions:
      - No authentication required (all endpoints are public)
      - Skills map to the three main agent interactions: register, browse, install MCP
      - Cache for 1 hour client-side, 1 day edge-side (content changes rarely)
      - The `documentationUrl` points to llms.txt for deeper reading
    </action>
    <verify>
      Run the dev server and test each endpoint:

      ```bash
      # Start dev server (if not already running)
      cd /Users/biwas/repos/contrib/landing-page && npm run dev &amp;
      sleep 5

      # Test robots.txt
      curl -s http://localhost:3000/robots.txt
      # Expected: text output containing "User-Agent: *", "Allow: /", "Disallow: /api/", "Sitemap: https://aibtc.com/sitemap.xml"

      # Test sitemap.xml
      curl -s http://localhost:3000/sitemap.xml
      # Expected: XML with &lt;urlset&gt; containing 3 &lt;url&gt; entries for /, /agents, /llms.txt

      # Test .well-known/agent.json
      curl -s http://localhost:3000/.well-known/agent.json | head -5
      # Expected: JSON with "name": "AIBTC", "description": "AI x Bitcoin platform..."

      # Verify agent.json is valid JSON
      curl -s http://localhost:3000/.well-known/agent.json | npx -y json5 --validate 2>&amp;1 || curl -s http://localhost:3000/.well-known/agent.json | python3 -m json.tool > /dev/null && echo "Valid JSON"
      ```

      Run the linter:
      ```bash
      cd /Users/biwas/repos/contrib/landing-page && npm run lint
      ```

      Run the build to confirm no type errors:
      ```bash
      cd /Users/biwas/repos/contrib/landing-page && npm run build
      ```
    </verify>
    <done>
      - `GET /robots.txt` returns valid robots.txt with Allow /, Disallow /api/, and Sitemap reference
      - `GET /sitemap.xml` returns valid XML sitemap with entries for /, /agents, and /llms.txt
      - `GET /.well-known/agent.json` returns valid JSON Agent Card with name, description, url, provider, skills
      - All three files are generated dynamically by Next.js (not static files in public/)
      - `npm run lint` passes
      - `npm run build` passes
    </done>
  </task>

  <!-- ================================================================ -->
  <!-- TASK 2: Spec-compliant llms.txt and llms-full.txt                -->
  <!-- ================================================================ -->
  <task id="2">
    <name>Rewrite llms.txt to follow llmstxt.org spec and add llms-full.txt</name>
    <files>
      public/llms.txt (rewrite)
      app/llms-full.txt/route.ts (new)
    </files>
    <action>
      ### 2a. Rewrite `public/llms.txt` to follow the llmstxt.org spec

      The current `public/llms.txt` is a large markdown document that does NOT follow
      the llmstxt.org format. The spec requires:
      1. H1 heading with project name
      2. Optional blockquote with summary
      3. Optional body text
      4. H2-delimited sections with `[title](url): description` link lists

      Replace the contents of `/Users/biwas/repos/contrib/landing-page/public/llms.txt`
      with:

      ```markdown
      # AIBTC

      > AIBTC gives AI agents Bitcoin and Stacks blockchain capabilities through
      > MCP (Model Context Protocol) tools. Agents can manage wallets, transfer
      > tokens, interact with DeFi protocols, deploy smart contracts, and register
      > in the AIBTC agent directory.

      The AIBTC platform provides two integration paths:
      - **OpenClaw agent**: Full autonomous agent with Telegram interface (`curl https://aibtc.com | sh`)
      - **MCP server**: Standalone tools for any MCP-compatible agent (`npx @aibtc/mcp-server`)

      ## API

      - [Agent Registration](https://aibtc.com/api/register): POST with bitcoinSignature and stacksSignature to register. Message to sign: "Bitcoin will be the currency of AIs"
      - [Agent Directory](https://aibtc.com/api/agents): GET to list all verified agents sorted by registration date

      ## Documentation

      - [Full Documentation](https://aibtc.com/llms-full.txt): Complete reference with MCP tool details, examples, and configuration
      - [Agent Card](https://aibtc.com/.well-known/agent.json): Machine-readable agent capabilities (A2A protocol)
      - [GitHub Repository](https://github.com/aibtcdev/aibtc-mcp-server): MCP server source code

      ## Setup

      - [MCP Configuration](https://aibtc.com/llms-full.txt): Add to your MCP settings: {"mcpServers":{"aibtc":{"command":"npx","args":["@aibtc/mcp-server"],"env":{"NETWORK":"mainnet"}}}}
      - [Claude Code Integration](https://github.com/aibtcdev/aibtc-mcp-server): Run npx @aibtc/mcp-server --install for automatic setup

      ## Optional

      - [Agent Registry Page](https://aibtc.com/agents): Human-readable agent directory with display names and BTC addresses
      - [npm Package](https://www.npmjs.com/package/@aibtc/mcp-server): Published npm package for the MCP server
      - [Twitter](https://x.com/aibtcdev): Community updates and announcements
      ```

      Key decisions:
      - H1 is just "AIBTC" (project name per spec)
      - Blockquote provides a concise summary
      - Body text gives the two integration paths
      - H2 sections organize links by purpose: API, Documentation, Setup
      - "Optional" section contains non-essential resources (per spec convention)
      - Every list item follows the `[title](url): description` format

      ### 2b. Create `app/llms-full.txt/route.ts` for the expanded documentation

      Create the directory and file at
      `/Users/biwas/repos/contrib/landing-page/app/llms-full.txt/route.ts`:

      ```ts
      import { NextResponse } from "next/server";

      /**
       * Serves /llms-full.txt — the expanded companion to /llms.txt.
       *
       * While llms.txt is a concise index with links, llms-full.txt inlines all
       * the documentation so an LLM can consume it in a single context window
       * without following links.
       *
       * This is a dynamic route handler (not a static file) so we can update
       * the content programmatically in the future.
       */
      export async function GET() {
        const content = `# AIBTC — Full Documentation

> AIBTC gives AI agents Bitcoin and Stacks blockchain capabilities through
> MCP (Model Context Protocol) tools. Agents can manage wallets, transfer
> tokens, interact with DeFi protocols, deploy smart contracts, and register
> in the AIBTC agent directory.

## Quick Start

### Option A: One-Click Agent (OpenClaw)

Full autonomous agent with Telegram interface, memory, heartbeat, and social capabilities.

\`\`\`bash
curl https://aibtc.com | sh
\`\`\`

Includes:
- Bitcoin/Stacks wallet with password protection
- Telegram bot interface
- Moltbook social network integration
- Automatic Docker setup

### Option B: Standalone MCP (Bring Your Own Agent)

Add Bitcoin/Stacks tools to any MCP-compatible agent framework.

\`\`\`bash
npx @aibtc/mcp-server
\`\`\`

Configure your agent's MCP settings:

\`\`\`json
{
  "mcpServers": {
    "aibtc": {
      "command": "npx",
      "args": ["@aibtc/mcp-server"],
      "env": {
        "NETWORK": "mainnet"
      }
    }
  }
}
\`\`\`

Requires Node.js 18+ and npm.

For Claude Code users, run \`npx @aibtc/mcp-server --install\` to automatically set up MCP integration.

## Agent Registration API

### POST /api/register

Register as a verified AIBTC agent by proving ownership of both a Bitcoin and Stacks address.

**Message to sign:** "Bitcoin will be the currency of AIs"

**Request body (JSON):**
- \`bitcoinSignature\` (string, required): BIP-137 signed message (base64 or hex)
- \`stacksSignature\` (string, required): Stacks RSV signature (hex, 0x-prefixed)
- \`description\` (string, optional): Agent description, max 280 characters

**Success response (200):**
\`\`\`json
{
  "success": true,
  "agent": {
    "stxAddress": "SP...",
    "btcAddress": "bc1...",
    "displayName": "Swift Raven",
    "description": "My agent description",
    "bnsName": "myname.btc",
    "verifiedAt": "2025-01-01T00:00:00.000Z"
  }
}
\`\`\`

**Error responses:**
- 400: Missing or invalid signatures
- 409: Address already registered
- 500: Server error

### GET /api/agents

List all verified agents, sorted by registration date (newest first).

**Response (200):**
\`\`\`json
{
  "agents": [
    {
      "stxAddress": "SP...",
      "btcAddress": "bc1...",
      "stxPublicKey": "02...",
      "btcPublicKey": "02...",
      "displayName": "Swift Raven",
      "description": "Agent description or null",
      "bnsName": "name.btc or null",
      "verifiedAt": "2025-01-01T00:00:00.000Z"
    }
  ]
}
\`\`\`

## Available MCP Capabilities

### Wallet Management
- Create, unlock, lock, import, export wallets
- Password-protected with configurable auto-lock timeout
- Supports multiple wallets with switch capability

### Addresses
- Native SegWit (bc1...): BTC receives, inscriptions
- Stacks (SP...): STX, sBTC, tokens, NFTs, contracts
- Taproot (bc1p...): Ordinals, inscriptions

### Balance and Holdings
- Check BTC, STX, sBTC balances
- List SIP-010 token holdings
- List SIP-009 NFT holdings
- Get token and NFT metadata

### Transfers
- Send BTC, STX, sBTC
- Transfer SIP-010 tokens
- Transfer SIP-009 NFTs
- Fee estimation: fast (~10 min), medium (~30 min), slow (~1 hour)

### DeFi Operations (Stacks)
- ALEX DEX: Get swap quotes, execute swaps, view pool info
- Zest Protocol: Supply, withdraw, borrow, repay, claim rewards

### BNS (Bitcoin Naming Service)
- Look up names, check availability, get pricing
- Preorder and register .btc names

### Bitcoin Inscriptions (Ordinals)
- Estimate inscription fees
- Create commit and reveal transactions
- Look up existing inscriptions

### Smart Contracts
- Deploy Clarity smart contracts
- Call public contract functions
- Read-only contract function calls
- Get contract info and events

### Message Signing
- SIP-018 structured data signing and verification
- Stacks message signing and verification
- Bitcoin message signing and verification (BIP-137)

### x402 Paid APIs
- List available x402 endpoints
- Execute paid API calls

### Pillar Smart Wallet
- Connect, fund, supply, boost, unwind
- DCA (Dollar Cost Averaging) operations
- Multi-admin support

## Transaction Flow

1. **Quote/Estimate** — Check costs before committing
2. **Confirm with user** — Show amounts, fees, recipients
3. **Execute** — Sign and broadcast
4. **Verify** — Check status with txid

## Wallet Lifecycle

\`\`\`
Create -> Unlock -> [Operations] -> Lock
           ^___________________|
\`\`\`

Wallet must be unlocked for any signing operation.

## Configuration

### Fee Estimation
- Preset: \`fast\` (~10 min), \`medium\` (~30 min), \`slow\` (~1 hour)
- Explicit: number in sat/vB (BTC) or micro-STX (Stacks)
- Default is \`medium\` if not specified

### Networks
- **Mainnet**: Real Bitcoin and Stacks, real fees, ALEX DEX and Zest available
- **Testnet**: Test tokens from faucets, lower fees, limited DeFi

## Security Best Practices

1. **Wallet Password** — Human holds password, agent requests it per transaction
2. **Mnemonic Backup** — Generated on wallet creation, must be saved securely
3. **Auto-lock** — Wallet locks automatically after timeout (configurable)
4. **Cardinal vs Ordinal UTXOs** — Regular transfers use cardinal UTXOs only (safe)
5. **Confirmation** — Always show transaction details before execution
6. **Network Check** — Verify mainnet vs testnet before value transfers

## Resources

- GitHub: https://github.com/aibtcdev/aibtc-mcp-server
- npm: @aibtc/mcp-server
- X: @aibtcdev
`;

        return new NextResponse(content, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
          },
        });
      }
      ```

      Key decisions:
      - Served as `text/plain` (like llms.txt) for easy consumption by LLMs
      - Contains ALL the documentation that was previously in the old llms.txt,
        plus the full API documentation for /api/register and /api/agents
      - Uses a route handler (not a static file) so it can be updated programmatically
        later (e.g., auto-generate from OpenAPI spec in Phase 2)
      - The content is a template literal for easy inline editing
      - Cache headers match the agent.json approach (1h client, 1d edge)
    </action>
    <verify>
      Test the new llms.txt and llms-full.txt:

      ```bash
      # Test llms.txt (static file from public/)
      curl -s http://localhost:3000/llms.txt | head -20
      # Expected: starts with "# AIBTC" then blockquote, then H2 sections

      # Verify llms.txt follows spec structure: H1, blockquote, H2 sections
      curl -s http://localhost:3000/llms.txt | grep -c "^# "
      # Expected: 1 (single H1)

      curl -s http://localhost:3000/llms.txt | grep -c "^## "
      # Expected: 4 (API, Documentation, Setup, Optional)

      curl -s http://localhost:3000/llms.txt | grep -c "^>"
      # Expected: 3 (blockquote lines)

      # Test llms-full.txt
      curl -s http://localhost:3000/llms-full.txt | head -10
      # Expected: starts with "# AIBTC -- Full Documentation"

      # Verify llms-full.txt has substantial content
      curl -s http://localhost:3000/llms-full.txt | wc -l
      # Expected: > 150 lines

      # Verify /skills still redirects to /llms.txt (existing behavior preserved)
      curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/skills
      # Expected: 301

      # Verify Content-Type for llms-full.txt
      curl -sI http://localhost:3000/llms-full.txt | grep -i content-type
      # Expected: text/plain; charset=utf-8
      ```

      Run lint and build:
      ```bash
      cd /Users/biwas/repos/contrib/landing-page && npm run lint
      cd /Users/biwas/repos/contrib/landing-page && npm run build
      ```
    </verify>
    <done>
      - `GET /llms.txt` returns a spec-compliant llmstxt.org file with H1 title,
        blockquote summary, and H2 sections containing `[title](url): description` links
      - `GET /llms-full.txt` returns the full expanded documentation as text/plain,
        containing all MCP tool details, API docs, examples, and configuration
      - `GET /skills` still 301-redirects to `/llms.txt` (backward compatible)
      - `npm run lint` passes
      - `npm run build` passes
    </done>
  </task>

  <!-- ================================================================ -->
  <!-- TASK 3: Cross-linking and integration tests                      -->
  <!-- ================================================================ -->
  <task id="3">
    <name>Add integration tests for all discovery endpoints</name>
    <files>
      app/.well-known/agent.json/__tests__/route.test.ts (new)
      app/llms-full.txt/__tests__/route.test.ts (new)
    </files>
    <action>
      ### 3a. Create agent.json tests

      Create `/Users/biwas/repos/contrib/landing-page/app/.well-known/agent.json/__tests__/route.test.ts`:

      ```ts
      import { describe, it, expect } from "vitest";
      import { GET } from "../route";

      describe("GET /.well-known/agent.json", () => {
        it("returns valid JSON with correct content-type", async () => {
          const response = await GET();
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toContain("application/json");
        });

        it("contains required Agent Card fields", async () => {
          const response = await GET();
          const data = await response.json();

          expect(data.name).toBe("AIBTC");
          expect(data.description).toBeTruthy();
          expect(data.url).toBe("https://aibtc.com");
          expect(data.version).toBeTruthy();
        });

        it("contains provider information", async () => {
          const response = await GET();
          const data = await response.json();

          expect(data.provider).toBeDefined();
          expect(data.provider.organization).toBeTruthy();
          expect(data.provider.url).toBeTruthy();
        });

        it("contains capabilities object", async () => {
          const response = await GET();
          const data = await response.json();

          expect(data.capabilities).toBeDefined();
          expect(typeof data.capabilities.streaming).toBe("boolean");
          expect(typeof data.capabilities.pushNotifications).toBe("boolean");
          expect(typeof data.capabilities.stateTransitionHistory).toBe("boolean");
        });

        it("contains at least one skill", async () => {
          const response = await GET();
          const data = await response.json();

          expect(Array.isArray(data.skills)).toBe(true);
          expect(data.skills.length).toBeGreaterThan(0);
        });

        it("each skill has required fields", async () => {
          const response = await GET();
          const data = await response.json();

          for (const skill of data.skills) {
            expect(skill.id).toBeTruthy();
            expect(skill.name).toBeTruthy();
            expect(skill.description).toBeTruthy();
            expect(Array.isArray(skill.tags)).toBe(true);
          }
        });

        it("includes agent-registration skill with sign message details", async () => {
          const response = await GET();
          const data = await response.json();

          const regSkill = data.skills.find(
            (s: { id: string }) => s.id === "agent-registration"
          );
          expect(regSkill).toBeDefined();
          expect(regSkill.description).toContain("/api/register");
          expect(regSkill.description).toContain(
            "Bitcoin will be the currency of AIs"
          );
        });

        it("includes agent-directory skill", async () => {
          const response = await GET();
          const data = await response.json();

          const dirSkill = data.skills.find(
            (s: { id: string }) => s.id === "agent-directory"
          );
          expect(dirSkill).toBeDefined();
          expect(dirSkill.description).toContain("/api/agents");
        });

        it("includes mcp-tools skill with install command", async () => {
          const response = await GET();
          const data = await response.json();

          const mcpSkill = data.skills.find(
            (s: { id: string }) => s.id === "mcp-tools"
          );
          expect(mcpSkill).toBeDefined();
          expect(mcpSkill.description).toContain("npx @aibtc/mcp-server");
        });

        it("sets cache headers", async () => {
          const response = await GET();
          const cacheControl = response.headers.get("cache-control");

          expect(cacheControl).toContain("public");
          expect(cacheControl).toContain("max-age=");
        });

        it("points documentationUrl to llms.txt", async () => {
          const response = await GET();
          const data = await response.json();

          expect(data.documentationUrl).toBe("https://aibtc.com/llms.txt");
        });
      });
      ```

      ### 3b. Create llms-full.txt tests

      Create `/Users/biwas/repos/contrib/landing-page/app/llms-full.txt/__tests__/route.test.ts`:

      ```ts
      import { describe, it, expect } from "vitest";
      import { GET } from "../route";

      describe("GET /llms-full.txt", () => {
        it("returns 200 with text/plain content-type", async () => {
          const response = await GET();
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toContain("text/plain");
        });

        it("starts with H1 title following llmstxt.org convention", async () => {
          const response = await GET();
          const text = await response.text();

          expect(text.startsWith("# AIBTC")).toBe(true);
        });

        it("contains blockquote summary", async () => {
          const response = await GET();
          const text = await response.text();
          const lines = text.split("\n");

          const hasBlockquote = lines.some((line: string) => line.startsWith("> "));
          expect(hasBlockquote).toBe(true);
        });

        it("documents the registration API", async () => {
          const response = await GET();
          const text = await response.text();

          expect(text).toContain("POST /api/register");
          expect(text).toContain("bitcoinSignature");
          expect(text).toContain("stacksSignature");
          expect(text).toContain("Bitcoin will be the currency of AIs");
        });

        it("documents the agents API", async () => {
          const response = await GET();
          const text = await response.text();

          expect(text).toContain("GET /api/agents");
        });

        it("documents MCP setup instructions", async () => {
          const response = await GET();
          const text = await response.text();

          expect(text).toContain("npx @aibtc/mcp-server");
          expect(text).toContain("mcpServers");
        });

        it("documents available capabilities", async () => {
          const response = await GET();
          const text = await response.text();

          expect(text).toContain("Wallet Management");
          expect(text).toContain("DeFi Operations");
          expect(text).toContain("Smart Contracts");
          expect(text).toContain("Bitcoin Inscriptions");
        });

        it("sets cache headers", async () => {
          const response = await GET();
          const cacheControl = response.headers.get("cache-control");

          expect(cacheControl).toContain("public");
          expect(cacheControl).toContain("max-age=");
        });

        it("has substantial content (over 100 lines)", async () => {
          const response = await GET();
          const text = await response.text();
          const lineCount = text.split("\n").length;

          expect(lineCount).toBeGreaterThan(100);
        });
      });
      ```

      ### 3c. Run the full test suite

      After creating both test files, run:
      ```bash
      cd /Users/biwas/repos/contrib/landing-page && npm test
      ```

      This will run ALL tests including the existing agents and register tests,
      plus the new agent.json and llms-full.txt tests.
    </action>
    <verify>
      ```bash
      # Run all tests
      cd /Users/biwas/repos/contrib/landing-page && npm test

      # Expected: All tests pass, including:
      # - GET /.well-known/agent.json (10 tests)
      # - GET /llms-full.txt (9 tests)
      # - Existing GET /api/agents tests (still passing)

      # Run lint one final time
      cd /Users/biwas/repos/contrib/landing-page && npm run lint

      # Run build one final time
      cd /Users/biwas/repos/contrib/landing-page && npm run build
      ```
    </verify>
    <done>
      - All new tests pass for /.well-known/agent.json (Agent Card structure, skills, caching)
      - All new tests pass for /llms-full.txt (content structure, API docs, MCP setup)
      - All existing tests still pass (no regressions)
      - `npm run lint` passes
      - `npm run build` passes
      - Phase 1 is complete: all five discovery files are served at their canonical URLs
        (robots.txt, sitemap.xml, llms.txt, llms-full.txt, .well-known/agent.json)
    </done>
  </task>
</plan>
```

## Summary of Changes

| File | Type | URL Served |
|------|------|------------|
| `app/robots.ts` | New (Next.js metadata convention) | `/robots.txt` |
| `app/sitemap.ts` | New (Next.js metadata convention) | `/sitemap.xml` |
| `app/.well-known/agent.json/route.ts` | New (route handler) | `/.well-known/agent.json` |
| `public/llms.txt` | Rewrite | `/llms.txt` |
| `app/llms-full.txt/route.ts` | New (route handler) | `/llms-full.txt` |
| `app/.well-known/agent.json/__tests__/route.test.ts` | New (test) | N/A |
| `app/llms-full.txt/__tests__/route.test.ts` | New (test) | N/A |

## Context Budget Estimate

- Plan: ~5% of context
- Source files to read: ~15% (existing routes, middleware, layout, tests — already explored)
- New files to write: ~20%
- Execution headroom: ~60%

Well within the 200k context budget for a fresh executor.
