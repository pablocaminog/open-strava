-- 0004_training.sql — challenges, structured workouts, calendar, PRs, coach.

-- Challenges: distance/elevation/duration goals over a date range.
-- Aggregation is computed at read time from activities; no denorm.
CREATE TABLE challenges (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  metric          TEXT NOT NULL CHECK (metric IN ('distance_m','ascent_m','total_seconds','tss')),
  goal            REAL NOT NULL,                 -- units depend on metric
  sport           TEXT,                          -- null = any
  starts_at       INTEGER NOT NULL,              -- inclusive
  ends_at         INTEGER NOT NULL,              -- inclusive
  visibility      TEXT NOT NULL DEFAULT 'public'
                    CHECK (visibility IN ('public','private')),
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_challenges_window ON challenges (starts_at, ends_at);

CREATE TABLE challenge_participants (
  challenge_id    TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (challenge_id, athlete_id)
);

-- Structured workouts (TrainingPeaks-style).
-- steps_json shape: { steps: [{ kind: 'warmup'|'work'|'recover'|'cooldown'|'rest',
--                                durationSec?: number, distM?: number,
--                                target?: { type: 'ftp_pct'|'hr_pct'|'pace', low: number, high: number },
--                                repeat?: number, children?: [...] }] }
CREATE TABLE workouts (
  id              TEXT PRIMARY KEY,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  sport           TEXT NOT NULL CHECK (sport IN ('cycling','running','swimming','other')),
  estimated_tss   REAL,
  estimated_duration_sec INTEGER,
  steps_json      TEXT NOT NULL,                 -- JSON
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_workouts_athlete ON workouts (athlete_id, created_at);

-- Planned workouts on the calendar.
CREATE TABLE planned_workouts (
  id              TEXT PRIMARY KEY,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workout_id      TEXT REFERENCES workouts(id) ON DELETE SET NULL,
  scheduled_date  TEXT NOT NULL,                 -- YYYY-MM-DD (athlete-local)
  notes           TEXT,
  completed_activity_id TEXT REFERENCES activities(id) ON DELETE SET NULL,
  compliance_score REAL,                          -- 0..1, set by planned-vs-actual matcher
  assigned_by     TEXT REFERENCES users(id),     -- coach if any
  created_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_planned_athlete_date ON planned_workouts (athlete_id, scheduled_date);

-- Personal records — per athlete + sport + key.
-- key examples: 'distance:5000m', 'distance:10000m', 'power:5s', 'power:60s', 'power:1200s'
CREATE TABLE personal_records (
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sport           TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           REAL NOT NULL,                 -- seconds for distance, watts for power
  activity_id     TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  achieved_at     INTEGER NOT NULL,
  PRIMARY KEY (athlete_id, sport, key)
);

-- Coach-athlete links. Bidirectional consent: coach must invite, athlete must accept.
CREATE TABLE coach_athletes (
  coach_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  athlete_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','active','revoked')),
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (coach_id, athlete_id),
  CHECK (coach_id != athlete_id)
);
CREATE INDEX idx_coach_athletes_athlete ON coach_athletes (athlete_id, status);
