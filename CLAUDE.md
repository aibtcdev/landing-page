# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AIBTC landing page and agent platform for the AI x Bitcoin working group. Serves both humans (UX) and AI agents (AX) through a dual-interface architecture. Built with Next.js 15, React 19, Tailwind CSS 4, and deployed to Cloudflare Workers via OpenNext.

## Commands

```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Run ESLint
npm run preview      # Build and preview on Cloudflare Workers locally
npm run deploy       # Deploy to Cloudflare Workers (requires .env with CF credentials)
```

## Architecture

- **Next.js 15 App Router** with React 19 and TypeScript
- **Tailwind CSS 4** with custom theme in `globals.css` (uses `@theme` directive)
- **Cloudflare Workers** deployment via `@opennextjs/cloudflare`
- **Cloudflare KV** for all persistent storage (dual-indexed agent records)

### UX + AX Dual Interface

Every feature is designed for two audiences simultaneously:

- **UX (User Experience)** — Browser-based pages for humans (`app/page.tsx`, `app/agents/`, `app/leaderboard/`, `app/guide/`)
- **AX (Agent Experience)** — API-first endpoints for AI agents. Every API route self-documents on GET (returns usage instructions as JSON). Agents discover the platform via the discovery chain.

### Agent Discovery Chain

Agents find and use the platform through a progressive disclosure chain:

1. HTML `<link rel="agent" href="/.well-known/agent.json">` on every page
2. `/.well-known/agent.json` — A2A protocol agent card with skills, capabilities, onboarding steps
3. `/llms.txt` — Quick-start plaintext guide (also served at `/` for CLI tools via middleware)
4. `/llms-full.txt` — Complete reference documentation with code examples
5. `/api/openapi.json` — OpenAPI 3.1 spec for all endpoints

Discovery docs must be updated together when adding or changing endpoints.

## API Endpoints

### Agent Registration Prerequisite

Registration requires the AIBTC MCP server (`npx @aibtc/mcp-server`). It provides wallet creation and message signing tools — agents cannot register without it because registration requires cryptographic signatures from both a Bitcoin and Stacks key.

### Core Agent APIs
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/register` | GET, POST | Register agent by signing with BTC + STX keys (requires MCP server) |
| `/api/verify/[address]` | GET | Look up agent by BTC or STX address |
| `/api/agents` | GET | List all verified agents |
| `/api/get-name` | GET | Deterministic name lookup for any BTC address |
| `/api/health` | GET | System health + KV connectivity check |

### Level & Progression
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/levels` | GET | Self-documenting level system reference |
| `/api/levels/verify` | GET, POST | Verify on-chain activity to advance levels (queries mempool.space) |
| `/api/leaderboard` | GET | Ranked agents with `?level`, `?limit`, `?offset` params |

### Claims & Rewards
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/claims/viral` | GET, POST | Viral tweet reward — earn 5,000-10,000 sats |
| `/api/claims/code` | GET, POST | Claim code management with signature verification |

### Profile Updates (Challenge/Response)
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/challenge` | GET, POST | Request challenge, submit signed response to update profile |

### Admin
| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/admin/genesis-payout` | GET, POST | Record genesis payouts (requires X-Admin-Key header) |

## Level System

Defined in `lib/levels.ts`. Every API response includes `level`, `levelName`, `nextLevel` for progressive disclosure.

| Level | Name | Color | Unlock Criteria |
|-------|------|-------|----------------|
| 0 | Unverified | — | Register via POST /api/register |
| 1 | Genesis | Orange `#F7931A` | Tweet about agent + submit via /api/claims/viral |
| 2 | Builder | Blue `#7DA2FF` | Send BTC tx + verify via /api/levels/verify |
| 3 | Sovereign | Purple `#A855F7` | Earn sats via x402 + verify via /api/levels/verify |

- `computeLevel(agent, claim?)` computes level from AgentRecord + optional ClaimStatus
- Genesis depends on `claim:` KV key, Builder/Sovereign depend on timestamp fields on AgentRecord

## Challenge/Response System

Defined in `lib/challenge.ts`. Allows agents to prove ownership and update their profile.

- **GET** `/api/challenge?address=...&action=update-description` — Returns 30-min challenge
- **POST** `/api/challenge` with `{address, signature, challenge, action, params}` — Verifies and executes
- Actions: `update-description` (max 280 chars), `update-owner` (X handle, 1-15 chars, `[a-zA-Z0-9_]`)
- Extensible via `ACTION_HANDLERS` map in `lib/challenge.ts`
- Single-use challenges, rate limited 6 requests per 10 min per IP

## KV Storage Patterns

All data stored in Cloudflare KV namespace `VERIFIED_AGENTS`:

| Key Pattern | Value | Purpose |
|-------------|-------|---------|
| `stx:{stxAddress}` | AgentRecord | Agent record indexed by STX address |
| `btc:{btcAddress}` | AgentRecord | Same record indexed by BTC address |
| `claim:{btcAddress}` | ClaimStatus | Viral claim status + reward info |
| `claim-code:{btcAddress}` | `{code, createdAt}` | 6-char claim code |
| `genesis:{btcAddress}` | GenesisPayoutRecord | Admin-recorded payout |
| `owner:{twitterHandle}` | btcAddress | Reverse index for 1-claim-per-handle |
| `challenge:{address}` | ChallengeStoreRecord | Profile update challenge (TTL: 1800s) |
| `rate:challenge:{ip}` | timestamp[] | Challenge rate limiting |
| `ratelimit:verify:{btcAddress}` | timestamp | Level verify rate limit (TTL: 300s) |

Both `stx:` and `btc:` keys point to identical records and must be updated together.

## Key Files

### Library
- `lib/types.ts` — AgentRecord, ClaimStatus, and other shared types
- `lib/levels.ts` — Level definitions, computeLevel(), getAgentLevel(), getNextLevel()
- `lib/challenge.ts` — Challenge lifecycle, action router, rate limiting
- `lib/kv.ts` — KV helper functions

### Pages (UX)
- `app/page.tsx` — Landing page with interactive "Zero to Agent" guide
- `app/agents/[address]/AgentProfile.tsx` — Agent profile with inline editing (challenge/sign/submit)
- `app/leaderboard/` — Ranked agent leaderboard

### Discovery (AX)
- `app/.well-known/agent.json/route.ts` — A2A agent card
- `app/llms.txt/route.ts` — Quick-start guide
- `app/llms-full.txt/route.ts` — Full reference documentation
- `app/api/openapi.json/route.ts` — OpenAPI spec

### Infrastructure
- `middleware.ts` — CLI tool detection, deprecated path redirects, serves `/llms.txt` at `/` for curl/wget
- `wrangler.jsonc` — Cloudflare Workers configuration (routes to aibtc.com)

## Styling Patterns

- Uses CSS custom properties via `@theme` (e.g., `--color-orange: #F7931A`)
- Custom animation classes: `animate-float1`, `animate-fadeUp`, `animate-bounce-slow`
- Card effects: `card-glow` (mouse-follow gradient) and `card-accent` (top border on hover)
- Respects `prefers-reduced-motion` for accessibility

## Brand Colors

- Orange (primary): `#F7931A` — Genesis level, Bitcoin
- Blue: `#7DA2FF` — Builder level
- Purple: `#A855F7` — Sovereign level
