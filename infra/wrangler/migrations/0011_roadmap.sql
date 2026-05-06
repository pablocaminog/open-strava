-- 0011_roadmap.sql — public roadmap kanban + per-item upvotes.
--
-- Items move through four columns: backlog → planned → in_progress
-- → released. Athletes can submit and upvote; admins (any user via the
-- API today, narrowed to a role later) can move columns.

CREATE TABLE roadmap_items (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'backlog'
                  CHECK (status IN ('backlog','planned','in_progress','released')),
  released_at   INTEGER,
  -- Provenance: NULL means seeded by the system.
  created_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  -- Hand-set ordering inside a column. Higher = top.
  sort_order    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_roadmap_status ON roadmap_items(status, sort_order DESC, created_at DESC);

CREATE TABLE roadmap_votes (
  item_id     TEXT NOT NULL REFERENCES roadmap_items(id) ON DELETE CASCADE,
  athlete_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (item_id, athlete_id)
);
CREATE INDEX idx_roadmap_votes_athlete ON roadmap_votes(athlete_id);

-- Seed: every released feature visible in the app today + every
-- still-open ask in the team's working notes. created_by NULL for
-- system seeds; created_at uses an explicit epoch so order is stable.

INSERT INTO roadmap_items (id, title, description, status, released_at, sort_order, created_at, updated_at)
VALUES
  -- ============== RELEASED ==============
  ('019dff00-0000-7000-8000-000000000001',
   'Passkey-only registration + login',
   'WebAuthn passkeys, biometric required (UV=required), counter-replay defence, audit log on every event.',
   'released', 1778000000, 100, 1778000000, 1778000000),

  ('019dff00-0000-7000-8000-000000000002',
   'Strava OAuth + full backfill',
   'OAuth connect, paginated backfill to account creation, throttled inside Strava 100/15min and 1000/day caps. Synth TCX from /activities + /streams. Per-job progress on /upload.',
   'released', 1778020000, 99, 1778020000, 1778020000),

  ('019dff00-0000-7000-8000-000000000003',
   'PMC dashboard',
   '42-day CTL, 7-day ATL, daily TSB. Banister model. Daily TSS bar chart. 12-week heatmap with zone-ramp legend.',
   'released', 1778030000, 98, 1778030000, 1778030000),

  ('019dff00-0000-7000-8000-000000000004',
   'Calendar view',
   'TrainingPeaks-style 7-column week grid. Weekly totals, per-sport breakdown, end-of-week CTL/ATL/TSB. Source attribution per card.',
   'released', 1778040000, 97, 1778040000, 1778040000),

  ('019dff00-0000-7000-8000-000000000005',
   'Workout library + scheduling',
   '60 calibrated sessions across cycling / running / swimming. Filter by sport, duration, intensity. Add to library or schedule from one click. FIT + ZWO export.',
   'released', 1778050000, 96, 1778050000, 1778050000),

  ('019dff00-0000-7000-8000-000000000006',
   'hrTSS fallback for fresh accounts',
   'PMC stays populated even when FTP / HRmax aren''t set yet. Population defaults (HRmax 190, HRrest 60) used until the athlete saves real thresholds.',
   'released', 1778055000, 95, 1778055000, 1778055000),

  ('019dff00-0000-7000-8000-000000000007',
   'Async bulk archive uploads',
   'Drop a multi-GB Garmin / Strava export .zip, server unpacks in the background, fans into the activity ingest queue, deletes the source archive on completion. Notification bell badge on the dashboard.',
   'released', 1778060000, 94, 1778060000, 1778060000),

  ('019dff00-0000-7000-8000-000000000008',
   'Garmin webhooks: dailies, sleep, body comp, user-metrics',
   'Wellness ingest endpoints wired. Per-day RHR, sleep score, HRV, body battery, stress, weight, VO2max into wellness_daily.',
   'released', 1778065000, 93, 1778065000, 1778065000),

  ('019dff00-0000-7000-8000-000000000009',
   'Glossary tooltips',
   'Hover any metric label (TSS, NP, IF, CTL, ATL, TSB, GAP, SWOLF, …) for the formal definition + a plain-language one. 35 entries in the catalog.',
   'released', 1778070000, 92, 1778070000, 1778070000),

  ('019dff00-0000-7000-8000-000000000010',
   'Branded transactional email (CF Email Service)',
   'Welcome on register. Account-deletion confirmation. Kudos / comment / new-follower / import-done emails — paper-card design with volt CTA, sourced from notifications.pacelore.com.',
   'released', 1778075000, 91, 1778075000, 1778075000),

  ('019dff00-0000-7000-8000-000000000011',
   'Public clubs, events, challenges',
   'Eight curated clubs, ten 2027 challenges, ten events. Detail pages for each with Join / RSVP and member / participant lists. /me/challenges shows joined items with live progress.',
   'released', 1778080000, 90, 1778080000, 1778080000),

  ('019dff00-0000-7000-8000-000000000012',
   'pacelore.com on Workers Static Assets',
   'Migrated off Pages. Served from a Worker with the [assets] binding behind run_worker_first so SSR + assets cohabit cleanly. Zero-downtime cutover from Pages to Workers.',
   'released', 1778085000, 89, 1778085000, 1778085000),

  ('019dff00-0000-7000-8000-000000000013',
   'Marketing landing rewrite',
   'Pain-named hero, side-by-side comparison vs Strava + TrainingPeaks, FAQ with FAQPage JSON-LD, /demo route, real OG card, sitemap + robots.txt.',
   'released', 1778090000, 88, 1778090000, 1778090000),

  -- ============== IN PROGRESS ==============
  ('019dff00-0000-7000-8000-000000000020',
   'Garmin partner-program approval',
   'Application in flight. Once approved, push webhooks for activities + wellness will fire for real. Webhook handlers already deployed.',
   'in_progress', NULL, 200, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000021',
   'Garmin wellness backfill',
   'Today only activities backfill. Add cursor-walk for sleep, RHR, HRV, body comp, user metrics so historical wellness populates the calendar wellness row.',
   'in_progress', NULL, 199, 1778090000, 1778090000),

  -- ============== PLANNED ==============
  ('019dff00-0000-7000-8000-000000000030',
   'Native iOS app with HealthKit',
   'Native Swift app reading HKWorkout + heart-rate + GPS samples post-hoc, uploading via /api/v1/activities/ingest/apple. Background HKObserverQuery for new workouts.',
   'planned', NULL, 300, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000031',
   'Apple Health export.xml import',
   'Drop the iOS Export All Health Data zip on /upload, parse <Workout> elements server-side, synthesize TCX per workout, route through the existing ingest queue.',
   'planned', NULL, 299, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000032',
   'Multi-passkey management',
   'List per-account credentials in /settings, name each device, revoke individually. Schema already supports it; UI is the missing piece.',
   'planned', NULL, 298, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000033',
   'Active sessions list',
   'See every active session per account with IP + UA, revoke any one of them remotely. Needs a sessions D1 mirror keyed by athlete since KV doesn''t index that direction.',
   'planned', NULL, 297, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000034',
   'Webhook signature verification',
   'Verify the HMAC on every Garmin push so a forged request can''t poison wellness or activity rows. Trivial to add once partner keys land.',
   'planned', NULL, 296, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000035',
   'Account-wide rate limiting on Garmin',
   'Garmin caps at the partner-key level, not per user. Today our limiter is per-athlete. Move the budget to a shared CF KV bucket so we don''t throttle at scale.',
   'planned', NULL, 295, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000036',
   'Real og.png (raster)',
   'Today /og.svg ships as the social card; some platforms (Slack older clients, Discord) want a raster PNG. Generate a 1200×630 PNG of the current OG SVG.',
   'planned', NULL, 294, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000037',
   'TrainingPeaks bulk import',
   'TP doesn''t expose a public API. Build a per-week FIT-zip dropper that mirrors the Strava archive flow.',
   'planned', NULL, 293, 1778090000, 1778090000),

  -- ============== BACKLOG ==============
  ('019dff00-0000-7000-8000-000000000040',
   'Live group rides (Durable Objects)',
   'Real-time presence + position broadcast for active group rides. One DO per ride, broadcasting positions to all participants, computing live segment race for the route.',
   'backlog', NULL, 400, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000041',
   'Race-day taper assistant',
   'Given a target date, recommend the CTL trajectory, weekly TSS targets, and key-session schedule. Coggan-anchored.',
   'backlog', NULL, 399, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000042',
   'Auto-detect FTP from rides',
   'Best 20-min effort × 0.95 across the last 90 days. Prompt to commit on the dashboard when the estimate diverges from the saved value.',
   'backlog', NULL, 398, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000043',
   'Decoupling per-activity automatic flag',
   'Compute Pw:HR drift first half vs second on every steady ride; chip the activity card with the percentage and a "needs more base" hint when > 8%.',
   'backlog', NULL, 397, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000044',
   'Strava live segments parity',
   'Today segments are detected on ingest. Add a live-effort overlay where the athlete''s current effort is graded against their PR + the KOM in real time.',
   'backlog', NULL, 396, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000045',
   'CSV / Parquet export',
   'In addition to FIT/TCX/GPX per activity, expose a single CSV (and Parquet) of the whole athlete''s metric history for spreadsheet / R / pandas use.',
   'backlog', NULL, 395, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000046',
   'Anonymized public dataset on Hugging Face',
   'Quarterly dump of opted-in activity records (no GPS near home, hashed IDs). Publish to HF + GitHub Releases parquet for ML research.',
   'backlog', NULL, 394, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000047',
   'Coach <-> athlete pairing',
   'Coaches view their athletes'' calendars + PMC, post planned workouts, monitor compliance. Schema for coaches table already in 0004_training.sql.',
   'backlog', NULL, 393, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000048',
   'Email digests (weekly + race-week)',
   'Weekly summary email — load, ramp rate, top sessions, sleep streak. Race-week-mode lighter cadence with TSB and freshness tracking.',
   'backlog', NULL, 392, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000049',
   'Zwift direct integration',
   'Today Zwift goes via Strava. If Zwift opens an API, hit it directly with the same Strava-style backfill cursor.',
   'backlog', NULL, 391, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000050',
   'Mobile dashboard (PWA)',
   'Install as a PWA. Today /dashboard works on phones but isn''t optimized. Tighten layout, offline shell, push notifications via Web Push.',
   'backlog', NULL, 390, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000051',
   'Maps style (Protomaps custom JSON)',
   'Today /activity/:id uses OpenFreeMap Positron. Cut a custom Protomaps style that matches the design system — calm ink + warm-paper palette.',
   'backlog', NULL, 389, 1778090000, 1778090000),

  ('019dff00-0000-7000-8000-000000000052',
   'AI Annotations on Activities (Workers AI)',
   'Auto-write the "what happened" caption — flat ride, hill repeats, race effort. Anomaly detection (HR drift, power drop) flags during ingest.',
   'backlog', NULL, 388, 1778090000, 1778090000)
ON CONFLICT (id) DO NOTHING;
