# Phase 3: Agent Onboarding Page and Structured Data

Create a guided onboarding page at /onboard with JSON-LD structured data for search engines and agent comprehension.

```xml
<plan>
  <goal>
    Create a dual-audience onboarding page at /onboard that guides both humans
    (rendered HTML) and AI agents (JSON-LD structured data) through the AIBTC
    registration process. Update discovery files (sitemap, llms.txt, llms-full.txt,
    agent.json) to reference the new page. Add tests.
  </goal>

  <context>
    ## What Previous Phases Built

    Phase 1 — Agent Discovery Layer:
    - app/robots.ts — robots.txt
    - app/sitemap.ts — sitemap.xml (3 entries: /, /agents, /llms.txt)
    - app/.well-known/agent.json/route.ts — A2A Agent Card
    - public/llms.txt — spec-compliant llmstxt.org index
    - app/llms-full.txt/route.ts — full documentation as text/plain

    Phase 2 — OpenAPI Spec:
    - app/api/openapi.json/route.ts — OpenAPI 3.1 spec
    - Cross-references from llms.txt, llms-full.txt, agent.json

    ## Styling Patterns (from agents page)

    - Client components use "use client" directive
    - Import Navbar component
    - Animated background div with gradient blobs (fixed, -z-10)
    - Main content in relative container with max-w-[1200px] mx-auto
    - Brand colors: orange (#F7931A), blue (#7DA2FF), purple (#A855F7)
    - Dark theme: bg-black, text-white, borders with white/[0.06-0.1]
    - Cards: rounded-xl border border-white/[0.06-0.1] bg-white/[0.02-0.05]
    - Code blocks: bg-white/5 text-orange/60 rounded px-1.5 py-0.5

    ## JSON-LD Strategy

    Use schema.org HowTo type for the onboarding steps. This is ideal because:
    - Google explicitly supports HowTo structured data
    - Maps naturally to the step-by-step onboarding flow
    - Agents can parse the JSON-LD to understand the registration process
    - Embeds in a <script type="application/ld+json"> tag

    ## Page Structure

    Server component (no client-side interactivity needed). Steps:
    1. Prerequisites — Get a wallet (MCP tools or OpenClaw)
    2. Create/unlock wallet
    3. Sign the message "Bitcoin will be the currency of AIs" with BTC and STX keys
    4. POST signatures to /api/register
    5. Verify registration via /api/agents
  </context>

  <!-- ================================================================ -->
  <!-- TASK 1: Create /onboard page with JSON-LD structured data        -->
  <!-- ================================================================ -->
  <task id="1">
    <name>Create /onboard page with JSON-LD structured data</name>
    <files>
      app/onboard/page.tsx (new)
    </files>
    <action>
      Create a Next.js page at app/onboard/page.tsx that:

      1. Exports metadata with title "Agent Onboarding" and description
      2. Includes JSON-LD HowTo structured data as a script tag in the page body
      3. Renders a human-readable onboarding guide with:
         - Navbar at the top
         - Animated background (matching agents page pattern)
         - Header with "Agent Onboarding" title
         - Prerequisites section
         - Numbered steps with code examples
         - Back link to home
      4. Is a server component (no "use client" needed for static content)
         - But imports Navbar which is a client component — that's fine,
           server components can import client components

      JSON-LD schema:
      ```json
      {
        "@context": "https://schema.org",
        "@type": "HowTo",
        "name": "Register as an AIBTC Agent",
        "description": "...",
        "step": [
          { "@type": "HowToStep", "name": "...", "text": "...", "url": "..." },
          ...
        ],
        "tool": [...],
        "totalTime": "PT10M"
      }
      ```
    </action>
    <verify>
      - Page renders at /onboard
      - JSON-LD script tag is present in the HTML
      - All 4 steps are visible
      - Styling matches the agents page
      - npm run lint passes
      - npm run build passes
    </verify>
    <done>
      /onboard page created with JSON-LD HowTo structured data and
      human-readable onboarding guide.
    </done>
  </task>

  <!-- ================================================================ -->
  <!-- TASK 2: Update sitemap and discovery files                       -->
  <!-- ================================================================ -->
  <task id="2">
    <name>Update sitemap and discovery files to reference /onboard</name>
    <files>
      app/sitemap.ts (edit)
      public/llms.txt (edit)
      app/llms-full.txt/route.ts (edit)
      app/.well-known/agent.json/route.ts (edit)
    </files>
    <action>
      - Add /onboard to sitemap.ts with priority 0.9, changeFrequency "monthly"
      - Add onboard link to llms.txt Setup section
      - Add onboard guide section to llms-full.txt
      - Add agent-onboarding skill to agent.json that references /onboard
    </action>
    <verify>
      - sitemap.ts includes /onboard entry
      - llms.txt references /onboard
      - llms-full.txt references /onboard
      - agent.json skills array includes onboarding skill
      - Existing tests still pass
    </verify>
    <done>
      All discovery files reference the new /onboard page.
    </done>
  </task>

  <!-- ================================================================ -->
  <!-- TASK 3: Add tests for the /onboard page                         -->
  <!-- ================================================================ -->
  <task id="3">
    <name>Add tests for the /onboard page</name>
    <files>
      app/onboard/__tests__/page.test.tsx (new)
    </files>
    <action>
      Create tests that validate:
      - Page exports metadata with correct title
      - Page component renders without error
      - JSON-LD data structure is valid HowTo schema
      - All onboarding steps are present in JSON-LD
      - JSON-LD includes required fields (name, description, step, tool)

      The test approach: since this is a server component, test the JSON-LD
      data structure directly by extracting it from the component or
      testing it as a separate constant/function.
    </action>
    <verify>
      All tests pass with `npm test`.
      No regressions in existing tests.
      npm run lint passes.
      npm run build passes.
    </verify>
    <done>
      Tests validate the JSON-LD structure and onboarding content.
    </done>
  </task>
</plan>
```

## Summary of Changes

| File | Type | URL Served |
|------|------|------------|
| `app/onboard/page.tsx` | New (page) | `/onboard` |
| `app/sitemap.ts` | Edit | `/sitemap.xml` |
| `public/llms.txt` | Edit | `/llms.txt` |
| `app/llms-full.txt/route.ts` | Edit | `/llms-full.txt` |
| `app/.well-known/agent.json/route.ts` | Edit | `/.well-known/agent.json` |
| `app/onboard/__tests__/page.test.tsx` | New (test) | N/A |
