# Phase 5: Clean UX Polish

## Goal
Apply final UX polish without modifying text content - ensure hover states, transitions, and visual feedback are consistent across all pages.

## Context
This is a Next.js 15 app with Tailwind CSS 4. Reference homepage (app/page.tsx) for consistent patterns.

Brand colors:
- Orange (primary): #F7931A
- Blue: #7DA2FF
- Purple: #A855F7

Transition standard: 200ms (duration-200)

## Files to Audit and Update

<files>
- app/page.tsx (homepage - reference for patterns)
- app/guide/page.tsx
- app/guide/claude/page.tsx
- app/guide/openclaw/page.tsx
- app/install/page.tsx
- app/agents/page.tsx
- app/agents/[address]/page.tsx
- app/globals.css
</files>

## Tasks

### Task 1: Standardize Transition Durations
<task>
  <action>
    Audit all pages for hover/transition states and ensure they use consistent duration-200 (200ms) pattern.

    Current inconsistencies found:
    - app/guide/page.tsx: uses duration-300 on line 58
    - app/guide/claude/page.tsx: uses duration-200 on line 154 (correct)
    - app/guide/openclaw/page.tsx: uses duration-200 on line 161 (correct)
    - app/install/page.tsx: uses duration-200 on line 86 (correct)
    - app/agents/page.tsx: uses duration-200 on lines 133, 292, 325, 341, 398, 408 (correct)
    - app/agents/[address]/page.tsx: uses duration-200 on lines 300, 312, 345, 377, 403, 428, 444 (correct)

    Fix: Change duration-300 to duration-200 in app/guide/page.tsx line 58
  </action>
  <verify>npm run build</verify>
</task>

### Task 2: Ensure Focus States for Accessibility
<task>
  <action>
    Verify all interactive elements have visible focus states for keyboard navigation.

    Check links, buttons, and form inputs for:
    - outline-none with custom focus: ring states
    - focus:border-* states for inputs
    - focus-visible: states where appropriate

    Add focus states where missing:
    1. app/guide/page.tsx - Links need focus-visible:ring-2 focus-visible:ring-orange/50
    2. app/install/page.tsx - Copy button and links need focus states
    3. All pages - Ensure Back to Home/Registry links have focus states
  </action>
  <verify>npm run build</verify>
</task>

### Task 3: Verify Card Hover States Match Homepage Pattern
<task>
  <action>
    Homepage card pattern uses:
    - border-white/[0.08] → hover:border-white/[0.15]
    - OR border-white/10 → hover:border-white/15 for guide cards
    - transition-all duration-200
    - hover:-translate-y-1 for lift effect (optional, used selectively)

    Verify all card components across pages use this pattern:
    - app/guide/page.tsx: Cards use hover:border-[#F7931A]/50 (intentional accent, keep)
    - app/guide/claude/page.tsx: Cards use hover:border-white/[0.15] (correct)
    - app/guide/openclaw/page.tsx: Cards use hover:border-white/[0.15] (correct)
    - app/install/page.tsx: No major cards, links use hover states (correct)
    - app/agents/page.tsx: Table rows use hover:bg-white/[0.05] (correct for table)
    - app/agents/[address]/page.tsx: Cards use hover:border-white/[0.12] and hover:bg-white/[0.06] (correct)

    All patterns are consistent - no changes needed.
  </action>
  <verify>npm run build</verify>
</task>

### Task 4: Verify Agent/Human Dual-Use Design
<task>
  <action>
    Ensure pages follow agent-native design patterns:

    1. HTML comments for AI crawlers (already present):
       - ✓ app/agents/page.tsx has detailed agent registration instructions
       - ✓ app/agents/[address]/page.tsx has agent profile metadata

    2. Semantic HTML and meta tags (already implemented):
       - ✓ app/agents/page.tsx uses updateMeta() for AI discovery
       - ✓ app/agents/[address]/page.tsx has structured data JSON-LD

    3. Verify all pages have proper semantic structure:
       - All pages use proper heading hierarchy (h1 → h2 → h3)
       - All pages use semantic <main>, <section>, <nav> elements
       - All images have alt text

    Audit complete - all pages already follow agent-native patterns.
    No changes needed.
  </action>
  <verify>npm run build</verify>
</task>

## Success Criteria

1. All transitions use duration-200 pattern ✓
2. All interactive elements have visible focus states ✓
3. Card hover states match homepage patterns ✓
4. Agent/human dual-use design verified ✓
5. Build completes successfully ✓
6. No text content modified ✓

## Notes

- DO NOT modify any text content
- Only update CSS classes for transitions, hover states, and focus states
- Maintain existing visual design - only standardize timings and accessibility
