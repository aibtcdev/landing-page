# PHASES.md -- Performance and Code Simplification Quest

## Goal

Fix highest-value performance and code simplification issues from react-perf and code-simplifier reviews, without breaking the site or the current visual design.

**Branch:** `feat/simplified-homepage`

---

## Phase 1: Remove Dead CSS and Preload Primary Font

**Goal:** Eliminate unused CSS rules (~80 lines) and add font preload for LCP improvement.

**Tasks:**

1. Remove dead CSS from `globals.css`:
   - `@keyframes shimmer` (lines 98-101)
   - `.btn-shimmer::before` and `.btn-shimmer:hover::before` (lines 128-142)
   - `.card-glow::after` and `.card-glow:hover::after` (lines 144-160)
   - `.card-accent::before` and `.card-accent:hover::before` (lines 162-177)
   - `.section-divider-glow::after` (lines 179-190)
   - `.focus-ring:focus-visible` (lines 201-205)

   **Evidence:** Grep for these class names across all `.tsx` files returns zero matches. They are only defined in `globals.css` and never referenced.

2. Add font preload in `layout.tsx`:
   - Add `<link rel="preload" href="/fonts/RocGrotesk-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />` to the `<head>` section.

**Files touched:**
- `app/globals.css`
- `app/layout.tsx`

**Verification:**
- `npm run build` succeeds
- `grep -r "shimmer\|card-glow\|card-accent\|section-divider-glow\|focus-ring" app/ --include="*.css"` returns nothing
- Font preload link appears in page source
- Visual appearance unchanged (these CSS classes were already unused)

---

## Phase 2: Extract Shared Types and Utilities

**Goal:** Create shared `AgentRecord` interface and utility functions (`truncateAddress`, `updateMeta`) in a single location, eliminating 4 duplicate interface definitions and 2 duplicate function definitions.

**Tasks:**

1. Create `lib/types.ts` with the unified `AgentRecord` interface:
   - Must be a superset of all current definitions (include `stxPublicKey`, `btcPublicKey`, `owner` as optional fields)
   - The client-side pages use a subset; the API routes use the full record

2. Create `lib/utils.ts` with:
   - `truncateAddress(address: string, prefixLen?: number, suffixLen?: number): string` -- currently defined in `app/agents/page.tsx` (8/8 slice) and `app/agents/[address]/page.tsx` (6/6 slice) with different truncation lengths. Use a parameter to support both.
   - `updateMeta(name: string, content: string, property?: boolean): void` -- currently duplicated identically in `app/agents/page.tsx` and `app/agents/[address]/page.tsx`.

3. Update consumers to import from shared locations:
   - `app/api/agents/route.ts` -- import `AgentRecord` from `@/lib/types`
   - `app/api/verify/[address]/route.ts` -- import `AgentRecord` from `@/lib/types`
   - `app/agents/page.tsx` -- import `AgentRecord` (as `Agent`), `truncateAddress`, `updateMeta`
   - `app/agents/[address]/page.tsx` -- import `AgentRecord`, `truncateAddress`, `updateMeta`

**Files touched:**
- `lib/types.ts` (new)
- `lib/utils.ts` (new)
- `app/api/agents/route.ts`
- `app/api/verify/[address]/route.ts`
- `app/agents/page.tsx`
- `app/agents/[address]/page.tsx`

**Verification:**
- `npm run build` succeeds
- `grep -r "interface AgentRecord\|interface Agent {" app/ --include="*.ts" --include="*.tsx"` returns zero matches (all moved to lib)
- `grep -r "function truncateAddress\|function updateMeta" app/ --include="*.tsx"` returns zero matches
- Agent listing and profile pages render correctly
- API routes return same data shape

---

## Phase 3: Extract Shared Components (AnimatedBackground, Footer, CopyButton)

**Goal:** Deduplicate ~210 lines of copy-pasted component code across 5+ files by extracting shared `AnimatedBackground`, `Footer`, and copy-button patterns into reusable components.

**Tasks:**

1. Create `app/components/AnimatedBackground.tsx`:
   - Accepts optional `variant` prop for slight differences (e.g., the agents page has a mobile-only orb; the guide pages omit the third orb)
   - The component renders the fixed background with pattern image, gradient orbs, and vignette
   - Currently copy-pasted in: `app/page.tsx` (lines 290-307), `app/agents/page.tsx` (lines 99-112), `app/agents/[address]/page.tsx` (lines 180-193), `app/guide/claude/page.tsx` (lines 139-155), `app/guide/openclaw/page.tsx` (lines 145-161)

2. Create `app/components/Footer.tsx`:
   - Simple footer variant (logo + copyright) used by guide pages -- currently duplicated identically in `app/guide/claude/page.tsx` (lines 374-390) and `app/guide/openclaw/page.tsx` (lines 359-376)
   - The homepage has its own more complex footer with link grid, so do NOT extract that one -- only the simple guide footer

3. Create `app/components/CopyButton.tsx`:
   - A reusable copy-to-clipboard button with checkmark feedback
   - Currently the copy icon pattern (clipboard icon -> checkmark with timeout) is repeated in `app/page.tsx` (core upgrades, additional upgrades, hero prompt), `app/guide/claude/page.tsx`, and `app/guide/openclaw/page.tsx`
   - The component should accept: `text` (string to copy), `label` (button text), `variant` (styling variant)

4. Update all consumer pages to use the extracted components.

**Files touched:**
- `app/components/AnimatedBackground.tsx` (new)
- `app/components/Footer.tsx` (new)
- `app/components/CopyButton.tsx` (new)
- `app/page.tsx`
- `app/agents/page.tsx`
- `app/agents/[address]/page.tsx`
- `app/guide/claude/page.tsx`
- `app/guide/openclaw/page.tsx`

