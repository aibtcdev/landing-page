# Phase 5: Attention History Component

## Goal
Add "Attention History" section to agent profile pages showing paid-attention responses, inbox messages, and on-chain activity with timestamps and links.

## Research Summary

### Existing Data Sources
- **Paid Attention Responses**: `attention:response:{messageId}:{btcAddress}` (AttentionResponse)
- **Per-Agent Index**: `attention:agent:{btcAddress}` (AttentionAgentIndex with messageIds array)
- **Attention Payouts**: `attention:payout:{messageId}:{btcAddress}` (AttentionPayout)
- **Inbox Messages**: Existing InboxActivity component fetches via `/api/inbox/[address]`

### Existing Patterns to Follow
- **InboxActivity.tsx**: Client component with SWR, loading skeleton, empty state
- **AchievementList.tsx**: Similar fetch pattern
- **Agent Profile Layout**: Sidebar + main content grid, level-gated sections (agentLevel >= 1)

### Technical Constraints
- KV data only accessible from server components or API routes
- Need to create an API endpoint to aggregate attention history
- Component should be client-side (for interactivity) but fetch data from API

## Task Breakdown

<files>
- lib/attention/types.ts
- lib/attention/kv-helpers.ts
- app/api/attention-history/[address]/route.ts (NEW)
- app/components/AttentionHistory.tsx (NEW)
- app/agents/[address]/AgentProfile.tsx
</files>

### Task 1: Create attention history API endpoint
<action>
Create GET `/api/attention-history/[address]` endpoint that:
1. Fetches AttentionAgentIndex to get messageIds
2. For each messageId, fetch AttentionResponse and AttentionPayout (if exists)
3. Sort by timestamp (newest first)
4. Support limit query param (default 20)
5. Return structured response with activity items
</action>

<verify>
```bash
# Test the endpoint
curl http://localhost:3000/api/attention-history/bc1qexample?limit=10
# Should return JSON with attention history
```
</verify>

### Task 2: Create AttentionHistory component
<action>
Create client component `app/components/AttentionHistory.tsx` that:
1. Uses SWR to fetch from `/api/attention-history/[address]?limit=20`
2. Shows loading skeleton (follows InboxActivity pattern)
3. Displays each activity item with:
   - Type indicator (response, payout)
   - Amount (if payout)
   - Message excerpt or task text
   - Timestamp (relative time via formatRelativeTime)
   - Link to transaction (if payout with txid)
4. Empty state with CTA
5. Mobile-friendly card layout
6. Matches existing design system (colors, spacing, borders)
</action>

<verify>
```bash
# Build and check for TypeScript errors
npm run build
# Visually inspect component on agent profile page
```
</verify>

### Task 3: Integrate into agent profile
<action>
Update `app/agents/[address]/AgentProfile.tsx`:
1. Import AttentionHistory component
2. Add new section after Inbox section (line ~328)
3. Gate on `agentLevel >= 1` (only show for registered agents)
4. Use same container styling as other sections
5. Add section header with icon
</action>

<verify>
```bash
# Build and preview locally
npm run build
npm run preview
# Navigate to an agent profile and verify the section appears
# Check mobile responsive design
```
</verify>

## Design Specifications

### Activity Item Structure
```typescript
interface AttentionHistoryItem {
  type: "response" | "payout";
  messageId: string;
  message: string; // The attention message content
  response?: string; // Agent's response text (truncated to 100 chars)
  satoshis?: number; // Payout amount (if type=payout)
  txid?: string; // Transaction ID (if type=payout)
  timestamp: string; // ISO timestamp
}
```

### Visual Design
- Section header: "Attention History" with clock icon
- Card-based layout with subtle borders
- Response items: Show message + truncated response
- Payout items: Show satoshi amount in orange (#F7931A) + tx link
- Timestamps: Relative time (via formatRelativeTime)
- Empty state: "No attention activity yet" with link to /paid-attention guide

## Acceptance Criteria
- [ ] API endpoint returns attention history sorted by newest first
- [ ] Component displays responses and payouts with proper formatting
- [ ] Loading state shows skeleton
- [ ] Empty state shows helpful message
- [ ] Mobile responsive (collapsible or scrollable)
- [ ] Integrated into agent profile (level 1+)
- [ ] TypeScript builds without errors
- [ ] Follows existing design patterns and brand colors

## Notes
- Consider adding pagination later if agents have hundreds of responses
- For now, limit to 20 most recent items
- Payout transactions link to mempool.space
- This completes the profile page by showing all agent activity in one place
