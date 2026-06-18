-- Migration 023: Legion dashboard snapshot (single-row JSON cache)
--
-- The Legion dashboard renders a denormalized snapshot of testnet governance
-- state (treasury wiring, members + stake, proposals + per-agent votes). The
-- 5-min cron rebuilds it from Hiro and upserts the single row here; the page
-- and /api/legion read it behind caches.default + an in-flight singleflight,
-- mirroring the leaderboard read path (app/leaderboard/page.tsx). Hiro is only
-- ever hit by the rebuild, never per request.
--
-- JSON-in-TEXT matches the existing competition_round_results.result_json
-- precedent — the whole dashboard is read at once, so there's no query benefit
-- to normalizing proposals/votes into separate tables.
CREATE TABLE IF NOT EXISTS legion_snapshot (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  snapshot_json TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL
);