**Verification:**
- `npm run build` succeeds
- All 5 pages render visually identical to before
- Copy-to-clipboard still works on all pages
- Background animations still play (reduced-motion preference still respected)

---

## Phase 4: Use Navbar Everywhere and Unify Copy State on Homepage

**Goal:** Replace duplicated header markup in guide pages and the homepage with the existing `Navbar` component, and simplify the homepage's 3 separate copy-state variables into one.

**Tasks:**

1. Replace the homepage's inline `<header>` (lines 310-373 in `app/page.tsx`) with `<Navbar />`:
   - The homepage currently has its own header/nav with duplicated `socialLinks`, `SocialLinks` component, scroll state, and mobile menu -- all of which already exist in `Navbar.tsx`
   - Remove the local `socialLinks` array, `SocialLinks` function, `isScrolled` state, `isMenuOpen` state, and the scroll/overflow effects from `app/page.tsx` (these are all in Navbar already)
   - Note: The homepage header has "Claim Your Agent" CTA while Navbar has "Get Started" -- verify which is correct and align if needed

2. Replace the guide pages' inline `<header>` elements with `<Navbar />`:
   - `app/guide/claude/page.tsx` lines 157-186: static header with logo + nav links
   - `app/guide/openclaw/page.tsx` lines 164-193: identical static header
   - These are simplified versions that lack mobile menu, social links, and scroll effects -- `Navbar` is the better replacement

3. Unify homepage copy-state management:
   - Currently: `copiedIndex` (core upgrades), `copiedAdditional` (additional upgrades), `claimCopied` (hero prompt) -- 3 separate state variables
   - Replace with single: `copiedId: string | null` using unique keys like `"core-0"`, `"additional-1"`, `"claim"`
   - This eliminates 2 state variables and the separate `copyClaimPrompt` function

**Files touched:**
- `app/page.tsx`
- `app/guide/claude/page.tsx`
- `app/guide/openclaw/page.tsx`

**Verification:**
- `npm run build` succeeds
- Homepage header matches Navbar behavior (scroll effect, mobile menu, social links)
- Guide page headers now have full Navbar functionality (mobile menu, social links)
- All copy buttons still work on homepage (core upgrades, additional upgrades, hero prompt)
- `grep -r "isScrolled\|isMenuOpen" app/page.tsx` returns zero matches (moved to Navbar)

---

## Phase 5: Add Image Dimensions and Lazy Loading, Use Single-Agent Endpoint

**Goal:** Improve LCP/CLS by adding explicit dimensions and lazy loading to external images, and optimize the agent profile page to fetch a single agent instead of all agents.

**Tasks:**

1. Add `loading="lazy"`, `width`, and `height` attributes to all `<img>` tags for bitcoinfaces.xyz avatars:
   - `app/page.tsx`: hero section avatar stack (5 images, lines 416-419), agent cards desktop (10 images, lines 611-615), agent cards mobile (6 images, lines 642), phone mockup avatar (line 486-489)
   - `app/agents/page.tsx`: agent table avatars (line 335-342)
   - `app/agents/[address]/page.tsx`: profile avatar (line 287-290) -- this one should NOT be lazy (it's above the fold)
   - Standard size for these avatars: `width={64} height={64}` (they are rendered at 32-80px, source images are larger)
   - The hero avatar stack (32px rendered) and phone mockup avatar (44px rendered) can use smaller explicit sizes

2. Change `app/agents/[address]/page.tsx` to use the verify endpoint instead of fetching all agents:
   - Currently fetches `GET /api/agents` (all agents) then filters client-side (lines 48-69)
   - Should use `GET /api/verify/${address}` which returns a single agent by address
   - The verify endpoint returns `{ registered: boolean, agent: AgentRecord }` -- adapt the response parsing
   - Note: The verify endpoint distinguishes btc vs stx addresses by prefix (bc1 vs SP) -- the profile page URL uses btcAddress, so this will work for most cases
   - Handle case where address format is ambiguous by falling back to the agents endpoint if needed

**Files touched:**
- `app/page.tsx`
- `app/agents/page.tsx`
- `app/agents/[address]/page.tsx`

**Verification:**
- `npm run build` succeeds
- All images render at correct sizes (no visual change)
- Browser DevTools shows `loading="lazy"` on below-fold images
- Agent profile page makes a single API call (check Network tab) instead of loading all agents
- Agent profile page still works for both BTC and STX address URLs
- No CLS shift visible when scrolling through agent cards

---

## Phase Dependencies

```
Phase 1 (CSS + font) ---- no deps, standalone
Phase 2 (types/utils) --- no deps, standalone
Phase 3 (components) ---- should run after Phase 1 (CSS cleanup avoids confusion)
Phase 4 (Navbar + state) - should run after Phase 3 (components are in place)
Phase 5 (images + API) -- should run after Phase 4 (pages are in final shape)
```

Phases 1 and 2 can run in parallel. Phases 3-5 are sequential.

## Estimated Context Budget per Phase

| Phase | New/Modified Files | Est. Source Context | Fits in 200k? |
|-------|--------------------|---------------------|----------------|
| 1     | 2 files            | ~5k tokens          | Yes            |
| 2     | 6 files            | ~15k tokens         | Yes            |
| 3     | 8 files            | ~40k tokens         | Yes            |
| 4     | 3 files            | ~30k tokens         | Yes            |
| 5     | 3 files            | ~25k tokens         | Yes            |
