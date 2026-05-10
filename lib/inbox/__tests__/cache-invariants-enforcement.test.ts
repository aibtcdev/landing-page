/**
 * Structural enforcement of cache-key invariants from lib/inbox/CACHE_INVARIANTS.md.
 *
 * Catches the agent-news#802 unauthenticated-HIT bug class via lint rather than
 * runtime, by requiring each route file under /api/inbox/* and /api/outbox/* to
 * declare its cache-invariant posture via a magic comment marker, then asserting
 * the declared posture is consistent with the file contents (Invariant 2).
 *
 * ## Why a posture marker instead of auth-import detection
 *
 * These route files mix multiple HTTP methods (GET / POST / PATCH) where POST
 * and PATCH legitimately import `verifyBitcoinSignature` for sender auth on
 * write paths, but the GET handler is public-only. A string-match test that
 * fires on "any auth import + no Cache-Control: private" would false-positive
 * on those mixed-handler files. The magic-comment marker lets each route file
 * declare its GET-path posture explicitly, which is the load-bearing invariant
 * (agent-news#802 was a GET-side cache HIT before auth, not a POST issue).
 *
 * ## Marker format
 *
 * Each enforced route file MUST include a single line of the form:
 *
 *   // CACHE_INVARIANTS:POSTURE=<value>
 *
 * where `<value>` is one of:
 *
 *   - `public-only-get`   GET handler has no auth gate; Invariants 1+2+3 are
 *                         satisfied trivially. POST/PATCH/DELETE may still
 *                         use auth — that's fine; the agent-news#802 bug class
 *                         only applies to GET-side cache HITs.
 *   - `auth-required-get` GET handler has an auth gate (BIP-322 / SIP-018 /
 *                         session). MUST set `Cache-Control: private, no-store`
 *                         somewhere in the file for Invariant 2 compliance.
 *
 * When a route's GET handler posture changes (e.g., adding auth to a previously
 * public GET), update the marker AND add `Cache-Control: private, no-store`
 * on the auth'd response paths in the same PR.
 *
 * See: lib/inbox/CACHE_INVARIANTS.md (Invariants 1, 2, 3)
 * See: https://github.com/aibtcdev/landing-page/issues/723 (this enforcement)
 * See: https://github.com/aibtcdev/agent-news/issues/802 (incident class)
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

type Posture = "public-only-get" | "auth-required-get";

/**
 * Matches the posture marker in either line-comment or block-comment form so
 * the marker survives prettier/eslint reflows that convert `// ...` into
 * `/* ... *\/` (or vice versa) and JSDoc-style headers.
 */
const POSTURE_PATTERN =
  /(?:\/\/|\/\*\*?|\*)\s*CACHE_INVARIANTS:POSTURE=([a-z-]+)/;

/**
 * Patterns that match `Cache-Control: private` (or `private, no-store` etc.)
 * across the forms Next.js route handlers commonly use to set the header.
 *
 * Coverage:
 *   - Object-literal header maps:   `{ 'Cache-Control': 'private, no-store' }`
 *     (used by `NextResponse.json(body, { headers: {...} })` and
 *     `new Headers({...})`) — matched by patterns 1 and 2.
 *   - `Headers#set` method calls:    `headers.set('Cache-Control', 'private, ...')`
 *     — matched by patterns 3 and 4.
 *   - Doc/comment forms:             `// Cache-Control: private`
 *     — matched by pattern 1.
 *
 * Adding a new form? Add a positive case to the "pattern coverage" describe
 * block below so the form is locked in by a unit test, not just by reading.
 */
