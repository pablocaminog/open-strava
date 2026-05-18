# Structured Workout CSV Builder + Compliance Matching

**Date:** 2026-05-18  
**Status:** Approved

## Overview

Coaches and athletes can define structured interval workouts using a simple CSV format. The same parser runs in the web UI, API, and MCP tools. Completed activities are matched to planned workouts and color-coded by compliance.

---

## CSV Format

**First row:** `name, sport, description`  
**Subsequent rows:** `block_name, duration_secs, target`

```
Z2 Ride, cycling, Easy aerobic base
Warm up, 600, 80-150W
Main Block, 2000, 170W
Cool down, 600, 150-80W
```

### Sport values
`cycling` | `running` | `swimming` | `other`

### Target formats

| Input | Type | Notes |
|-------|------|-------|
| `170` or `170W` | Absolute watts | cycling |
| `80-150` or `80-150W` | Watts range | cycling |
| `75%` | % FTP | cycling |
| `80-90%` | % FTP range | cycling |
| `140bpm` or `140hr` | HR bpm | any sport |
| `130-150bpm` | HR range | any sport |
| `4:30/km` or `4:30` (running) | Pace sec/km | run/swim |
| `4:30-5:00/km` | Pace range sec/km | run/swim |

### Block name → WorkoutStep `kind` mapping
- `warm up` / `warmup` → `warmup`
- `cool down` / `cooldown` → `cooldown`
- `recover` / `recovery` / `rest` → `recover`
- everything else → `work`

---

## Architecture

### New package: `packages/workout-csv/`

Pure function, no I/O, no dependencies:

```ts
parseWorkoutCsv(text: string): {
  name: string;
  sport: 'cycling' | 'running' | 'swimming' | 'other';
  description?: string;
  steps: WorkoutStep[];
}
```

Throws a descriptive error on invalid input (row number + reason).

Used by:
1. **Web UI** — bundled client-side in `workouts.astro` via Astro import
2. **API** — `POST /api/v1/workouts` body
3. **MCP** — `schedule_workout` and new `create_workout_from_csv` tool

### API changes (`apps/api/src/routes/training.ts`)

`POST /api/v1/workouts` — accept `{ csvText: string }` OR `{ steps: WorkoutStep[], name, sport }`. If `csvText` present, parse → steps.

`POST /api/v1/planned-workouts` — accept optional `csvText` for inline ad-hoc session with blocks (stored in `session_json`).

### MCP changes (`apps/api/src/routes/mcp.ts`)

New tool: `create_workout_from_csv` — accepts `csvText` + optional `scheduledDate`. Parses, saves workout, optionally schedules on calendar.

Existing `schedule_workout` tool — add optional `csvText` param to allow inline block definition.

### Compliance matching (`apps/api/src/pipeline/persist.ts`)

Current score: `0.5 × durRatio + 0.5 × tssRatio`

Enhanced: if planned workout has power/pace targets in steps:
- `durScore` = `min(actual/planned, planned/actual)` clamped 0–1
- `intensityScore` = closeness of actual avg power (or pace) to target midpoint, clamped 0–1
- `complianceScore` = `0.5 × durScore + 0.5 × intensityScore`

Falls back to TSS-based if no structured targets.

### Color thresholds

| Score | Color | Meaning |
|-------|-------|---------|
| ≥ 0.95 | 🟢 green | within ±5% |
| ≥ 0.85 | 🟡 yellow | 5–15% off |
| < 0.85 | 🔴 red | >15% off |

### Badge surfaces

- **`calendar.astro`** — colored left-border on completed activity cards when linked to a planned workout
- **`activity/[id].astro`** — "vs plan" banner showing compliance score + color if `completed_activity_id` reverse-links to a planned workout
- **`home.astro`** — compliance dot on "last activity" tile

---

## Data flow

```
CSV text
  → parseWorkoutCsv()          (packages/workout-csv)
  → WorkoutStep[]
  → POST /api/v1/workouts       (saves to workouts table, steps_json)
  → schedule on calendar        (planned_workouts row with workout_id)
  → athlete completes activity
  → ingest pipeline runs matchPlannedWorkout()
  → compliance_score saved
  → calendar / activity / home render colored badge
```

---

## Error handling

- `parseWorkoutCsv` throws `WorkoutCsvError` with `{ message, row }` — UI shows inline error on the CSV textarea
- Empty CSV, missing sport, unparseable target → descriptive errors
- API returns 400 with same message on bad `csvText`
- Compliance match failure is non-fatal (logged, score left null)

---

## Out of scope

- Block-level compliance (per-interval matching against power trace)
- Multi-workout bulk CSV upload
- Swim pace units (min/100m) — deferred
