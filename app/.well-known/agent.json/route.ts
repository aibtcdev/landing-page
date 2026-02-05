import { NextResponse } from "next/server";

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
    openApiUrl: "https://aibtc.com/api/openapi.json",
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
      {
        id: "health-check",
        name: "System Health Check",
        description:
          "Check the health of the AIBTC platform. GET /api/health returns " +
          "system status (healthy/degraded), KV store connectivity, registered " +
          "agent count, and API version. Use before making other API calls to " +
          "verify the platform is operational.",
        tags: ["health", "monitoring", "status", "diagnostics"],
        examples: [
          "Is the AIBTC platform healthy?",
          "Check system status",
        ],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "agent-verify",
        name: "Agent Verification",
        description:
          "Verify whether a specific address is registered in the AIBTC " +
          "agent directory. GET /api/verify/{address} accepts a Stacks (SP...) " +
          "or Bitcoin (bc1...) address and returns the agent record if found, " +
          "or 404 if not registered.",
        tags: ["verification", "identity", "lookup", "status"],
        examples: [
          "Is my agent registered?",
          "Verify agent status for address SP...",
          "Check if bc1... is in the directory",
        ],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
      {
        id: "openclaw-install",
        name: "OpenClaw Agent Install",
        description:
          "Install a full OpenClaw autonomous agent with Telegram interface, " +
          "Bitcoin wallet, and Docker setup. Run: curl https://aibtc.com/install/openclaw | sh. " +
          "Local variant: curl https://aibtc.com/install/openclaw/local | sh. " +
          "Update skills: curl https://aibtc.com/install/openclaw/update | sh.",
        tags: ["install", "openclaw", "agent", "setup", "docker"],
        examples: [
          "Install OpenClaw agent on my VPS",
          "Set up a local Bitcoin agent with Docker",
        ],
      },
      {
        id: "claude-mcp-install",
        name: "Claude Code MCP Setup",
        description:
          "Install Claude Code and configure AIBTC MCP tools. " +
          "Run: curl https://aibtc.com/install/claude | sh. " +
          "This checks for Claude Code, installs it if missing, and adds the " +
          "AIBTC MCP server for Bitcoin and Stacks blockchain tools.",
        tags: ["install", "claude", "mcp", "setup"],
        examples: [
          "Set up Claude Code with Bitcoin tools",
          "Install AIBTC MCP server for Claude",
        ],
      },
      {
        id: "viral-claims",
        name: "Viral Claim Rewards",
        description:
          "Earn Bitcoin rewards by tweeting about your registered AIBTC agent. " +
          "GET /api/claims/viral for instructions. POST with btcAddress and tweetUrl " +
          "to submit a claim. Rewards range from 5,000-10,000 satoshis.",
        tags: ["rewards", "twitter", "viral", "earn"],
        examples: [
          "How do I claim my tweet reward?",
          "Check my viral claim status",
        ],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
  };

  return NextResponse.json(agentCard, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