const CACHE_CONTROL_PRIVATE_PATTERNS: RegExp[] = [
  /Cache-Control['"\s:]+private/,
  /['"]Cache-Control['"]\s*:\s*['"]private/,
  /headers\.set\s*\(\s*['"]Cache-Control['"]\s*,\s*['"]private/,
  /['"]Cache-Control['"]\s*,\s*['"]private/,
];

/**
 * Routes under the inbox/outbox surface that this test enforces against.
 * Files that don't exist yet are skipped silently so the test passes during
 * cutover (e.g., Step 3.x routes that may not have landed at test-run time).
 *
 * This list is BOTH the source of truth for the per-file enforcement loop AND
 * cross-checked against a glob discovery so a newly added `route.ts` under
 * `app/api/inbox/**` or `app/api/outbox/**` fails closed if the list isn't
 * updated. See the "allowlist must cover discovered routes" test below.
 */
const INBOX_ROUTE_FILES: string[] = [
  "app/api/inbox/[address]/route.ts",
  "app/api/inbox/[address]/[messageId]/route.ts",
  "app/api/outbox/[address]/route.ts",
];

/**
 * Auth/session tokens that — if they appear in a GET handler's body —
 * indicate the GET path is auth-gated and the file's posture marker
 * MUST be `auth-required-get` (not `public-only-get`).
 *
 * Scoped to the GET handler block (not the whole file) so that PATCH/POST
 * write paths legitimately using these tokens for sender auth don't trigger
 * a false-positive on a public-only-GET file. See `extractGetHandlerScope`.
 */
const AUTH_TOKENS_IN_GET: RegExp[] = [
  /\bverifyBitcoinSignature\b/,
  /\bBIP[_-]?322\b/i,
  /\bSIP[_-]?018\b/i,
  /\bgetServerSession\b/,
  /\brequireAuth\b/,
];

/**
 * Extract the body of an `export async function GET(...)` declaration so
 * stale-marker checks can scan auth-token usage scoped to the GET handler
 * rather than the whole file (avoids the mixed-handler false-positive the
 * posture-marker design was created to dodge).
 *
 * Strategy: locate `export async function GET(`, then return everything from
 * there up to the next `export async function <X>(` in the file (or EOF).
 * This treats helper functions defined between the GET handler and the next
 * route handler as part of the GET scope, which is the correct behavior —
 * a helper called from GET that imports auth tokens still means the GET path
 * is auth-gated.
 */
function extractGetHandlerScope(content: string): string | null {
  const handlerRegex =
    /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;
  const handlers: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = handlerRegex.exec(content)) !== null) {
    handlers.push({ name: m[1], index: m.index });
  }
  const getIdx = handlers.findIndex((h) => h.name === "GET");
  if (getIdx === -1) return null;
  const start = handlers[getIdx].index;
  const nextHandler = handlers[getIdx + 1];
  const end = nextHandler ? nextHandler.index : content.length;
  return content.slice(start, end);
}

/**
 * Strip string / template literals from source so the auth-token scan doesn't
 * false-positive on docstrings that mention auth tokens by name.
 *
 * Real-world reproducer: the outbox route's `GET` handler returns a 405
 * Method-Not-Allowed body that documents the POST endpoint's expected request
 * shape, including the string `"signature: BIP-137/BIP-322 signature"`. A
 * bare-substring scan flags that as a stale marker; stripping string literals
 * first eliminates the false-positive.
 *
 * Approach is intentionally regex-based (not a TypeScript parser): each quoted
 * form gets collapsed to its empty delimiter pair, preserving line/column
 * structure for any future scanners that care.
 */
function stripStringLiterals(code: string): string {
  return code
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/**
 * Returns the first auth-token pattern that fires inside the GET handler's
 * lexical scope (after string-literal stripping), or null if none do — or
 * null if the file has no GET handler.
 *
 * Single source of truth: both the public boolean helper and the structural
 * enforcement test against real files MUST go through this function so a
 * future drift between "what the helper-unit-tests check" and "what the
 * structural-test-against-real-files checks" can't reopen the same bug
 * class commit `d457ecb` introduced.
 */
function findAuthTokenInGetHandler(content: string): RegExp | null {
  const scope = extractGetHandlerScope(content);
  if (scope === null) return null;
  const scrubbed = stripStringLiterals(scope);
  return AUTH_TOKENS_IN_GET.find((p) => p.test(scrubbed)) ?? null;
}

function getHandlerHasAuthToken(content: string): boolean {
  return findAuthTokenInGetHandler(content) !== null;
}

/**
 * Walk a directory tree and return every `route.ts` (or `route.tsx`) under it.
 * Excludes directories with a leading underscore (Next.js convention for
 * private/internal subroutes that should not be part of the public surface),
 * dotfiles, and `node_modules` for defense-in-depth.
 *
 * Used to fail-closed on new inbox/outbox route files that haven't been added
 * to `INBOX_ROUTE_FILES` — the Cairn+Forge convergent gap on #726.
 */
function discoverRouteFiles(absRoot: string): string[] {
  if (!existsSync(absRoot)) return [];
  const out: string[] = [];
  const stack: string[] = [absRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.startsWith(".") || entry.startsWith("_") || entry === "node_modules") {
        continue;
      }
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        stack.push(full);
      } else if (entry === "route.ts" || entry === "route.tsx") {
        out.push(full);
      }
    }
  }
  return out;
}

function extractPosture(content: string): Posture | null {
  const match = content.match(POSTURE_PATTERN);
  if (!match) return null;
  const value = match[1];
  if (value === "public-only-get" || value === "auth-required-get") {
    return value;
  }
  return null;
}

function hasCacheControlPrivate(content: string): boolean {
  return CACHE_CONTROL_PRIVATE_PATTERNS.some((p) => p.test(content));
}

