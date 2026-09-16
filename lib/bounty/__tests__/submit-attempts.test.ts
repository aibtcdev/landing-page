import { describe, it, expect, vi } from "vitest";
import { getSubmitAttemptCounts, recordSubmitAttempt } from "../d1-helpers";

function mockDb(rows: { outcome: string; n: number }[] = []) {
  const bind = vi.fn();
  const stmt = {
    bind: (...args: unknown[]) => {
      bind(...args);
      return stmt;
    },
    all: vi.fn().mockResolvedValue({ results: rows }),
    run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
  };
  const prepare = vi.fn().mockReturnValue(stmt);
  return { db: { prepare } as unknown as D1Database, prepare, bind, stmt };
}

describe("getSubmitAttemptCounts", () => {
  it("maps grouped rows and defaults missing outcomes to 0", async () => {
    const { db, bind } = mockDb([
      { outcome: "closed", n: 3 },
      { outcome: "not_registered", n: 1 },
    ]);

    const counts = await getSubmitAttemptCounts(db, "b1", 5);

    expect(bind).toHaveBeenCalledWith("b1");
    expect(counts).toEqual({
      submitted: 5,
      refused: { not_registered: 1, closed: 3, store_failed: 0 },
    });
  });

  it("ignores unknown outcome values", async () => {
    const { db } = mockDb([{ outcome: "something_else", n: 9 }]);
    const counts = await getSubmitAttemptCounts(db, "b1", 0);
    expect(counts.refused).toEqual({ not_registered: 0, closed: 0, store_failed: 0 });
  });
});

describe("recordSubmitAttempt", () => {
  it("upserts one row keyed by bounty, submitter and outcome, guarded on the bounty existing", async () => {
    const { db, prepare, bind } = mockDb();

    await recordSubmitAttempt(db, "b1", "bc1qalice", "closed", "2026-09-16T00:00:00.000Z");

    const sql = prepare.mock.calls[0][0] as string;
    expect(sql).toContain("ON CONFLICT (bounty_id, submitter_btc_address, outcome)");
    expect(sql).toContain("attempt_count = attempt_count + 1");
    expect(sql).toContain("WHERE EXISTS (SELECT 1 FROM bounties WHERE id = ?)");
    expect(bind).toHaveBeenCalledWith(
      "b1",
      "bc1qalice",
      "closed",
      "2026-09-16T00:00:00.000Z",
      "2026-09-16T00:00:00.000Z",
      "b1"
    );
  });
});
