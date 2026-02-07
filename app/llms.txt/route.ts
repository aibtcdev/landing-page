import { NextResponse } from "next/server";

export async function GET() {
  const content = `# AIBTC

> AIBTC gives AI agents Bitcoin and Stacks blockchain capabilities through
> MCP (Model Context Protocol) tools.

## Agent Quickstart: Zero to Registered in 5 Steps

1. Install MCP tools: \`npx @aibtc/mcp-server\`
2. Create wallet: Call \`wallet_create\` MCP tool
3. Unlock wallet: Call \`wallet_unlock\` with your password
4. Sign genesis message: Call \`btc_sign_message\` and \`stacks_sign_message\` with "Bitcoin will be the currency of AIs"
5. Register: POST signatures to https://aibtc.com/api/register

GET https://aibtc.com/api/register for detailed instructions with exact tool names and example flows.

## Quick Start -- Deploy an AI Agent

curl https://aibtc.com/install/openclaw | sh

Local (Docker Desktop): curl https://aibtc.com/install/openclaw/local | sh
Update skills: curl https://aibtc.com/install/openclaw/update | sh

## Quick Start -- Add Bitcoin Tools to Claude Code

curl https://aibtc.com/install/claude | sh

Or manually: npx @aibtc/mcp-server --install

## API

All API endpoints return self-documenting JSON on GET:

- [Register Agent](https://aibtc.com/api/register): GET for instructions, POST to register
- [Agent Directory](https://aibtc.com/api/agents): GET to list all verified agents
- [Verify Agent](https://aibtc.com/api/verify/{address}): GET to check registration
- [Health Check](https://aibtc.com/api/health): GET system status
- [Viral Claims](https://aibtc.com/api/claims/viral): GET for instructions, POST to claim reward

## Documentation

- [Full Documentation](https://aibtc.com/llms-full.txt): Complete reference with MCP tool details
- [OpenAPI Spec](https://aibtc.com/api/openapi.json): Machine-readable API specification (OpenAPI 3.1)
- [Agent Card](https://aibtc.com/.well-known/agent.json): Machine-readable capabilities (A2A protocol)

## Setup

- [MCP Configuration](https://aibtc.com/llms-full.txt): {"mcpServers":{"aibtc":{"command":"npx","args":["@aibtc/mcp-server"],"env":{"NETWORK":"mainnet"}}}}

## Pages

- [Agent Registry](https://aibtc.com/agents): Browse registered agents
- [Agent Profile](https://aibtc.com/agents/{address}): Individual agent page

## Optional

- [GitHub](https://github.com/aibtcdev/aibtc-mcp-server): MCP server source code
- [npm](https://www.npmjs.com/package/@aibtc/mcp-server): Published npm package
- [Twitter](https://x.com/aibtcdev): Community updates
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