describe("hasCacheControlPrivate pattern coverage", () => {
  // Each case below documents a real Next.js form for setting Cache-Control
  // and asserts the pattern set matches it. When a new form needs to be
  // accepted, add a case here BEFORE adding the pattern — that pins the
  // behavior to a test instead of relying on regex inspection.

  it("matches NextResponse.json headers object literal", () => {
    const src = `return NextResponse.json(body, { headers: { "Cache-Control": "private, no-store" } });`;
    expect(hasCacheControlPrivate(src)).toBe(true);
  });

  it("matches single-quoted object-literal form", () => {
    const src = `new Headers({ 'Cache-Control': 'private, max-age=0' })`;
    expect(hasCacheControlPrivate(src)).toBe(true);
  });

  it("matches headers.set() method call", () => {
    const src = `response.headers.set('Cache-Control', 'private, no-store');`;
    expect(hasCacheControlPrivate(src)).toBe(true);
  });

  it("matches headers.set() with double quotes and extra whitespace", () => {
    const src = `response.headers.set( "Cache-Control" , "private, no-store" );`;
    expect(hasCacheControlPrivate(src)).toBe(true);
  });

  it("matches doc/comment form", () => {
    const src = `// Cache-Control: private, no-store on auth'd response paths`;
    expect(hasCacheControlPrivate(src)).toBe(true);
  });

  it("does not match a public Cache-Control header", () => {
    const src = `response.headers.set('Cache-Control', 'public, max-age=3600');`;
    expect(hasCacheControlPrivate(src)).toBe(false);
  });

  it("does not match an unrelated 'private' usage", () => {
    const src = `// the inbox list endpoint is private to the recipient`;
    expect(hasCacheControlPrivate(src)).toBe(false);
  });

  it("matches Headers array-of-arrays constructor form", () => {
    const src = `new Headers([['Cache-Control', 'private, no-store']])`;
    expect(hasCacheControlPrivate(src)).toBe(true);
  });
});

describe("extractGetHandlerScope + getHandlerHasAuthToken", () => {
  it("isolates the GET handler from a PATCH handler in the same file", () => {
    const mixed = `
      import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
      export async function GET(req) {
        return NextResponse.json({ ok: true });
      }
      export async function PATCH(req) {
        const r = verifyBitcoinSignature(sig, msg, addr);
        return NextResponse.json({ r });
      }
    `;
    expect(getHandlerHasAuthToken(mixed)).toBe(false);
  });

  it("detects auth tokens inside the GET handler scope (stale-marker scenario)", () => {
    const staleStyle = `
      import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
      export async function GET(req) {
        const r = verifyBitcoinSignature(sig, msg, addr);
        if (!r.valid) return NextResponse.json({ error: "auth" }, { status: 401 });
        return NextResponse.json({ ok: true });
      }
    `;
    expect(getHandlerHasAuthToken(staleStyle)).toBe(true);
  });

  it("returns false when there is no GET handler in the file", () => {
    const writeOnly = `
      import { verifyBitcoinSignature } from "@/lib/bitcoin-verify";
      export async function POST(req) { return new Response(); }
    `;
    expect(getHandlerHasAuthToken(writeOnly)).toBe(false);
  });

  it("detects BIP-322 token form in GET handler", () => {
    const src = `
      export async function GET(req) {
        const ok = await BIP_322.verify(sig, msg);
        return ok ? new Response() : new Response(null, { status: 401 });
      }
    `;
    expect(getHandlerHasAuthToken(src)).toBe(true);
  });

  it("detects getServerSession in GET handler", () => {
    const src = `
      export async function GET(req) {
        const session = await getServerSession();
        if (!session) return new Response(null, { status: 401 });
        return new Response();
      }
    `;
    expect(getHandlerHasAuthToken(src)).toBe(true);
  });

  it("does NOT false-positive on auth tokens appearing inside string literals (docstring/error)", () => {
    // Real-world shape: outbox 405 response documents the POST endpoint's
    // expected request body via a JSON description string that mentions
    // "BIP-322 signature" / "verifyBitcoinSignature". The string is data,
    // not code — must not flag the marker as stale.
    const docstringFalsePositive = `
      export async function GET(req) {
        return NextResponse.json({
          allowed: ["POST"],
          documentation: {
            signature: "string — BIP-137/BIP-322 signature (base64 or 130-char hex)",
            note: "POST handler uses verifyBitcoinSignature for sender auth",
          },
        }, { status: 405 });
      }
    `;
    expect(getHandlerHasAuthToken(docstringFalsePositive)).toBe(false);
  });

  it("detects auth tokens even when surrounded by adjacent string literals", () => {
    // Token in code is real; tokens in adjacent strings are doc/data.
    const realAuthAdjacentToDocs = `
      export async function GET(req) {
        const r = verifyBitcoinSignature(sig, msg, addr);
        return NextResponse.json({
          docs: "auth uses BIP-322 — see https://example.com",
        });
      }
    `;
    expect(getHandlerHasAuthToken(realAuthAdjacentToDocs)).toBe(true);
  });
});

