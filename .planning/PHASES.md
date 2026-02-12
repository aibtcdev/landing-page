# Phases

## Phase 1: Create heartbeat library and API route
Goal: Build `/api/heartbeat` for check-ins at Level 1+ and orientation context. Extract check-in logic from `/api/paid-attention` so that endpoint only handles task responses.
Status: `completed`
Scope:
- Create `lib/heartbeat/` module (types, constants, validation, kv-helpers, index)
- Create `app/api/heartbeat/route.ts` — GET (self-documenting + personalized orientation), POST (signed check-in, Level 1+ required)
- Replace check-in handling in `app/api/paid-attention/route.ts` POST with a **410 Gone breadcrumb**: when `type: "check-in"` is detected, return migration instructions pointing to `/api/heartbeat` and telling the agent to fetch + persist `llms.txt`
- Move check-in KV helpers from `lib/attention/` to `lib/heartbeat/`, re-export for backward compat
- Add heartbeat to middleware matcher and create CLI route

Issues: #107

Commits:
- 4bcb81e: feat(heartbeat): create heartbeat library module
- 2b2adae: feat(api): add /api/heartbeat endpoint
- 7df2a0c: refactor(api): replace check-in in paid-attention with 410 Gone breadcrumb
- 100e92f: feat(middleware): add heartbeat CLI route support

## Phase 2: Update discovery docs and llms.txt content
Goal: Update all 4 discovery docs to reference `/api/heartbeat` as the post-registration orientation step, add "save this as memory" instruction to llms.txt.
Status: `completed`
Scope:
- Update `app/llms.txt/route.ts` — reorder journey (heartbeat before paid-attention), add memory persistence block
- Update `app/llms-full.txt/route.ts` — add Heartbeat section, remove check-in from Paid Attention section
- Update `app/.well-known/agent.json/route.ts` — add heartbeat skill, update onboarding steps
- Update `app/api/openapi.json/route.ts` — add heartbeat endpoints, update paid-attention spec
- Update `CLAUDE.md` with new endpoint and architecture

Issues: #102, #107

Commits:
- 573e8bf: docs(llms.txt): add memory instruction, reorder journey with heartbeat phase
- 033ceb3: docs(llms-full.txt): add Heartbeat section, remove check-in from Paid Attention
- da8fd44: docs(agent.json): add heartbeat skill and onboarding step
- 3ddc59e: docs(openapi): add /api/heartbeat path, update paid-attention spec
- 29f2f09: docs(CLAUDE): add Heartbeat System section, update Paid Attention

## Phase 3: Update UX pages and verify end-to-end
Goal: Update browser-facing pages, add heartbeat UX page, verify full flow (build, middleware routing, API responses).
Status: `pending`
Scope:
- Create `app/heartbeat/page.tsx` — heartbeat dashboard for orientation status
- Update `app/paid-attention/` pages to remove check-in UI/instructions
- Update landing page journey if it references heartbeat steps
- Run `npm run build` to verify no broken imports
- Verify middleware routing and API responses

Issues: #107, #102
