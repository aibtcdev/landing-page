-- Migration 024: per-Legion snapshot cache (multi-Legion).
--
-- Supersedes the single-row `legion_snapshot` (migration 023), which assumed
-- exactly one Legion. The platform is now multi-Legion: a shared on-chain
-- registry lists many Legions (demand + provider kinds). The 5-min cron rebuilds
-- one denormalized snapshot per Legion plus a small registry index, and upserts
-- them here keyed by `legion_id`. The page + /api/legions read behind
-- caches.default + an in-flight singleflight (lib/legion/read.ts), so Hiro is
-- only hit on a rebuild, never per request.
--
-- legion_id is the registry's numeric id as text ("1", "2", …), the slug
-- "demand" for the known demand Legion, or "__registry__" for the index row.
-- JSON-in-TEXT matches migration 023's precedent — each snapshot is read whole,
-- so there's no query benefit to normalizing proposals/providers into tables.
CREATE TABLE IF NOT EXISTS legion_snapshots (
  legion_id     TEXT    PRIMARY KEY,
  snapshot_json TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL
);