describe("CACHE_INVARIANTS structural enforcement", () => {
  for (const relPath of INBOX_ROUTE_FILES) {
    describe(relPath, () => {
      const fullPath = join(process.cwd(), relPath);
      const fileExists = existsSync(fullPath);
      const content = fileExists ? readFileSync(fullPath, "utf-8") : "";

      it("must declare CACHE_INVARIANTS:POSTURE marker", () => {
        if (!fileExists) return;
        const posture = extractPosture(content);
        expect(
          posture,
          `${relPath} is missing the CACHE_INVARIANTS:POSTURE marker. ` +
            `Add a comment of the form: ` +
            `\`// CACHE_INVARIANTS:POSTURE=public-only-get\` or ` +
            `\`// CACHE_INVARIANTS:POSTURE=auth-required-get\`. ` +
            `See lib/inbox/CACHE_INVARIANTS.md for the posture definitions.`
        ).not.toBeNull();
      });

      it("if posture=auth-required-get, must set Cache-Control: private (Invariant 2)", () => {
        if (!fileExists) return;
        const posture = extractPosture(content);
        if (posture !== "auth-required-get") return;
        expect(
          hasCacheControlPrivate(content),
          `${relPath} declares posture=auth-required-get but does not set ` +
            `Cache-Control: private. Invariant 2 violation ` +
            `(see lib/inbox/CACHE_INVARIANTS.md). Either add ` +
            `\`Cache-Control: private, no-store\` on the auth'd response paths ` +
            `OR change the posture marker to public-only-get if the GET handler ` +
            `is in fact public.`
        ).toBe(true);
      });

      // Stale-marker check — closes the false-negative the marker design
      // would otherwise have. If a future PR adds auth gating to a GET
      // handler in a file that still says `public-only-get`, this test
      // forces an update to the marker (or removal of the auth gate).
      // Scoped to GET-handler body so PATCH/POST auth imports are not
      // treated as GET-side auth.
      it("if posture=public-only-get, GET handler must NOT contain auth tokens (stale-marker)", () => {
        if (!fileExists) return;
        const posture = extractPosture(content);
        if (posture !== "public-only-get") return;
        // Goes through the SAME findAuthTokenInGetHandler used by the unit
        // helper — single source of truth so a future drift in scan logic
        // can't make the helper-unit-tests pass while the structural-test-
        // against-real-files quietly diverges (the d457ecb bug class).
        const matchedToken = findAuthTokenInGetHandler(content);
        expect(
          matchedToken,
          `${relPath} declares posture=public-only-get but the GET handler ` +
            `body contains an auth/session token matching ${matchedToken?.source} ` +
            `(after stripping string literals). ` +
            `Either update the marker to auth-required-get and add ` +
            `\`Cache-Control: private, no-store\` on the auth'd response paths, ` +
            `OR remove the auth gate from the GET handler. ` +
            `See lib/inbox/CACHE_INVARIANTS.md (Invariant 2, public-only-get definition) ` +
            `and https://github.com/aibtcdev/agent-news/issues/802 for the bug class.`
        ).toBeNull();
      });
    });
  }

  // Fail-closed check — the manual `INBOX_ROUTE_FILES` allowlist must cover
  // every `route.ts`/`route.tsx` under `app/api/inbox/**` and
  // `app/api/outbox/**`. If a new route is added without being listed here,
  // the cache-invariant enforcement would silently not apply to it. Discovery
  // excludes `_internal/` and other underscore-prefixed dirs (Next.js
  // convention for private/non-public-surface helpers).
  it("INBOX_ROUTE_FILES allowlist must cover all discovered routes under api/inbox + api/outbox", () => {
    const cwd = process.cwd();
    const discovered = [
      ...discoverRouteFiles(join(cwd, "app/api/inbox")),
      ...discoverRouteFiles(join(cwd, "app/api/outbox")),
    ]
      .map((p) => relative(cwd, p))
      .sort();

    const allowlist = new Set(INBOX_ROUTE_FILES);
    const missing = discovered.filter((p) => !allowlist.has(p));

    expect(
      missing,
      `New route files were discovered under app/api/inbox or app/api/outbox ` +
        `that are NOT in INBOX_ROUTE_FILES: ${missing.join(", ")}. ` +
        `Add them to the allowlist in this test file so the cache-invariant ` +
        `enforcement applies to them. (If the route is genuinely outside the ` +
        `cache-key invariant surface, put it under a leading-underscore ` +
        `directory like _internal/ to exclude it from discovery.)`
    ).toEqual([]);
  });
});
