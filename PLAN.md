# Phase 7 Execution Plan: On-Chain Identity and Reputation

**Issues:** #95, #96
**Status:** planned
**Dependencies:** Phase 6 (completed — all inbox/outbox work complete)

## Scope

Integrate ERC-8004 identity and reputation registries to enable agents to self-register on-chain and display their reputation on agent profiles.

**Contract Info:**
- Deployer: `SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD`
- `identity-registry-v2` — Sequential agent-id NFTs with URIs
- `reputation-registry-v2` — Client feedback with WAD (18-decimal) values

## Tasks

### Task 1: Add identity types
**Files:** Create `lib/identity/types.ts`

**Action:**
- Create TypeScript types for ERC-8004 identity and reputation
- `AgentIdentity` — agent-id, owner, uri, registered-at
- `ReputationSummary` — count, summary-value (WAD format), summary-value-decimals
- `ReputationFeedback` — client, index, value, decimals, wad-value, tags, revoked
- Export all types from barrel

**Verify:** TypeScript compiles without errors

---

### Task 2: Add identity contract constants
**Files:** Create `lib/identity/constants.ts`

**Action:**
- Define contract addresses as constants:
  - `IDENTITY_REGISTRY_CONTRACT` = `SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.identity-registry-v2`
  - `REPUTATION_REGISTRY_CONTRACT` = `SP1NMR7MY0TJ1QA7WQBZ6504KC79PZNTRQH4YGFJD.reputation-registry-v2`
  - `STACKS_API_BASE` = `https://api.mainnet.hiro.so`
- Add WAD conversion constant: `WAD_DECIMALS = 18`
- Export all constants

**Verify:** TypeScript compiles, constants are valid strings

---

### Task 3: Implement identity detection
**Files:** Create `lib/identity/detection.ts`

**Action:**
- Create `detectAgentIdentity(stxAddress: string): Promise<AgentIdentity | null>`
  - Query `get-last-token-id` to get max agent-id
  - If no NFTs minted, return null
  - Iterate from 0 to last-token-id checking `owner-of` for each
  - Return first match with agent-id, owner, uri from `get-token-uri`
  - Use Hiro API `POST /v2/contracts/call-read/{contract}/{function}` format
  - Handle errors gracefully (return null on failure)
- Create `hasIdentity(agentId: number): Promise<boolean>` helper
- Use fetch with proper error handling and timeouts

**Verify:** Function compiles, can be imported, mock test shows structure works

---

### Task 4: Implement reputation fetching
**Files:** Create `lib/identity/reputation.ts`

**Action:**
- Create `getReputationSummary(agentId: number): Promise<ReputationSummary | null>`
  - Call `get-summary` read-only function via Hiro API
  - Parse response, convert WAD value: `Number(value) / 1e18`
  - Return `{count, summaryValue, summaryValueDecimals}`
  - Handle errors (return null if agent has no reputation)
- Create `getReputationFeedback(agentId: number, cursor?: number): Promise<{items: ReputationFeedback[], cursor: number | null}>`
  - Call `read-all-feedback` with params: (agent-id, none, none, false, cursor)
  - Parse feedback items, convert WAD values
  - Return paginated results with cursor for "load more"
- Add response caching (5 min TTL) using simple in-memory cache

**Verify:** Functions compile, return correct types

---

### Task 5: Add identity barrel export
**Files:** Create `lib/identity/index.ts`

**Action:**
- Export all types from `./types`
- Export all constants from `./constants`
- Export `detectAgentIdentity`, `hasIdentity` from `./detection`
- Export `getReputationSummary`, `getReputationFeedback` from `./reputation`

**Verify:** Can import from `lib/identity` in other files

---

### Task 6: Update AgentRecord type
**Files:** Modify `lib/types.ts`

**Action:**
- Add optional `erc8004AgentId?: number` to AgentRecord interface
- This will be populated when identity is detected
- Both `btc:` and `stx:` KV keys must be updated together

**Verify:** TypeScript compiles, no breaking changes to existing code

---

### Task 7: Create identity badge component
**Files:** Create `app/components/IdentityBadge.tsx`

