# Race Plan Creator — Design Spec
_2026-05-16_

## Overview

Athlete selects a target race (sprint/olympic/70.3/full Ironman/half marathon), enters their weekly schedule constraints and baseline metrics, and gets a periodized training plan auto-populated into their calendar. A Claude Haiku audit call annotates the plan with a narrative summary and warnings.

## Race Types Supported

| Type | Min weeks | Taper weeks | Brick workouts |
|------|-----------|-------------|----------------|
| Sprint triathlon | 4 | 1 | no |
| Olympic triathlon | 8 | 1 | build/peak |
| Ironman 70.3 | 12 | 2 | build/peak/race-sp |
| Full Ironman | 16 | 2 | build/peak/race-sp |
| Half marathon | 8 | 1 | n/a (run only) |

## Architecture

### New package: `packages/planner`

```
packages/planner/src/
  templates/   sprint.ts, olympic.ts, 703.ts, full.ts, half-marathon.ts
  engine.ts    week-by-week TSS distribution + phase assignment
  scheduler.ts session → sport×day slot assignment
  auditor.ts   Claude Haiku API call → {summary, warnings[]}
  types.ts     PlanSpec, RaceTemplate, WeekPlan, SessionPlan, AuditResult
```

Depends on `@pacelore/metrics` for CTL/TSS types. No DB access — pure functions.

### New web pages

| Route | Purpose |
|-------|---------|
| `/plans` | Plan list + "New Plan" CTA |
| `/plans/new` | 4-step wizard |
| `/plans/[id]` | Plan detail — paginated week calendar |

### New API routes (appended to `apps/api/src/routes/training.ts`)

| Method | Path | Action |
|--------|------|--------|
| POST | `/plans` | Run engine → Claude audit → write `planned_workouts` → return plan |
| GET | `/plans` | List plans for authenticated athlete |
| GET | `/plans/:id` | Plan detail (reads `planned_workouts` WHERE `plan_id = :id`) |
| DELETE | `/plans/:id` | Delete plan + cascade-delete its `planned_workouts` |
| GET | `/me/ftp-estimates` | Derive FTP estimates from best efforts in `activities` (best 20-min power × 0.95 for bike; threshold pace from best 30-min run; CSS from best 400m swim) |

## Database Schema

Migration `infra/wrangler/migrations/0012_race_plans.sql`:

```sql
CREATE TABLE race_plans (
  id          TEXT    PRIMARY KEY,
  athlete_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_type   TEXT    NOT NULL,   -- 'sprint'|'olympic'|'703'|'full'|'half-marathon'
  race_date   INTEGER NOT NULL,   -- unix timestamp
  config_json TEXT    NOT NULL,   -- wizard inputs (see Config shape below)
  audit_json  TEXT,               -- Claude output (nullable — plan usable without it)
  status      TEXT    NOT NULL DEFAULT 'active',  -- 'active'|'archived'
  created_at  INTEGER NOT NULL
);

ALTER TABLE planned_workouts ADD COLUMN plan_id TEXT REFERENCES race_plans(id) ON DELETE CASCADE;

ALTER TABLE users ADD COLUMN height_cm  INTEGER;
ALTER TABLE users ADD COLUMN weight_kg  REAL;
```

### `config_json` shape

```ts
{
  ftp_w: number,           // cycling watts
  ftp_run_pace: number,    // sec/km at threshold
  ftp_swim_css: number,    // sec/100m
  schedule: {
    [sport: 'swim' | 'bike' | 'run']: {
      [day: 0..6]: {       // 0 = Monday
        intensity: 'short' | 'moderate' | 'long' | null,
        window?: { start: string, end: string }  // "16:00", "18:00"
      }
    }
  }
}
```

### `audit_json` shape

```ts
{
  summary: string,
  warnings: { severity: 'error' | 'warning', message: string }[]
}
```

## Periodization Engine

### Templates

Each race type has a `RaceTemplate`:

```ts
type RaceTemplate = {
  phases: {
    name: string
    ratio: number         // fraction of total weeks
    tss_ramp: number      // week-over-week TSS multiplier
    mix: { swim: number, bike: number, run: number }  // TSS split
  }[]
  tss_start_factor: number  // × athlete CTL → week 1 TSS target
  tss_peak_factor: number   // × athlete CTL → peak week TSS target
  taper_weeks: number
  recovery_every_n: number  // insert 0.65× week every N weeks
  brick_phases: string[]    // phases where bike+run same-day is allowed
}
```

Example — 70.3:

