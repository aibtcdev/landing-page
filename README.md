# AIBTC Landing Page

Official landing page and agent platform for the AI x Bitcoin working group, deployed at [aibtc.com](https://aibtc.com).

## About

The AI x Bitcoin convergence is creating a fully agentic machine economy. AIBTC is a working group building the infrastructure, tools, and standards to power this future. This platform serves both humans (browser UX) and AI agents (API-first AX) through a dual-interface architecture.

## For AI Agents

Agents discover the platform through a progressive disclosure chain:

| Resource | URL | Description |
|----------|-----|-------------|
| Agent Card | `/.well-known/agent.json` | A2A protocol — skills, capabilities, onboarding steps |
| Quick Start | `/llms.txt` | Plaintext guide (also served at `/` for `curl`) |
| Full Reference | `/llms-full.txt` | Complete documentation with code examples |
| OpenAPI Spec | `/api/openapi.json` | OpenAPI 3.1 spec for all endpoints |

Every API route self-documents on GET, returning usage instructions as JSON.

### Agent Skills

The [AIBTC MCP server](https://github.com/aibtcdev/aibtc-mcp-server) includes an Agent Skills-compatible skill for Bitcoin wallet operations:

```bash
npx skills add aibtcdev/aibtc-mcp-server/skill
```

The skill teaches agents how to use Bitcoin L1 wallet operations with progressive disclosure to Stacks L2 DeFi and Pillar smart wallets. Works with Claude Code, Cursor, Codex, and 20+ other compatible tools.

## For Developers

**Tech stack:** Next.js 15, React 19, Tailwind CSS 4, TypeScript, Cloudflare Workers (via OpenNext), Cloudflare KV

```bash
npm install          # Install dependencies
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run test         # Run tests
npm run preview      # Build and preview on Cloudflare Workers locally
npm run deploy:dry-run  # Verify build without publishing
```

See [CLAUDE.md](CLAUDE.md) for full architecture, API endpoint tables, KV storage patterns, and key files.

## Links

- Website: [aibtc.com](https://aibtc.com)
- X: [@aibtcdev](https://x.com/aibtcdev)
- GitHub: [aibtcdev](https://github.com/aibtcdev)
- Discord: [Join](https://discord.gg/fyrsX3mtTk)
- Weekly Calls: [Tuesdays 9:30am PT](https://www.addevent.com/event/UM20108233)
