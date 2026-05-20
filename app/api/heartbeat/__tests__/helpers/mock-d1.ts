/**
 * Shared D1 mock builder for the /api/heartbeat tests.
 *
 * Returns a `prepare(...).bind(...).run()` chain mock with the spy refs
 * exposed so individual tests can assert on argument shape (used by
 * `route.test.ts`) or simulate failure modes (used by both heartbeat test
 * files for the D1-reject case).
 *
 * Lives in a shared helper because the chain shape is brittle — when D1's
 * binding API changes the mock must change in one place, not several.
 * arc0btc PR #889 review suggestion (extracted from inline duplicates in
 * `route.test.ts` + `stx-db-threading.test.ts`).
 */

import { vi, type Mock } from "vitest";

export interface MockD1 {
  db: D1Database;
  /** Spy on the terminal `.run()` call — assert call count or set rejection. */
  run: Mock;
  /** Spy on `.bind(...)` to assert parameter shape. */
  bind: Mock;
  /** Spy on `.prepare(sql)` to assert SQL shape. */
  prepare: Mock;
}

/**
 * Build a D1Database mock where `prepare(...).bind(...).run()` resolves
 * with `{ success: true }` by default. Pass `runImpl` to substitute a
 * different terminal behavior (e.g. `() => Promise.reject(new Error("boom"))`
 * for the D1-failure regression test).
 */
export function buildMockD1(runImpl?: () => Promise<unknown>): MockD1 {
  const run = vi.fn(runImpl ?? (() => Promise.resolve({ success: true })));
  const bind = vi.fn().mockReturnValue({ run });
  const prepare = vi.fn().mockReturnValue({ bind });
  return { db: { prepare } as unknown as D1Database, run, bind, prepare };
}
