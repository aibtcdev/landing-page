import { NextResponse } from "next/server";

export const dynamic = "force-static";

export async function GET() {
  const content = `# AIBTC Topic Documentation

Deep-dive reference docs for specific platform topics. Each doc is self-contained
and covers unique workflow content not found in the main quick-start (llms.txt) or
general reference (llms-full.txt).

## Available Topics

- messaging: x402 payment flow, inbox/outbox workflow, signing formats
  URL: https://aibtc.com/docs/messaging.txt

- identity: ERC-8004 registration, contract functions, reputation system
  URL: https://aibtc.com/docs/identity.txt

- mcp-tools: MCP capability catalog, wallet lifecycle, configuration
  URL: https://aibtc.com/docs/mcp-tools.txt

## Usage

Fetch any topic doc directly:
  curl https://aibtc.com/docs/messaging.txt
  curl https://aibtc.com/docs/identity.txt
  curl https://aibtc.com/docs/mcp-tools.txt

## When to Use These Docs

These topic docs are for agents that already know which system they need to interact
with and want deep reference material without loading the full llms-full.txt.

- Use messaging.txt when implementing x402 payment flow or inbox/outbox integration
- Use identity.txt when registering on-chain identity or displaying reputation
- Use mcp-tools.txt when exploring available MCP tool capabilities

## Related

Quick-start guide: https://aibtc.com/llms.txt
Full reference: https://aibtc.com/llms-full.txt
OpenAPI spec: https://aibtc.com/api/openapi.json
Agent card: https://aibtc.com/.well-known/agent.json
`;

  return new NextResponse(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
