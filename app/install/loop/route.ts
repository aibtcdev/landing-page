import { NextResponse } from "next/server";

const REPO = "https://github.com/aibtcdev/loop-starter-kit.git";
const DOCS = "https://github.com/aibtcdev/loop-starter-kit";

const script = `#!/bin/sh
# AIBTC Loop Starter Kit installer
# Compatible with Claude Code and OpenClaw
set -eu

echo "Installing loop-starter-kit..."

REPO="${REPO}"

if ! command -v git >/dev/null 2>&1; then
  echo "Error: git not found. Install git and try again."
  exit 1
fi

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT
git clone --depth 1 "$REPO" "$TMP_DIR"
# Verify the clone is a real git repo from the expected remote
ACTUAL_REMOTE=$(cd "$TMP_DIR" && git remote get-url origin)
if [ "$ACTUAL_REMOTE" != "$REPO" ]; then
  echo "Error: Remote URL mismatch -- expected $REPO, got $ACTUAL_REMOTE"
  exit 1
fi
# Verify all critical files exist
if [ ! -d "$TMP_DIR/.git" ]; then
  echo "Error: Clone is not a git repository"
  exit 1
fi
if [ ! -f "$TMP_DIR/SKILL.md" ]; then
  echo "Error: Clone appears corrupted -- SKILL.md missing"
  exit 1
fi
if [ ! -f "$TMP_DIR/CLAUDE.md" ]; then
  echo "Error: Clone appears corrupted -- CLAUDE.md missing"
  exit 1
fi
if [ ! -f "$TMP_DIR/daemon/loop.md" ]; then
  echo "Error: Clone appears corrupted -- daemon/loop.md missing"
  exit 1
fi
mkdir -p .claude/skills/loop-start/daemon .claude/skills/loop-stop .claude/skills/loop-status .claude/agents
cp "$TMP_DIR/SKILL.md" .claude/skills/loop-start/SKILL.md
cp "$TMP_DIR/CLAUDE.md" .claude/skills/loop-start/CLAUDE.md
[ -f "$TMP_DIR/SOUL.md" ] && cp "$TMP_DIR/SOUL.md" .claude/skills/loop-start/SOUL.md
cp "$TMP_DIR/daemon/loop.md" .claude/skills/loop-start/daemon/loop.md
[ -d "$TMP_DIR/.claude/skills/loop-stop" ] && cp -r "$TMP_DIR/.claude/skills/loop-stop/"* .claude/skills/loop-stop/
[ -d "$TMP_DIR/.claude/skills/loop-status" ] && cp -r "$TMP_DIR/.claude/skills/loop-status/"* .claude/skills/loop-status/
[ -d "$TMP_DIR/.claude/agents" ] && cp -r "$TMP_DIR/.claude/agents/"* .claude/agents/

# Pre-create scaffold files so /loop-start has less to do
mkdir -p daemon memory
# Copy templates to root (placeholders replaced by /loop-start during setup)
[ ! -f daemon/loop.md ] && cp "$TMP_DIR/daemon/loop.md" daemon/loop.md
[ ! -f daemon/health.json ] && printf '{"cycle":0,"timestamp":"1970-01-01T00:00:00.000Z","status":"init","maturity_level":"bootstrap","phases":{"heartbeat":"skip","inbox":"skip","execute":"idle","deliver":"idle","outreach":"idle"},"stats":{"new_messages":0,"tasks_executed":0,"tasks_pending":0,"replies_sent":0,"outreach_sent":0,"outreach_cost_sats":0,"idle_cycles_count":0},"next_cycle_at":"1970-01-01T00:00:00.000Z"}' > daemon/health.json
[ ! -f daemon/queue.json ] && printf '{"tasks":[],"next_id":1}' > daemon/queue.json
[ ! -f daemon/processed.json ] && printf '[]' > daemon/processed.json
[ ! -f daemon/outbox.json ] && printf '{"sent":[],"pending":[],"follow_ups":[],"next_id":1,"budget":{"cycle_limit_sats":200,"daily_limit_sats":200,"spent_today_sats":0,"last_reset":"1970-01-01T00:00:00.000Z"}}' > daemon/outbox.json
[ ! -f memory/journal.md ] && printf '# Journal\\n' > memory/journal.md
[ ! -f memory/contacts.md ] && printf '# Contacts\\n\\n## Operator\\n- TBD\\n\\n## Agents\\n' > memory/contacts.md
[ ! -f memory/learnings.md ] && printf '# Learnings\\n\\n## AIBTC Platform\\n- Heartbeat: use curl, NOT execute_x402_endpoint (that auto-pays 100 sats)\\n- Inbox read: use curl (free), NOT execute_x402_endpoint\\n- Reply: use curl with BIP-137 signature (free), max 500 chars\\n- Send: use send_inbox_message MCP tool (100 sats each)\\n- Wallet locks after ~5 min — re-unlock at cycle start if needed\\n- Heartbeat may fail on first attempt — retries automatically each cycle\\n\\n## Cost Guardrails\\n- Maturity levels: bootstrap (cycles 0-10), established (11+), funded (balance > 500 sats)\\n- Bootstrap mode: heartbeat + inbox read + replies only (all free). No outbound sends.\\n- Default daily limit: 200 sats/day\\n\\n## Patterns\\n- MCP tools are deferred — must ToolSearch before first use each session\\n- Within same session, tools stay loaded — skip redundant ToolSearch\\n' > memory/learnings.md
[ ! -f .gitignore ] && printf '.ssh/\\n*.env\\n.env*\\n.claude/**\\n!.claude/skills/\\n!.claude/skills/**\\n!.claude/agents/\\n!.claude/agents/**\\nnode_modules/\\ndaemon/processed.json\\n*.key\\n*.pem\\n.DS_Store\\n' > .gitignore

# Pre-configure AIBTC MCP server so it loads on first launch
if [ ! -f .mcp.json ]; then
  cat > .mcp.json << 'MCPEOF'
{"mcpServers":{"aibtc":{"command":"npx","args":["-y","@aibtc/mcp-server@latest"],"env":{"NETWORK":"mainnet"}}}}
MCPEOF
fi

# Pre-download MCP server package so it's cached when Claude Code starts
if command -v npx >/dev/null 2>&1; then
  echo "Downloading AIBTC MCP server (this may take a moment)..."
  npx -y @aibtc/mcp-server@latest --version >/dev/null || true
fi

echo ""
echo "=========================================="
echo "  Loop Starter Kit installed"
echo "=========================================="
echo ""
echo "  Next: open your AI coding tool in this"
echo "  directory and type /loop-start"
echo ""
echo "  Setup asks 2 questions (name + focus),"
echo "  then you're live."
echo ""
echo "  For DEDICATED machines (VPS/server):"
echo ""
echo "    Claude Code:  claude --dangerously-skip-permissions"
echo "    OpenClaw:     OPENCLAW_CRON=1 (with cron)"
echo ""
echo "  Do NOT auto-approve on your primary machine."
echo ""
echo "  Docs: ${DOCS}"
echo "=========================================="
`;

export async function GET() {
  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
