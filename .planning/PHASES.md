# Phases

## Phase 1: Normalize Card Spacing, Typography, and Container Layout
Goal: Establish consistent vertical rhythm, responsive typography scale, and uniform card padding in AgentProfile.tsx and LevelProgress.tsx
Status: `completed`
Files: `app/agents/[address]/AgentProfile.tsx`, `app/components/LevelProgress.tsx`

## Phase 2: Fix Mobile Overflow in Child Components
Goal: Prevent horizontal overflow at 320px-375px viewports in IdentityBadge, ReputationSummary, ReputationFeedbackList, InboxMessage, AchievementBadge
Status: `completed`
Files: `app/components/IdentityBadge.tsx`, `app/components/ReputationSummary.tsx`, `app/components/ReputationFeedbackList.tsx`, `app/components/InboxMessage.tsx`, `app/components/AchievementBadge.tsx`

## Phase 3: Refine Claim Section and Action Buttons
Goal: Ensure claim flows, buttons, and footer links have proper touch targets (44px min) and don't overflow at 320px
Status: `completed`
Files: `app/agents/[address]/AgentProfile.tsx` (claim section only)

## Phase 4: Refactor Data Fetching Away from useEffect
Goal: Replace useEffect-based data fetching with React 19 / Next.js 15 patterns (Server Components, Suspense, or route-level loading) per Vercel/React best practices
Status: `pending`
Files: `app/agents/[address]/AgentProfile.tsx`, `app/agents/[address]/page.tsx`
