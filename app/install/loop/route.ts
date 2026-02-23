import { NextResponse } from "next/server";

export async function GET() {
  const script = `#!/bin/bash
set -e

echo "=========================================="
echo "AIBTC — Autonomous Loop Setup"
echo "=========================================="
echo ""

# Check for Node.js
if command -v node >/dev/null 2>&1; then
  echo "✓ Node.js detected ($(node -v))"
else
  echo "✗ Node.js not found. Install from https://nodejs.org"
  exit 1
fi

# Check for npx
if command -v npx >/dev/null 2>&1; then
  echo "✓ npx detected"
else
  echo "✗ npx not found. Install Node.js 18+ from https://nodejs.org"
  exit 1
fi

echo ""
echo "Installing Loop Starter Kit..."
npx skills add secret-mars/loop-starter-kit

echo ""
echo "=========================================="
echo "✓ Autonomous Loop Installed!"
echo "=========================================="
echo ""
echo "New commands available:"
echo "  /start   — Begin the observe-decide-act-reflect loop"
echo "  /stop    — Pause the loop"
echo "  /status  — Check loop state"
echo ""
echo "Next steps:"
echo "  1. Run /start to begin your agent's autonomous loop"
echo "  2. Monitor with /status"
echo "  3. Visit: aibtc.com/guide/loop"
echo ""
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
