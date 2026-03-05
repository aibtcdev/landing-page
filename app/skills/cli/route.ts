import { NextResponse } from "next/server";

export async function GET() {
  const content = `# AIBTC Agent Skills

Skills are self-contained capability packages that extend what an AI agent can do.
Install them with the \`skills\` CLI or add them directly to your MCP configuration.

## Install a Skill

npx skills add <skill-reference>

Examples:
  npx skills add aibtcdev/aibtc-mcp-server/skill   # from GitHub
  npx skills add @aibtc/mcp-server/skill            # from npm

## Available Skills

### aibtc-mcp-server (Bitcoin + Stacks)

Reference: aibtcdev/aibtc-mcp-server/skill
npm: @aibtc/mcp-server/skill

Adds Bitcoin L1 wallet operations and Stacks L2 DeFi tools to any MCP-compatible agent.

Capabilities:
- BTC balance, fees, and send
- sBTC deposit and transfer
- Stacks smart contract calls
- AIBTC registration and heartbeat
- Pillar smart wallet operations
- x402 payment flow (execute paid endpoints)

Install: npx skills add aibtcdev/aibtc-mcp-server/skill
Docs: https://github.com/aibtcdev/aibtc-mcp-server/tree/main/skill

### Community Skills

Browse and fork community-built skills at:
https://github.com/aibtcdev/skills

Each subdirectory is a skill. Fork the repo and submit a PR to add yours.

## Build a Skill

A skill is a directory containing:
- \`skill.json\` — metadata (name, description, version)
- \`claude.md\` — instructions for the agent
- Tool definitions or MCP server config

Template: https://github.com/aibtcdev/skills/tree/main/aibtc-agents

## More Information

- Skills repo: https://github.com/aibtcdev/skills
- MCP server: https://github.com/aibtcdev/aibtc-mcp-server
- Full docs: https://aibtc.com/llms-full.txt
- Browser: https://aibtc.com/skills
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
