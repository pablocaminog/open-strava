# Planned Workouts Endpoint + MCP Tools

**Date:** 2026-05-18  
**Status:** approved

## Problem

The MCP tool surface and REST API lack a simple way to create ad-hoc planned workouts. The existing `POST /me/calendar` endpoint requires a pre-created `workout_id` from the structured workout library. There is no path to schedule a workout inline with just date + sport + duration + zones — and no MCP write tools for training planning.

## Solution

New REST route group `POST/GET/DELETE /api/v1/planned-workouts` + two MCP tools (`schedule_workout`, `list_planned_workouts`, `delete_planned_workout`) under a new `write:training` scope.

## REST API

All routes live in `apps/api/src/routes/training.ts`, mounted under `trainingRoutes` (session auth required, same as existing training endpoints).

### `POST /api/v1/planned-workouts`

Creates an ad-hoc planned workout with inline session details. Does **not** require a pre-existing workout in the workout library.

**Request body:**
```json
{
  "scheduledDate": "2026-05-20",
  "sport": "running",
  "durationMin": 60,
  "targetZone": "z2",
  "description": "Easy aerobic run",
  "notes": "keep HR <145",
  "athleteId": "optional-athlete-id"
}
```

**Validation:**
- `scheduledDate`: required, `YYYY-MM-DD` format
- `sport`: required, one of `cycling | running | swimming | other`
- `durationMin`: required, integer ≥ 1
- `targetZone`, `description`, `notes`: optional strings
- `athleteId`: optional; if provided, caller must be active coach of that athlete (same `isCoachOf` check as existing calendar routes)

**Storage:** inserts into `planned_workouts` with `workout_id = null`, `session_json = {sport, durationMin, targetZone, description}`, `notes`, `scheduled_date`, `assigned_by = session.userId`.

**Response `201`:**
```json
{ "id": "..." }
```

### `GET /api/v1/planned-workouts?from=YYYY-MM-DD&to=YYYY-MM-DD`

Lists planned workouts in date range. Both `from` and `to` required.

Returns items with `session_json` fields merged into each row:
```json
{
  "items": [
    {
      "id": "...",
      "scheduledDate": "2026-05-20",
      "notes": "keep HR <145",
      "workoutId": null,
      "completedActivityId": null,
      "complianceScore": null,
      "sport": "running",
      "durationMin": 60,
      "targetZone": "z2",
      "description": "Easy aerobic run"
    }
  ]
}
```

Filters to `session.userId` by default. Accepts optional `?athleteId=` param (coach reads athlete's schedule — same `isCoachOf` guard).

### `DELETE /api/v1/planned-workouts/:id`

Deletes a planned workout owned by or assigned by the caller.

**Response `200`:** `{ "ok": true }`

## MCP Tools

### New scope: `write:training`

Added to:
- `scopes_supported` in `authServerMeta()` in `mcp.ts`
- The OAuth authorize form checkbox list

### `schedule_workout` (scope: `write:training`)

```json
{
  "name": "schedule_workout",
  "description": "Schedule a planned workout on a specific date.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "scheduledDate": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
      "sport": { "type": "string", "enum": ["cycling", "running", "swimming", "other"] },
      "durationMin": { "type": "integer", "minimum": 1 },
      "targetZone": { "type": "string" },
      "description": { "type": "string" },
      "notes": { "type": "string" }
    },
    "required": ["scheduledDate", "sport", "durationMin"]
  }
}
```

Implementation: direct D1 insert into `planned_workouts` with `athlete_id = apiKey.userId`, `workout_id = null`, `session_json`, `notes`. Returns `{ id }`.

### `list_planned_workouts` (scope: `read:activities`)

```json
{
  "name": "list_planned_workouts",
  "description": "List planned workouts between two dates (inclusive).",
  "inputSchema": {
    "type": "object",
    "properties": {
      "from": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
      "to": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" }
    },
    "required": ["from", "to"]
  }
}
```

Implementation: query `planned_workouts` for `athlete_id = apiKey.userId`, `scheduled_date BETWEEN from AND to`, parse `session_json`. Also left-joins `workouts` table to include library workout name/sport/tss for workouts scheduled via the old calendar route.

### `delete_planned_workout` (scope: `write:training`)

```json
{
  "name": "delete_planned_workout",
  "description": "Remove a planned workout by id.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "id": { "type": "string" }
    },
    "required": ["id"]
  }
}
```

Implementation: `DELETE FROM planned_workouts WHERE id = ? AND athlete_id = ?`.

## Files Changed

| File | Change |
|---|---|
| `apps/api/src/routes/training.ts` | Add `POST/GET/DELETE /planned-workouts` handlers |
| `apps/api/src/routes/mcp.ts` | Add `schedule_workout`, `list_planned_workouts`, `delete_planned_workout` tools; add `write:training` scope |

No schema changes — `planned_workouts.session_json` and `planned_workouts.workout_id` (nullable) already exist.

## Error Handling

| Condition | Response |
|---|---|
| Missing `scheduledDate`, `sport`, or `durationMin` | `400 name + sport + durationMin required` |
| Invalid `scheduledDate` format | `400 scheduledDate must be YYYY-MM-DD` |
| Invalid `sport` value | `400 invalid sport` |
| `athleteId` provided but caller not active coach | `403 not your athlete` |
| `DELETE` on non-existent or unowned id | `200 { ok: true }` (idempotent) |

## Out of Scope

- Linking a planned workout to a completed activity (compliance tracking) — existing pipeline handles this
- Editing a planned workout (PATCH) — delete + recreate
- Push notification to Garmin when a workout is scheduled (separate integration)
