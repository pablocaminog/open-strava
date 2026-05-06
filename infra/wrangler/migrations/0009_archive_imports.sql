-- 0009_archive_imports.sql — async bulk-archive uploads.
--
-- A user uploads a multi-GB Garmin Connect / Strava export .zip; the
-- browser used to unpack and POST per-file in JSZip, which means the
-- tab had to stay open for the whole flow. Now: upload streams
-- straight to R2, the consumer worker unpacks and enqueues each
-- activity, and the original archive is deleted on completion.

CREATE TABLE archive_imports (
  id              TEXT PRIMARY KEY,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename        TEXT NOT NULL,
  size_bytes      INTEGER NOT NULL,
  r2_path         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','error')),
  total_files     INTEGER NOT NULL DEFAULT 0,
  succeeded       INTEGER NOT NULL DEFAULT 0,
  duplicates      INTEGER NOT NULL DEFAULT 0,
  failed          INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at    INTEGER
);
CREATE INDEX idx_archive_athlete ON archive_imports(athlete_id, created_at DESC);
CREATE INDEX idx_archive_status ON archive_imports(status, updated_at);
