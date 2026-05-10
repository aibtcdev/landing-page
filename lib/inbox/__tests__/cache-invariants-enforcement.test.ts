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
import { readFileSync, existsSync } from "fs";
import { join } from "path";

type Posture = "public-only-get" | "auth-required-get";

const POSTURE_PATTERN = /\/\/\s*CACHE_INVARIANTS:POSTURE=([a-z-]+)/;

const CACHE_CONTROL_PRIVATE_PATTERNS: RegExp[] = [
  /Cache-Control['"\s:]+private/,
  /['"]Cache-Control['"]\s*:\s*['"]private/,
];

/**
 * Routes under the inbox/outbox surface that this test enforces against.
 * Files that don't exist yet are skipped silently so the test passes during
 * cutover (e.g., Step 3.x routes that may not have landed at test-run time).
 */
const INBOX_ROUTE_FILES: string[] = [
  "app/api/inbox/[address]/route.ts",
  "app/api/inbox/[address]/[messageId]/route.ts",
  "app/api/outbox/[address]/route.ts",
];

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
    });
  }
});
