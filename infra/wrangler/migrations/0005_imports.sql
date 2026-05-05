-- 0005_imports.sql — full-history backfill jobs + activity-source idempotency.
--
-- Activities now carry an optional (external_source, external_id) pair so
-- a re-import from Strava/Garmin collapses on the second run instead of
-- creating duplicate rows. The unique partial index lets pure-upload
-- activities (which have no external id) coexist freely.

ALTER TABLE activities ADD COLUMN external_source TEXT;
ALTER TABLE activities ADD COLUMN external_id     TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_external
  ON activities(external_source, external_id)
  WHERE external_source IS NOT NULL;

-- Allow 'strava-import' alongside 'garmin-import' / 'manual-zip-import'.
-- D1 SQLite can't easily redefine a CHECK constraint — leave the column
-- as-is. The new external_source field is the source of truth for ingest
-- provenance going forward.

-- Long-running backfill jobs. One row per (athlete, provider, scope).
-- Rate-limit accounting lives here so the cron processor can decide
-- whether the job has budget to advance another tick.
CREATE TABLE import_jobs (
  id                       TEXT PRIMARY KEY,
  athlete_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider                 TEXT NOT NULL CHECK (provider IN ('strava','garmin')),
  scope                    TEXT NOT NULL,                          -- 'all' | '90d' | iso-date
  status                   TEXT NOT NULL DEFAULT 'running'
                             CHECK (status IN ('running','paused','done','error')),
  -- Provider-specific resume cursor.
  --  - Strava: oldest start_date_unix processed so far (use as next `before`)
  --  - Garmin: oldest uploadStartTimeInSeconds window processed
  cursor                   INTEGER,
  -- Stop condition (also provider-specific).
  --  - Strava/Garmin: epoch seconds of the earliest activity to consider
  stop_at                  INTEGER,
  total_seen               INTEGER NOT NULL DEFAULT 0,
  succeeded                INTEGER NOT NULL DEFAULT 0,
  duplicates               INTEGER NOT NULL DEFAULT 0,
  failed                   INTEGER NOT NULL DEFAULT 0,
  -- Rate-limit budgets (provider-specific window length).
  rate_window_started_at   INTEGER NOT NULL DEFAULT 0,
  rate_window_used         INTEGER NOT NULL DEFAULT 0,
  daily_window_started_at  INTEGER NOT NULL DEFAULT 0,
  daily_window_used        INTEGER NOT NULL DEFAULT 0,
  last_error               TEXT,
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_import_jobs_athlete ON import_jobs(athlete_id, created_at DESC);
CREATE INDEX idx_import_jobs_running ON import_jobs(status, updated_at);