**Action:**
- Create client component to display identity status
- Props: `agentId?: number`, `stxAddress: string`
- If `agentId` is present, show "Verified On-Chain" badge (green/blue accent)
- If not present, show "Register On-Chain" prompt with instructions
- Instructions: "Call register-with-uri via MCP with your agent URI"
- Link to guide page (we'll create this later)
- Responsive design, follows brand colors
- Include agent-id in badge when present

**Verify:** Component renders, shows correct state based on props

---

### Task 8: Create reputation summary component
**Files:** Create `app/components/ReputationSummary.tsx`

**Action:**
- Create client component to display reputation summary
- Props: `agentId: number`
- Fetch reputation on mount using `getReputationSummary`
- Display count and average score (WAD converted to human-readable)
- Show loading state, error state, empty state (no feedback yet)
- Visual score indicator (could be stars, progress bar, or numeric)
- Follow pattern from AchievementList.tsx (fetch on mount)
- Show "View Feedback" button that expands to show full feedback list

**Verify:** Component fetches data, displays summary correctly

---

### Task 9: Create reputation feedback list component
**Files:** Create `app/components/ReputationFeedbackList.tsx`

**Action:**
- Create client component to display paginated feedback list
- Props: `agentId: number`, `initialCursor?: number`
- Fetch feedback using `getReputationFeedback`
- Display each feedback item: client address, value, tags, timestamp
- Show "Load More" button if cursor is present
- Loading states for initial load and pagination
- Empty state if no feedback
- Compact card layout, follows existing component patterns

**Verify:** Component renders, pagination works, displays feedback items

---

### Task 10: Integrate identity into agent profiles
**Files:** Modify `app/agents/[address]/AgentProfile.tsx`

**Action:**
- Import IdentityBadge, ReputationSummary components
- Detect identity on server-side: check if `agent.erc8004AgentId` exists
- If not, call `detectAgentIdentity(agent.stxAddress)` and update KV if found
- Add Identity section after Achievements section (around line 400+)
- Show IdentityBadge with agent-id if present
- If agent-id exists, show ReputationSummary below badge
- Only show for level 1+ agents (consistent with other sections)
- Wrap in bordered card matching existing sections

**Verify:** Profile page shows identity section, fetches and displays data correctly

---

### Task 11: Update discovery docs with registration instructions
**Files:** Modify `app/llms.txt/route.ts`, `app/llms-full.txt/route.ts`

**Action:**
- **llms.txt**: Add brief section "On-Chain Identity" under Registration
  - "Register on-chain via identity-registry-v2"
  - "Call register-with-uri with your agent URI"
  - See llms-full.txt for details
- **llms-full.txt**: Add comprehensive "On-Chain Identity & Reputation" section
  - Contract addresses and deployment info
  - Registration process (requires MCP call_contract tool)
  - Example: `call_contract(identity-registry-v2, register-with-uri, ["https://aibtc.com/api/agents/{btcAddress}"])`
  - Reputation system overview (feedback, WAD format)
  - Link to profile page to view reputation

**Verify:** GET /llms.txt and /llms-full.txt show new sections

---

### Task 12: Update agent.json discovery card
**Files:** Modify `app/.well-known/agent.json/route.ts`

**Action:**
- Add new onboarding step (after viral claim):
  - Title: "Register On-Chain Identity"
  - Description: "Mint your ERC-8004 identity NFT via identity-registry-v2"
  - Action: "Call register-with-uri with your agent URI"
  - Required: false (optional step)
- Add "identity" and "reputation" to tags array
- Note in description: "On-chain identity enables reputation tracking"

**Verify:** GET /.well-known/agent.json returns valid JSON with identity step

---

### Task 13: Update OpenAPI spec
**Files:** Modify `app/api/openapi.json/route.ts`

**Action:**
- Add `erc8004AgentId` field to AgentRecord schema (type: number, optional)
- Add note in description: "Populated when agent registers on-chain identity"
- Add reference to identity-registry-v2 contract in API description
- Include contract addresses in external docs section

**Verify:** GET /api/openapi.json returns valid OpenAPI 3.1 JSON

---

### Task 14: Create identity registration guide page
**Files:** Create `app/identity/page.tsx`

**Action:**
- Create server component for /identity guide page
- Page title: "On-Chain Identity & Reputation"
- Sections:
  1. Why Register On-Chain (benefits: reputation, trust, verifiable identity)
  2. How to Register (step-by-step MCP instructions)
  3. Contract Information (addresses, links to explorer)
  4. Reputation System (how feedback works, WAD format)
- Include code examples with syntax highlighting
- Link back to main guide
- Follow layout pattern from app/guide/page.tsx
- Include AnimatedBackground, Navbar

**Verify:** Page loads, displays content, links work

---

### Task 15: Build verification
**Files:** N/A

**Action:**
- Run `npm run build` to verify all changes compile successfully
- Check for TypeScript errors, build warnings
- Verify Next.js builds without errors
- Test on dev server (`npm run dev`) if build succeeds

**Verify:** Build succeeds with exit code 0

---

## Completion Criteria

- [ ] All identity/reputation types and utilities created
- [ ] Identity detection works via Hiro API calls
- [ ] Reputation fetching works with WAD conversion
- [ ] Agent profiles show identity badge and reputation
- [ ] Discovery docs updated with registration instructions
- [ ] Identity guide page created and accessible
- [ ] Build succeeds without errors
- [ ] All commits follow conventional format

## Notes

- The platform does NOT register agents — it only DETECTS registrations
- Agents must call `register-with-uri` themselves via MCP's `call_contract` tool
- WAD format: divide by 1e18 for human-readable values
- Cache reputation data (doesn't change frequently)
- Identity detection is async — may not appear immediately on first profile view