```ts
phases: [
  { name: 'base',    ratio: 0.33, tss_ramp: 1.05, mix: { swim: 0.25, bike: 0.45, run: 0.30 } },
  { name: 'build',   ratio: 0.28, tss_ramp: 1.08, mix: { swim: 0.20, bike: 0.50, run: 0.30 } },
  { name: 'peak',    ratio: 0.22, tss_ramp: 1.10, mix: { swim: 0.20, bike: 0.50, run: 0.30 } },
  { name: 'race-sp', ratio: 0.06, tss_ramp: 0.95, mix: { swim: 0.20, bike: 0.50, run: 0.30 } },
  { name: 'taper',   ratio: 0.11, tss_ramp: 0.60, mix: { swim: 0.25, bike: 0.45, run: 0.30 } },
],
tss_start_factor: 0.85,
tss_peak_factor: 1.40,
taper_weeks: 2,
recovery_every_n: 4,
brick_phases: ['build', 'peak', 'race-sp'],
```

### Scheduler rules (in priority order)

1. Time-windowed cells take their pinned sport
2. Long-intensity cells get the highest-TSS session for the week
3. No back-to-back long sessions (moderate or rest between)
4. Bricks (bike→run) allowed on long days in brick phases
5. If total available hours < week TSS / tss_per_hour → scale session durations down, flag in audit
   - `tss_per_hour` derived from FTP: cycling ≈ `ftp_w / 100`, running ≈ 55 (zone 2 default), swimming ≈ 40

Half marathon plans: only `run` sessions, no swim/bike grid.

## Wizard Flow

### Step 1 — Race
- Radio cards: Sprint · Olympic · 70.3 · Full Ironman · Half Marathon
- Date picker
- Inline validation: if `race_date - today < min_weeks × 7` → amber warning "Only X weeks — plan will be compressed" (proceed allowed)

### Step 2+3 — Schedule (combined single step)
- Sport × Day grid (3 rows × 7 cols)
  - Half marathon: 1 row (run only)
- Click cell → cycle: empty → short → moderate → long → empty
- Click filled cell → time window popup (start time + duration → computes end time)
- Footer bar: "X sessions · Yh/week available"

### Step 4 — Profile
- Height (cm), Weight (kg) — pre-filled from `users` if already set
- FTP inputs (conditional by race type):
  - Bike W: triathlon races only
  - Run threshold pace (sec/km): all race types
  - Swim CSS (sec/100m): triathlon races only
  - Pre-filled from best efforts via GET /me/ftp-estimates on step load
- Current CTL shown read-only ("Your current fitness: XX CTL") — from PMC daily rollup

### Step 5 — Generate
- POST /plans → server runs engine + Claude audit
- Streamed response or polling (plan generation < 2s, Claude < 3s)
- Plan renders as paginated week-by-week calendar
  - Each week: 7-day grid, each cell shows sport emoji + duration + zone
  - Navigation: ‹ Prev / Next › with week number + phase label
- Claude audit rendered above week view:
  - Summary paragraph
  - Warning banners (red = error, amber = warning)
- Plan is already written to `planned_workouts` immediately on POST /plans response
- "View my plan →" button navigates to `/plans/[id]` (no separate confirm step)

## Claude Audit

Model: `claude-haiku-4-5-20251001` (cheap, < 1s typical latency)

Prompt sends: race type, weeks out, athlete CTL, hours/week available, per-week summary (week #, phase, TSS, hours, session count).

Returns strict JSON `{summary, warnings[]}`. Parse failure → `audit_json = null`, plan still usable without it.

Flags raised when:
- Timeline under minimum prep weeks for race type
- Week-over-week TSS spike > 15%
- Taper shorter than 1 week
- Any sport getting 0 sessions for 3+ consecutive weeks (non-run-only plans)
- Available hours < 60% of recommended for race type

## `/plans/[id]` Detail Page

- Plan header: race type badge + race date countdown + status chip
- Audit block (if `audit_json` exists): summary + warning banners
- Week navigator with phase label (BASE / BUILD / PEAK / TAPER)
- Week grid: same sport×day layout as wizard step 2, read-only
  - Each session cell links to the underlying `planned_workout` on `/calendar`
- "Archive plan" action (sets `status = 'archived'`, does not delete workouts)
- "Delete plan" action (deletes plan + all its `planned_workouts`)

## `/plans` List Page

- Cards per plan: race type + race date + week count + status
- "New Plan" button → `/plans/new`
- Archived plans collapsed under "Archived" disclosure

## Error Handling

- Claude audit failure: silent — plan generated, `audit_json = null`, no warning shown (audit is enrichment, not critical path)
- Schedule too tight for race type: algorithm scales sessions down to fit, audit flags it
- Race date in the past: wizard blocks submission
- No FTP entered: algorithm uses CTL-derived estimate (CTL × 2.5 ≈ FTP watts as rough proxy), audit flags "FTP not set — zones estimated"
- Half marathon selected but only triathlon sports in schedule: wizard auto-hides bike/swim rows

## Testing

- `packages/planner`: unit tests for engine (week count, phase assignment, TSS totals), scheduler (no back-to-back longs, window pinning, brick placement)
- API: integration tests for POST /plans (valid inputs, too-tight timeline, missing FTP)
- No mocking of Claude in unit tests — auditor is integration-tested separately with a fixture response
