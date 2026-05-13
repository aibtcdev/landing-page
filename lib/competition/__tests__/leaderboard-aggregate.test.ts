import { describe, it, expect } from "vitest";
import { LEADERBOARD_AGGREGATE_SQL } from "../leaderboard-query";

/**
 * Pin the leaderboard aggregate SQL's predicate shape.
 *
 * The leaderboard's eligibility predicate must match `senderEligibilityTier`
 * in `lib/competition/verify.ts` — the same predicate used by trade
 * ingestion. If they drift, agents
 * appear on the leaderboard whose trades the verifier would reject (or
 * vice-versa), and the rules in #815 §1 stop matching reality.
 *
 * These assertions run against the SQL string itself rather than a live
 * D1 — sufficient to catch the most likely regressions:
 *   - someone reverts INNER JOIN → LEFT JOIN (silently re-admits Level-1-
 *     only senders)
 *   - someone removes the EXISTS … claims … subquery (silently re-admits
 *     senders without a verified viral claim)
 *   - someone widens `claims.status IN (...)` to include `pending`
 *     (silently lowers the bar from Genesis to "claim submitted")
 *   - someone removes the ERC-8004 identity predicate (silently re-admits
 *     Genesis senders who have not minted their on-chain identity)
 *   - someone widens `source IN (...)` to include a value not in
 *     `migrations/005_swaps.sql`'s CHECK constraint (no-op at runtime
 *     today, but documents drift between SQL + schema)
 *
 * A fuller behavioral test would require extracting `fetchLeaderboard` to a
 * server-only module first; tracked as a follow-up.
 */
describe("LEADERBOARD_AGGREGATE_SQL — competition eligibility predicate shape", () => {
  it("uses INNER JOIN against agents (not LEFT JOIN — would re-admit Level-1-only senders)", () => {
    expect(LEADERBOARD_AGGREGATE_SQL).toContain("INNER JOIN agents");
    expect(LEADERBOARD_AGGREGATE_SQL).not.toMatch(
      /LEFT\s+(?:OUTER\s+)?JOIN\s+agents/i
    );
  });

  it("includes EXISTS subquery on claims joined via btc_address", () => {
    // Multi-line: tolerant to whitespace variation but pins the join key.
    expect(LEADERBOARD_AGGREGATE_SQL).toMatch(
      /EXISTS\s*\([\s\S]*SELECT\s+1\s+FROM\s+claims\s+c[\s\S]*c\.btc_address\s*=\s*a\.btc_address[\s\S]*\)/i
    );
  });

  it("requires claim status to be exactly verified or rewarded (the Genesis predicate)", () => {
    expect(LEADERBOARD_AGGREGATE_SQL).toMatch(
      /c\.status\s+IN\s*\(\s*'verified'\s*,\s*'rewarded'\s*\)/i
    );
    // Defensive: 'pending' must not be in the allow set — would lower
    // the bar from Genesis (Level 2) to "claim submitted" (no level).
    expect(LEADERBOARD_AGGREGATE_SQL).not.toMatch(/'pending'/);
  });

  it("requires an ERC-8004 identity id", () => {
    expect(LEADERBOARD_AGGREGATE_SQL).toMatch(
      /a\.erc8004_agent_id\s+IS\s+NOT\s+NULL/i
    );
  });

  it("filters tx_status to 'success' only (preserves audit-vs-counted split)", () => {
    expect(LEADERBOARD_AGGREGATE_SQL).toMatch(
      /s\.tx_status\s*=\s*'success'/
    );
  });

  it("source allowlist matches migrations/005_swaps.sql CHECK constraint exactly", () => {
    // The CHECK constraint enforces the set at the row level; the WHERE
    // clause restates intent and forces deliberate opt-in for new sources.
    expect(LEADERBOARD_AGGREGATE_SQL).toMatch(
      /s\.source\s+IN\s*\(\s*'agent'\s*,\s*'cron'\s*,\s*'chainhook'\s*\)/
    );
  });

  it("groups by (sender, token_in, token_out) so client can compute Volume + P&L per pair", () => {
    expect(LEADERBOARD_AGGREGATE_SQL).toMatch(
      /GROUP\s+BY\s+s\.sender\s*,\s*s\.token_in\s*,\s*s\.token_out/i
    );
  });
});
