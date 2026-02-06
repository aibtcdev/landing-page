# Phase 4: Mobile-First Responsive Design Verification

## Goal
Verify all pages have proper mobile-first responsive breakpoints and touch-friendly interactions. Fix any mobile UX issues discovered during audit.

## Files to Audit

<files>
app/page.tsx
app/guide/page.tsx
app/guide/claude/page.tsx
app/guide/openclaw/page.tsx
app/install/page.tsx
app/agents/page.tsx
app/agents/[address]/page.tsx
</files>

## Tasks

<task id="1">
  <action>
    Audit app/page.tsx (homepage) for mobile responsiveness:
    - Verify all tap targets are at least 44x44px (buttons, links, copy buttons)
    - Check padding/margins on mobile (max-md) are appropriate (not too tight)
    - Verify no horizontal scrolling on mobile viewports
    - Check phone mockup scales properly on mobile
    - Verify agent cards grid works on mobile
    - Ensure footer links are touch-friendly on mobile
  </action>
  <files>app/page.tsx</files>
  <verify>Test on mobile viewport (375px width) - all interactions work, no horizontal scroll</verify>
</task>

<task id="2">
  <action>
    Audit app/guide/page.tsx for mobile responsiveness:
    - Verify guide cards stack properly on mobile
    - Check tap targets for cards are adequate
    - Verify padding is appropriate on mobile
    - Ensure no horizontal overflow
  </action>
  <files>app/guide/page.tsx</files>
  <verify>Test on mobile viewport - cards stack cleanly, all text readable</verify>
</task>

<task id="3">
  <action>
    Audit app/guide/claude/page.tsx for mobile responsiveness:
    - Verify step cards work on mobile
    - Check code block overflow handling
    - Ensure copy buttons are touch-friendly
    - Verify conversation UI is readable on mobile
    - Check link buttons in step headers work on mobile
  </action>
  <files>app/guide/claude/page.tsx</files>
  <verify>Test on mobile viewport - all steps readable, code blocks scroll horizontally if needed</verify>
</task>

<task id="4">
  <action>
    Audit app/guide/openclaw/page.tsx for mobile responsiveness:
    - Verify step cards adapt to mobile
    - Check command/output blocks on mobile
    - Ensure copy buttons are touch-friendly
    - Verify mobile link visibility
  </action>
  <files>app/guide/openclaw/page.tsx</files>
  <verify>Test on mobile viewport - all steps work, terminal output readable</verify>
</task>

<task id="5">
  <action>
    Audit app/install/page.tsx for mobile responsiveness:
    - Verify installer cards stack properly
    - Check code snippets fit mobile viewport
    - Ensure copy buttons are touch-friendly
    - Verify "View full guide" links are tappable
  </action>
  <files>app/install/page.tsx</files>
  <verify>Test on mobile viewport - cards readable, code doesn't overflow</verify>
</task>

<task id="6">
  <action>
    Audit app/agents/page.tsx for mobile responsiveness:
    - Verify table is responsive (hides columns on mobile appropriately)
    - Check registration CTA banner on mobile
    - Ensure registration steps are readable
    - Verify documentation links are touch-friendly
    - Check empty state works on mobile
  </action>
  <files>app/agents/page.tsx</files>
  <verify>Test on mobile viewport - table works, registration flow is clear</verify>
</task>

<task id="7">
  <action>
    Audit app/agents/[address]/page.tsx for mobile responsiveness:
    - Verify profile layout works on mobile
    - Check address labels and badges
    - Ensure claim section is usable on mobile
    - Verify tweet/copy buttons are touch-friendly
    - Check all interactive elements meet 44x44px minimum
  </action>
  <files>app/agents/[address]/page.tsx</files>
  <verify>Test on mobile viewport - profile readable, claim flow works</verify>
</task>

## Success Criteria
- All tap targets (buttons, links) are at least 44x44px on mobile
- No horizontal scrolling occurs on 375px viewport width
- Padding and margins are comfortable on mobile (not cramped)
- Text remains readable at mobile sizes
- All interactive elements are easily tappable
- Tables/grids adapt appropriately for mobile
- Code blocks scroll horizontally when needed (not causing page overflow)
- Mobile navigation works smoothly
- NO text content is modified - only styling adjustments

## Testing Approach
For each task:
1. Read the file and identify potential mobile UX issues
2. Look for:
   - Small tap targets (< 44x44px)
   - Insufficient padding on mobile
   - Elements that could cause horizontal scroll
   - Text that's too small on mobile
   - Buttons/links without proper spacing
3. Fix issues by:
   - Adding min-w-[44px] min-h-[44px] to small interactive elements
   - Increasing padding on max-md breakpoints
   - Adding overflow-x-hidden where needed
   - Adjusting grid layouts for mobile
4. Verify no visual changes on desktop
5. Commit changes with descriptive message

## Notes
- Mobile-first means base styles are for mobile, then md: and lg: for larger screens
- Current breakpoints: max-md (< 768px), max-lg (< 1024px)
- Touch target minimum: 44x44px (WCAG 2.1 AAA)
- The site already uses max-md extensively - verify these are correct
- Do NOT modify text content - only adjust spacing, sizing, layouts
