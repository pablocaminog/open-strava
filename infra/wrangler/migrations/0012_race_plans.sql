-- 0012_race_plans.sql — race training plan creator

CREATE TABLE race_plans (
  id          TEXT    PRIMARY KEY,
  athlete_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_type   TEXT    NOT NULL CHECK (race_type IN ('sprint','olympic','703','full','half-marathon')),
  race_date   INTEGER NOT NULL,
  config_json TEXT    NOT NULL,
  audit_json  TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_race_plans_athlete ON race_plans (athlete_id, created_at DESC);

ALTER TABLE planned_workouts ADD COLUMN plan_id TEXT REFERENCES race_plans(id) ON DELETE CASCADE;
ALTER TABLE planned_workouts ADD COLUMN session_json TEXT;

ALTER TABLE users ADD COLUMN height_cm  INTEGER;
ALTER TABLE users ADD COLUMN weight_kg  REAL;
