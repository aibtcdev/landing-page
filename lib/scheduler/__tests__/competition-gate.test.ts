/**
 * Issue #933 — competition sweep kill-switch regression test.
 *
 * runCompetitionNow() must skip the Hiro catch-up sweep (which shares the single
 * HIRO_API_KEY with reputation/identity lookups) when COMPETITION_SWEEP_ENABLED
 * is explicitly "false", returning a zeroed summary without touching Hiro. The
 * gate defaults ON — only an explicit "false" disables it — so an unset var
 * preserves current behavior.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock only runCompetitionScheduler; keep disabledCompetitionSummary real.
vi.mock("../../competition/scheduler", async (importActual) => {
  const actual = await importActual<typeof import("../../competition/scheduler")>();
  return {
    ...actual,
    runCompetitionScheduler: vi.fn().mockResolvedValue(actual.disabledCompetitionSummary()),
  };
});

import { runCompetitionNow } from "../cron-runner";
import { runCompetitionScheduler } from "../../competition/scheduler";

function buildEnv(overrides: Record<string, unknown> = {}): CloudflareEnv {
  return {
    DB: { prepare: vi.fn() },
    HIRO_API_KEY: "test-key",
    VERIFIED_AGENTS: { put: vi.fn().mockResolvedValue(undefined) },
    ...overrides,
  } as unknown as CloudflareEnv;
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

beforeEach(() => vi.clearAllMocks());

describe("Issue #933 — competition sweep gate", () => {
  it("skips the sweep when COMPETITION_SWEEP_ENABLED='false'", async () => {
    const env = buildEnv({ COMPETITION_SWEEP_ENABLED: "false" });

    const result = await runCompetitionNow(env, logger);

    expect(runCompetitionScheduler).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 0, found: 0, inserted: 0, cursor: null });
    // still persists lastRunAt so the slow cadence is respected while dormant
    expect((env.VERIFIED_AGENTS.put as Mock)).toHaveBeenCalledTimes(1);
  });

  it("runs the sweep when the var is unset (default ON)", async () => {
    const env = buildEnv();

    await runCompetitionNow(env, logger);

    expect(runCompetitionScheduler).toHaveBeenCalledTimes(1);
  });

  it("runs the sweep when explicitly 'true'", async () => {
    const env = buildEnv({ COMPETITION_SWEEP_ENABLED: "true" });

    await runCompetitionNow(env, logger);

    expect(runCompetitionScheduler).toHaveBeenCalledTimes(1);
  });
});
