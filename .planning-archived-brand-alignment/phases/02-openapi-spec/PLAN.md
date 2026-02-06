# Phase 2: OpenAPI Spec and API Documentation

Create a machine-readable OpenAPI 3.1 specification so agents can understand and call the registration and agents endpoints without human help.

```xml
<plan>
  <goal>
    Serve an OpenAPI 3.1 JSON spec at /api/openapi.json describing POST /api/register
    and GET /api/agents with full request/response schemas. Update llms.txt, llms-full.txt,
    and agent.json to cross-reference the new spec. Add tests for the OpenAPI endpoint.
  </goal>

  <context>
    ## What Phase 1 Built

    - `app/robots.ts` — robots.txt (disallows /api/)
    - `app/sitemap.ts` — sitemap.xml
    - `app/.well-known/agent.json/route.ts` — A2A Agent Card
    - `public/llms.txt` — spec-compliant llmstxt.org index
    - `app/llms-full.txt/route.ts` — full documentation as text/plain
    - Tests in `__tests__/` directories adjacent to source

    ## API Routes to Document

    ### POST /api/register (app/api/register/route.ts)
    - Request body: { bitcoinSignature: string, stacksSignature: string, description?: string }
    - description max 280 chars, trimmed
    - Success 200: { success: true, agent: { stxAddress, btcAddress, displayName, description, bnsName?, verifiedAt } }
    - Error 400: { error: string } — missing/invalid signatures or description too long
    - Error 409: { error: string } — address already registered
    - Error 500: { error: string } — server error

    ### GET /api/agents (app/api/agents/route.ts)
    - No parameters
    - Success 200: { agents: Array<{ stxAddress, btcAddress, stxPublicKey, btcPublicKey, displayName?, description?, bnsName?, verifiedAt }> }
    - Error 500: { error: string }

    ## Patterns to Follow
    - Route handlers return NextResponse with Cache-Control headers (1h client, 1d edge)
    - Tests use vitest in `__tests__/` adjacent to source
    - Files use TypeScript
  </context>

  <!-- ================================================================ -->
  <!-- TASK 1: Create OpenAPI 3.1 spec route handler                    -->
  <!-- ================================================================ -->
  <task id="1">
    <name>Create OpenAPI 3.1 spec at /api/openapi.json</name>
    <files>
      app/api/openapi.json/route.ts (new)
    </files>
    <action>
      Create a Next.js route handler at `app/api/openapi.json/route.ts` that serves
      an OpenAPI 3.1.0 JSON spec describing both API endpoints.

      The spec must include:
      - OpenAPI version 3.1.0
      - Info block with title, description, version
      - Server URL (https://aibtc.com)
      - Paths for POST /api/register and GET /api/agents
      - Full request/response schemas with all fields, types, and descriptions
      - Error response schemas for 400, 409, 500
      - The constant sign message documented in description
      - Cache headers matching other route handlers (1h client, 1d edge)
    </action>
    <verify>
      - Route handler exports GET function
      - Response is valid JSON with content-type application/json
      - openapi field is "3.1.0"
      - Both /api/register and /api/agents paths are documented
      - Request/response schemas match actual API behavior
    </verify>
    <done>
      GET /api/openapi.json returns a valid OpenAPI 3.1.0 spec with full schemas
      for both API endpoints, served with proper cache headers.
    </done>
  </task>

  <!-- ================================================================ -->
  <!-- TASK 2: Update discovery files to reference OpenAPI spec          -->
  <!-- ================================================================ -->
  <task id="2">
    <name>Update llms.txt, llms-full.txt, and agent.json to reference OpenAPI spec</name>
    <files>
      public/llms.txt (edit)
      app/llms-full.txt/route.ts (edit)
      app/.well-known/agent.json/route.ts (edit)
    </files>
    <action>
      - Add OpenAPI spec link to llms.txt Documentation section
      - Add OpenAPI spec reference to llms-full.txt API documentation section
      - Add openApiUrl field to agent.json Agent Card
    </action>
    <verify>
      - llms.txt contains link to /api/openapi.json
      - llms-full.txt mentions /api/openapi.json
      - agent.json includes openApiUrl field
      - Existing tests still pass
    </verify>
    <done>
      All discovery files cross-reference the new OpenAPI spec endpoint.
    </done>
  </task>

  <!-- ================================================================ -->
  <!-- TASK 3: Add tests for OpenAPI endpoint                           -->
  <!-- ================================================================ -->
  <task id="3">
    <name>Add tests for the OpenAPI endpoint</name>
    <files>
      app/api/openapi.json/__tests__/route.test.ts (new)
    </files>
    <action>
      Create comprehensive tests that validate:
      - Response status, content-type, cache headers
      - OpenAPI version is 3.1.0
      - Both paths are present with correct methods
      - Request schemas match actual API (required fields, types)
      - Response schemas match actual API (field names, types)
      - Error responses are documented
      - Info block has required fields
    </action>
    <verify>
      All tests pass with `npm test`.
      No regressions in existing tests.
    </verify>
    <done>
      Full test coverage for the OpenAPI endpoint validating spec structure and accuracy.
    </done>
  </task>
</plan>
```

## Summary of Changes

| File | Type | URL Served |
|------|------|------------|
| `app/api/openapi.json/route.ts` | New (route handler) | `/api/openapi.json` |
| `public/llms.txt` | Edit | `/llms.txt` |
| `app/llms-full.txt/route.ts` | Edit | `/llms-full.txt` |
| `app/.well-known/agent.json/route.ts` | Edit | `/.well-known/agent.json` |
| `app/api/openapi.json/__tests__/route.test.ts` | New (test) | N/A |
