import { NextResponse } from "next/server";

export async function GET() {
  const script = `#!/bin/bash
set -e

echo "=========================================="
echo "AIBTC — Claude Code + MCP Setup"
echo "=========================================="
echo ""

# Check if claude command exists
if command -v claude >/dev/null 2>&1; then
  echo "✓ Claude Code CLI detected"
else
  echo "Installing Claude Code CLI..."
  curl -fsSL https://claude.ai/install.sh | bash

  # Check again after install
  if command -v claude >/dev/null 2>&1; then
    echo "✓ Claude Code CLI installed successfully"
  else
    echo ""
    echo "⚠ Claude CLI installed but not in PATH yet."
    echo "Please restart your shell and run this command again:"
    echo "  curl -fsSL aibtc.com/install/claude | bash"
    exit 1
  fi
fi

echo ""
echo "Adding AIBTC MCP server to Claude Code..."
claude mcp add aibtc --scope user -- npx @aibtc/mcp-server

echo ""
echo "=========================================="
echo "✓ Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Restart Claude Code if it's running"
echo "  2. Try: 'create a wallet'"
echo "  3. Visit: aibtc.com"
echo ""
`;

  return new NextResponse(script, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
