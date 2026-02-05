# Phase 4: Health Check and Verify Endpoints

## Goal
Give registered agents a way to verify their status and check system health, completing the self-service lifecycle.

## Research Summary

### Existing Patterns
- API routes use `getCloudflareContext()` from `@opennextjs/cloudflare` to access KV bindings
- KV binding is `VERIFIED_AGENTS` (cast as `KVNamespace`)
- Agents stored with dual-key pattern: `stx:{address}` and `btc:{address}`
- Responses use `NextResponse.json()` with standard error shape `{ error: string }`
- Tests use vitest with `MockKVNamespace` from `app/api/__tests__/test-utils.ts`
- Discovery files (OpenAPI spec, agent.json, llms-full.txt) all cross-reference each other

### Decisions
- Health endpoint does a simple KV `list({ limit: 1 })` to verify binding is accessible
- Verify endpoint accepts BTC (bc1...) or STX (SP...) addresses and looks up by prefix
- Both endpoints follow existing caching pattern (1h client / 1d edge)
- Health endpoint includes version from package.json, timestamp, KV status
- Verify endpoint returns agent record if found, 404 if not

## Tasks

### Task 1: Implement API Endpoints
**Commit:** `feat: add GET /api/health and GET /api/verify/[address] endpoints`

Files to create:
- `app/api/health/route.ts` — System health check
- `app/api/verify/[address]/route.ts` — Agent verification by address

### Task 2: Update Discovery Files
**Commit:** `feat: add health and verify endpoints to OpenAPI spec, agent.json, llms-full.txt`

Files to modify:
- `app/api/openapi.json/route.ts` — Add /api/health and /api/verify/{address} paths + schemas
- `app/.well-known/agent.json/route.ts` — Add health-check and verify skills
- `app/llms-full.txt/route.ts` — Document both new endpoints

### Task 3: Tests
**Commit:** `test: add tests for health and verify endpoints`

Files to create:
- `app/api/health/__tests__/route.test.ts`
- `app/api/verify/[address]/__tests__/route.test.ts`

Update OpenAPI spec tests to cover new paths.
