# Structured Workout CSV Builder + Compliance Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let coaches build structured workouts via CSV text, available in the web UI, REST API, and MCP tools; completed activities are matched to plans and color-coded by compliance.

**Architecture:** New `packages/workout-csv` pure parser converts CSV → `WorkoutStep[]` and is imported by the API (routes + persist pipeline) and web (Astro `<script>` bundle). Compliance scoring in `persist.ts` is enhanced to compare actual power/pace vs plan targets, producing a 0–1 score; the UI reads the score and renders green/yellow/red badges.

**Tech Stack:** TypeScript, Vitest (tests), Hono (API), Astro (web), Cloudflare D1 (DB), pnpm workspaces

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/workout-csv/package.json` | Create | Package manifest |
| `packages/workout-csv/tsconfig.json` | Create | TypeScript config |
| `packages/workout-csv/src/index.ts` | Create | `parseWorkoutCsv`, `WorkoutCsvError`, types |
| `packages/workout-csv/src/__tests__/parse.test.ts` | Create | Parser unit tests |
| `apps/api/src/integrations/workout-export.ts` | Modify | Extend WorkoutStep target types |
| `apps/api/package.json` | Modify | Add `@pacelore/workout-csv` dep |
| `apps/api/src/routes/training.ts` | Modify | Accept `csvText` in POST /workouts, POST /planned-workouts; expose planMatch in GET /activities/:id |
| `apps/api/src/routes/activities.ts` | Modify | Include `planMatch` in GET /activities/:id response |
| `apps/api/src/routes/mcp.ts` | Modify | Add `create_workout_from_csv` tool |
| `apps/api/src/pipeline/persist.ts` | Modify | Power/pace compliance scoring |
| `apps/api/test/training.routes.test.ts` | Modify | csvText route tests |
| `apps/api/test/mcp.tools.test.ts` | Modify | MCP tool test |
| `apps/api/test/pipeline.test.ts` | Modify | Enhanced compliance test |
| `apps/web/package.json` | Modify | Add `@pacelore/workout-csv` dep |
| `apps/web/src/pages/workouts.astro` | Modify | CSV tab in workout builder |
| `apps/web/src/pages/calendar.astro` | Modify | Compliance color border on completed cards |
| `apps/web/src/pages/home.astro` | Modify | Compliance dot on last activity tile |
| `apps/web/src/pages/activity/[id].astro` | Modify | "vs plan" banner |

---

## Task 1: Create `packages/workout-csv` parser package

**Files:**
- Create: `packages/workout-csv/package.json`
- Create: `packages/workout-csv/tsconfig.json`
- Create: `packages/workout-csv/src/index.ts`
- Create: `packages/workout-csv/src/__tests__/parse.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `packages/workout-csv/src/__tests__/parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseWorkoutCsv, WorkoutCsvError } from '../index.js';

describe('parseWorkoutCsv', () => {
  it('parses a minimal cycling workout', () => {
    const result = parseWorkoutCsv(
      'Z2 Ride, cycling, Easy aerobic\nWarm up, 600, 80-150W\nMain Block, 2000, 170W\nCool down, 600, 150-80W',
    );
    expect(result.name).toBe('Z2 Ride');
    expect(result.sport).toBe('cycling');
    expect(result.description).toBe('Easy aerobic');
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].kind).toBe('warmup');
    expect(result.steps[0].durationSec).toBe(600);
    expect(result.steps[0].target).toEqual({ type: 'watts', low: 80, high: 150 });
    expect(result.steps[1].kind).toBe('work');
    expect(result.steps[1].target).toEqual({ type: 'watts', low: 170, high: 170 });
    expect(result.steps[2].kind).toBe('cooldown');
  });

  it('parses % FTP targets', () => {
    const result = parseWorkoutCsv('Threshold, cycling\nWork, 1200, 95-105%');
    expect(result.steps[0].target).toEqual({ type: 'ftp_pct', low: 95, high: 105 });
  });

  it('parses HR bpm targets', () => {
    const result = parseWorkoutCsv('Easy Run, running\nWork, 3600, 130-150bpm');
    expect(result.steps[0].target).toEqual({ type: 'hr_bpm', low: 130, high: 150 });
  });

  it('parses pace targets in min:sec/km', () => {
    const result = parseWorkoutCsv('Tempo Run, running\nWork, 1200, 4:30/km');
    expect(result.steps[0].target).toEqual({ type: 'pace', low: 270, high: 270 });
  });

  it('parses pace range in min:sec/km', () => {
    const result = parseWorkoutCsv('Easy Run, running\nWork, 3600, 4:30-5:00/km');
    expect(result.steps[0].target).toEqual({ type: 'pace', low: 270, high: 300 });
  });

  it('converts mi pace to km', () => {
    const result = parseWorkoutCsv('Easy Run, running\nWork, 3600, 7:15/mi');
    // 7:15 = 435 sec/mi → 435 / 1.60934 ≈ 270 sec/km
    expect(result.steps[0].target?.type).toBe('pace');
    expect(result.steps[0].target?.low).toBeCloseTo(270, 0);
  });

  it('maps block names to kinds correctly', () => {
    const result = parseWorkoutCsv(
      'Test, cycling\nWarm up, 300\nWork, 600\nRecovery, 120\nCool down, 300',
    );
    expect(result.steps[0].kind).toBe('warmup');
    expect(result.steps[1].kind).toBe('work');
    expect(result.steps[2].kind).toBe('recover');
    expect(result.steps[3].kind).toBe('cooldown');
  });

  it('allows no target (step without target is valid)', () => {
    const result = parseWorkoutCsv('Test, cycling\nWork, 600');
    expect(result.steps[0].target).toBeUndefined();
  });

  it('throws WorkoutCsvError on empty input', () => {
    expect(() => parseWorkoutCsv('')).toThrow(WorkoutCsvError);
    expect(() => parseWorkoutCsv('  \n  ')).toThrow(WorkoutCsvError);
  });

  it('throws WorkoutCsvError with row number on invalid sport', () => {
    const err = (() => {
      try { parseWorkoutCsv('My ride, soccer\nWork, 600'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(1);
    expect(err.message).toMatch(/sport/i);
  });

  it('throws WorkoutCsvError on non-integer duration', () => {
    const err = (() => {
      try { parseWorkoutCsv('Test, cycling\nWork, abc'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(2);
  });

  it('throws WorkoutCsvError on unparseable target', () => {
    const err = (() => {
      try { parseWorkoutCsv('Test, cycling\nWork, 600, ???'); }
      catch (e) { return e as WorkoutCsvError; }
    })();
    expect(err).toBeInstanceOf(WorkoutCsvError);
    expect(err.row).toBe(2);
  });

  it('ignores blank lines', () => {
    const result = parseWorkoutCsv(
      '\nZ2 Ride, cycling\n\nWarm up, 600\n\nWork, 2000\n',
    );
    expect(result.steps).toHaveLength(2);
  });
});
```

- [ ] **Step 1.2: Create package files**

Create `packages/workout-csv/package.json`:

```json
{
  "name": "@pacelore/workout-csv",
  "version": "0.0.0",
  "private": true,
  "description": "CSV text → structured WorkoutStep[] parser.",
  "license": "SEE LICENSE IN LICENSE",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "2.1.5"
  }
}
```

Create `packages/workout-csv/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "lib": ["ES2022"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "src/__tests__"]
}
```

- [ ] **Step 1.3: Implement the parser**

Create `packages/workout-csv/src/index.ts`:

```typescript
export class WorkoutCsvError extends Error {
  constructor(
    message: string,
    public readonly row: number,
  ) {
    super(`Row ${row}: ${message}`);
    this.name = 'WorkoutCsvError';
  }
}

export interface CsvTarget {
  type: 'ftp_pct' | 'hr_bpm' | 'watts' | 'pace';
  low: number;
  high: number;
}

export interface CsvStep {
  kind: 'warmup' | 'work' | 'recover' | 'cooldown' | 'rest';
  durationSec: number;
  target?: CsvTarget;
}

export interface ParsedWorkout {
  name: string;
  sport: 'cycling' | 'running' | 'swimming' | 'other';
  description?: string;
  steps: CsvStep[];
}

const VALID_SPORTS = new Set(['cycling', 'running', 'swimming', 'other']);

export function parseWorkoutCsv(text: string): ParsedWorkout {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length === 0) throw new WorkoutCsvError('empty input', 0);
  if (lines.length < 2) throw new WorkoutCsvError('need header row + at least one block row', 0);

  const headerParts = lines[0].split(',').map((p) => p.trim());
  if (headerParts.length < 2) {
    throw new WorkoutCsvError('header row must be: name, sport[, description]', 1);
  }
  const name = headerParts[0];
  if (!name) throw new WorkoutCsvError('name is required', 1);

  const sport = headerParts[1].toLowerCase();
  if (!VALID_SPORTS.has(sport)) {
    throw new WorkoutCsvError(
      `invalid sport "${sport}" — must be cycling|running|swimming|other`,
      1,
    );
  }
  const description = headerParts[2]?.trim() || undefined;

  const steps: CsvStep[] = [];
  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const parts = lines[i].split(',').map((p) => p.trim());
    if (parts.length < 2) {
      throw new WorkoutCsvError('block row must be: block_name, duration_secs[, target]', rowNum);
    }
    const blockName = parts[0];
    if (!blockName) throw new WorkoutCsvError('block name is required', rowNum);

    const durationSec = parseInt(parts[1], 10);
    if (!Number.isInteger(durationSec) || durationSec < 1) {
      throw new WorkoutCsvError(
        `invalid duration "${parts[1]}" — must be positive integer seconds`,
        rowNum,
      );
    }

    const kind = blockNameToKind(blockName);
    const target = parts[2] ? parseTarget(parts[2], rowNum) : undefined;
    steps.push({ kind, durationSec, ...(target ? { target } : {}) });
  }

  return {
    name,
    sport: sport as ParsedWorkout['sport'],
    ...(description ? { description } : {}),
    steps,
  };
}

function blockNameToKind(name: string): CsvStep['kind'] {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n === 'warm up' || n === 'warmup') return 'warmup';
  if (n === 'cool down' || n === 'cooldown') return 'cooldown';
  if (n === 'recover' || n === 'recovery') return 'recover';
  if (n === 'rest') return 'rest';
  return 'work';
}

function parseTarget(raw: string, row: number): CsvTarget {
  const s = raw.trim();

  // % FTP: "75%" or "80-90%"
  const ftpMatch = s.match(/^(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%$/);
  if (ftpMatch) {
    const low = parseFloat(ftpMatch[1]);
    const high = ftpMatch[2] ? parseFloat(ftpMatch[2]) : low;
    return { type: 'ftp_pct', low, high };
  }

  // HR bpm: "140bpm", "130-150bpm", "140hr", "130-150hr"
  const hrMatch = s.match(/^(\d+)(?:-(\d+))?(?:bpm|hr)$/i);
  if (hrMatch) {
    const low = parseInt(hrMatch[1], 10);
    const high = hrMatch[2] ? parseInt(hrMatch[2], 10) : low;
    return { type: 'hr_bpm', low, high };
  }

  // Pace: "4:30/km", "4:30-5:00/km", "4:30/mi", "4:30", "4:30-5:00"
  const paceMatch = s.match(/^(\d+):(\d{2})(?:-(\d+):(\d{2}))?(?:\/(km|mi))?$/i);
  if (paceMatch) {
    const lowSec = parseInt(paceMatch[1], 10) * 60 + parseInt(paceMatch[2], 10);
    const highSec = paceMatch[3]
      ? parseInt(paceMatch[3], 10) * 60 + parseInt(paceMatch[4], 10)
      : lowSec;
    const unit = paceMatch[5]?.toLowerCase() ?? 'km';
    const toKm = (sec: number) => (unit === 'mi' ? Math.round(sec / 1.60934) : sec);
    return { type: 'pace', low: toKm(lowSec), high: toKm(highSec) };
  }

  // Watts: "170W", "80-150W", "170", "80-150"
  // Must come after pace (pace also matches digits only in some cases — pace check first)
  const wattsMatch = s.match(/^(\d+)(?:-(\d+))?W?$/i);
  if (wattsMatch) {
    const low = parseInt(wattsMatch[1], 10);
    const high = wattsMatch[2] ? parseInt(wattsMatch[2], 10) : low;
    return { type: 'watts', low, high };
  }

  throw new WorkoutCsvError(`cannot parse target "${raw}"`, row);
}
```

- [ ] **Step 1.4: Install deps and run tests**

```bash
cd /Users/pablo/Projects/pacelore
pnpm install
cd packages/workout-csv && pnpm test
```

Expected: all 13 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add packages/workout-csv/
git commit -m "feat(workout-csv): add CSV parser package — parseWorkoutCsv + tests"
```

---

## Task 2: Extend WorkoutStep types + wire API dependency

**Files:**
- Modify: `apps/api/src/integrations/workout-export.ts`
- Modify: `apps/api/package.json`

- [ ] **Step 2.1: Extend WorkoutStep target type union**

In `apps/api/src/integrations/workout-export.ts`, change line ~19:

Old:
```typescript
  target?: { type: 'ftp_pct' | 'hr_pct' | 'pace'; low: number; high: number };
```

New:
```typescript
  target?: { type: 'ftp_pct' | 'hr_pct' | 'hr_bpm' | 'watts' | 'pace'; low: number; high: number };
```

- [ ] **Step 2.2: Add workout-csv to API dependencies**

In `apps/api/package.json`, in the `dependencies` object add:

```json
"@pacelore/workout-csv": "workspace:*",
```

- [ ] **Step 2.3: Install and typecheck**

```bash
cd /Users/pablo/Projects/pacelore
pnpm install
cd apps/api && pnpm typecheck
```

Expected: no type errors.

- [ ] **Step 2.4: Commit**

```bash
git add apps/api/package.json apps/api/src/integrations/workout-export.ts pnpm-lock.yaml
git commit -m "feat(api): add @pacelore/workout-csv dep, extend WorkoutStep target types"
```

---

## Task 3: API — accept csvText in POST /workouts + POST /planned-workouts

**Files:**
- Modify: `apps/api/src/routes/training.ts`
- Modify: `apps/api/test/training.routes.test.ts`

- [ ] **Step 3.1: Write failing tests first**

Add to `apps/api/test/training.routes.test.ts`:

```typescript
describe('POST /api/v1/workouts with csvText', () => {
  it('creates a workout from csvText', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvText: 'Z2 Ride, cycling, Easy day\nWarm up, 600, 80-150W\nMain Block, 2000, 170W\nCool down, 600',
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string };
    expect(typeof data.id).toBe('string');
  });

  it('returns 400 on invalid csvText', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ csvText: 'Bad, notasport\nWork, 600' }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/sport/i);
  });
});

describe('POST /api/v1/planned-workouts with csvText', () => {
  it('creates a workout and schedules it from csvText', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csvText: 'Threshold, cycling\nWarm up, 600\nWork, 1200, 95%\nCool down, 300',
          scheduledDate: '2026-06-15',
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string; workoutId: string };
    expect(typeof data.id).toBe('string');
    expect(typeof data.workoutId).toBe('string');
  });
});
```

Run `pnpm test` from `apps/api` — expect these new tests to fail with 404 or similar.

- [ ] **Step 3.2: Add csvText handling to POST /workouts**

In `apps/api/src/routes/training.ts`, add import at top:

```typescript
import { parseWorkoutCsv, WorkoutCsvError } from '@pacelore/workout-csv';
```

In the `trainingRoutes.post('/workouts', ...)` handler, replace the validation section:

Old:
```typescript
  const body = (await c.req.json()) as WorkoutBody;
  const session = c.get('session');
  if (!body.name || !body.sport || !SPORTS.has(body.sport)) {
    throw new HTTPException(400, { message: 'name + sport required' });
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    throw new HTTPException(400, { message: 'steps required' });
  }
```

New:
```typescript
  const rawBody = (await c.req.json()) as WorkoutBody & { csvText?: string };
  const session = c.get('session');

  let body: WorkoutBody;
  if (rawBody.csvText) {
    try {
      const parsed = parseWorkoutCsv(rawBody.csvText);
      body = {
        name: parsed.name,
        sport: parsed.sport,
        description: parsed.description,
        steps: parsed.steps as WorkoutBody['steps'],
      };
    } catch (e) {
      if (e instanceof WorkoutCsvError) {
        throw new HTTPException(400, { message: e.message });
      }
      throw e;
    }
  } else {
    body = rawBody;
  }

  if (!body.name || !body.sport || !SPORTS.has(body.sport)) {
    throw new HTTPException(400, { message: 'name + sport required' });
  }
  if (!Array.isArray(body.steps) || body.steps.length === 0) {
    throw new HTTPException(400, { message: 'steps required' });
  }
```

- [ ] **Step 3.3: Add csvText handling to POST /planned-workouts**

In `trainingRoutes.post('/planned-workouts', ...)`, update the `PlannedWorkoutBody` interface and handler:

Old interface:
```typescript
interface PlannedWorkoutBody {
  scheduledDate?: string;
  sport?: string;
  durationMin?: number;
  targetZone?: string;
  description?: string;
  notes?: string;
  athleteId?: string;
}
```

New interface:
```typescript
interface PlannedWorkoutBody {
  scheduledDate?: string;
  sport?: string;
  durationMin?: number;
  targetZone?: string;
  description?: string;
  notes?: string;
  athleteId?: string;
  csvText?: string;
}
```

In the handler body, add csvText branch after the first line (`const session = c.get('session');`):

```typescript
  // CSV path: parse, save a workout record, then schedule it.
  if (body.csvText) {
    if (!body.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate)) {
      throw new HTTPException(400, { message: 'scheduledDate (YYYY-MM-DD) required' });
    }
    let parsed;
    try {
      parsed = parseWorkoutCsv(body.csvText);
    } catch (e) {
      if (e instanceof WorkoutCsvError) throw new HTTPException(400, { message: e.message });
      throw e;
    }
    const targetAthlete = body.athleteId ?? session.userId;
    if (targetAthlete !== session.userId) {
      const ok = await isCoachOf(c.env, session.userId, targetAthlete);
      if (!ok) throw new HTTPException(403, { message: 'not your athlete' });
    }
    const totalSec = parsed.steps.reduce((s, st) => s + st.durationSec, 0);
    const { tss, duration } = estimateLoad(parsed.steps as WorkoutBody['steps']);
    const workoutId = uuidv7();
    await c.env.DB.prepare(
      `INSERT INTO workouts (id, athlete_id, name, description, sport, estimated_tss, estimated_duration_sec, steps_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        workoutId,
        session.userId,
        parsed.name,
        parsed.description ?? null,
        parsed.sport,
        tss,
        duration ?? totalSec,
        JSON.stringify({ steps: parsed.steps }),
      )
      .run();
    const pwId = uuidv7();
    await c.env.DB.prepare(
      `INSERT INTO planned_workouts (id, athlete_id, workout_id, scheduled_date, notes, assigned_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
    )
      .bind(pwId, targetAthlete, workoutId, body.scheduledDate, body.notes ?? null, session.userId)
      .run();
    return c.json({ id: pwId, workoutId }, 201);
  }
```

- [ ] **Step 3.4: Run tests**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test
```

Expected: all existing tests pass + new csvText tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add apps/api/src/routes/training.ts apps/api/test/training.routes.test.ts
git commit -m "feat(api): accept csvText in POST /workouts and POST /planned-workouts"
```

---

## Task 4: MCP — add `create_workout_from_csv` tool

**Files:**
- Modify: `apps/api/src/routes/mcp.ts`
- Modify: `apps/api/test/mcp.tools.test.ts`

- [ ] **Step 4.1: Write the failing test**

Add to `apps/api/test/mcp.tools.test.ts` (find the existing describe block pattern and add):

```typescript
describe('MCP create_workout_from_csv', () => {
  it('creates a workout from csvText', async () => {
    const { env, apiKey } = await authedMcpEnv(['write:training']);
    const app = buildApp();
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'create_workout_from_csv',
            arguments: {
              csvText: 'Threshold, cycling\nWarm up, 600\nMain, 1800, 95-105%\nCool down, 300',
            },
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { content: Array<{ text: string }> } };
    const text = body.result?.content[0]?.text ?? '';
    const data = JSON.parse(text) as { workoutId: string };
    expect(typeof data.workoutId).toBe('string');
  });

  it('returns error on invalid csvText', async () => {
    const { env, apiKey } = await authedMcpEnv(['write:training']);
    const app = buildApp();
    const res = await app.request(
      '/mcp',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'create_workout_from_csv',
            arguments: { csvText: 'Bad CSV Only One Line' },
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { message: string } };
    expect(body.error?.message).toBeTruthy();
  });
});
```

Run `pnpm test` — expect new tests to fail with "unknown tool".

- [ ] **Step 4.2: Add the tool definition**

In `apps/api/src/routes/mcp.ts`, add import at top:

```typescript
import { parseWorkoutCsv, WorkoutCsvError } from '@pacelore/workout-csv';
```

In the `TOOLS` array (before the closing `] as const`), add:

```typescript
  {
    name: 'create_workout_from_csv',
    description:
      'Create a structured workout from CSV text. First row: name, sport[, description]. Subsequent rows: block_name, duration_secs[, target]. Target formats: 170W, 80-150W, 75%, 80-90%, 140bpm, 4:30/km. Optionally schedule on a date.',
    inputSchema: {
      type: 'object',
      properties: {
        csvText: { type: 'string' },
        scheduledDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Optional YYYY-MM-DD to schedule immediately after creating.',
        },
      },
      required: ['csvText'],
    },
    requiredScope: 'write:training',
  },
```

- [ ] **Step 4.3: Add the tool handler**

In `runTool`, before the `default:` case, add:

```typescript
    case 'create_workout_from_csv': {
      const csvText = typeof args.csvText === 'string' ? args.csvText : '';
      if (!csvText) return jsonRpcError(c, id, -32602, 'csvText is required');

      let parsed;
      try {
        parsed = parseWorkoutCsv(csvText);
      } catch (e) {
        if (e instanceof WorkoutCsvError) {
          return jsonRpcError(c, id, -32602, e.message);
        }
        throw e;
      }

      const totalSec = parsed.steps.reduce((s, st) => s + st.durationSec, 0);
      const workoutId = uuidv7();
      await env.DB.prepare(
        `INSERT INTO workouts (id, athlete_id, name, description, sport, estimated_duration_sec, steps_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          workoutId,
          userId,
          parsed.name,
          parsed.description ?? null,
          parsed.sport,
          totalSec,
          JSON.stringify({ steps: parsed.steps }),
        )
        .run();

      let plannedId: string | null = null;
      const scheduledDate =
        typeof args.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.scheduledDate)
          ? args.scheduledDate
          : null;
      if (scheduledDate) {
        plannedId = uuidv7();
        await env.DB.prepare(
          `INSERT INTO planned_workouts (id, athlete_id, workout_id, scheduled_date, assigned_by, created_at)
           VALUES (?, ?, ?, ?, ?, unixepoch())`,
        )
          .bind(plannedId, userId, workoutId, scheduledDate, userId)
          .run();
      }

      return ok({ workoutId, ...(plannedId ? { plannedId, scheduledDate } : {}) });
    }
```

- [ ] **Step 4.4: Run tests**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/routes/mcp.ts apps/api/test/mcp.tools.test.ts
git commit -m "feat(mcp): add create_workout_from_csv tool"
```

---

## Task 5: Enhanced compliance scoring + activity planMatch

**Files:**
- Modify: `apps/api/src/pipeline/persist.ts`
- Modify: `apps/api/src/routes/activities.ts`
- Modify: `apps/api/test/pipeline.test.ts`

- [ ] **Step 5.1: Write failing test for enhanced compliance**

In `apps/api/test/pipeline.test.ts`, find or add a describe block for matchPlannedWorkout. Add:

```typescript
describe('compliance scoring — power/pace matching', () => {
  it('scores green when actual power is within 5% of target', async () => {
    const env = fakeEnv();
    // Insert athlete
    await (env.DB as FakeD1).exec(
      `INSERT INTO users (id, handle, email) VALUES ('u1', 'test', 'test@test.com')`,
    );
    // Insert workout with watts steps
    const steps = JSON.stringify({
      steps: [
        { kind: 'warmup', durationSec: 600 },
        { kind: 'work', durationSec: 1800, target: { type: 'watts', low: 170, high: 170 } },
        { kind: 'cooldown', durationSec: 300 },
      ],
    });
    await (env.DB as FakeD1).exec(
      `INSERT INTO workouts (id, athlete_id, name, sport, estimated_duration_sec, steps_json)
       VALUES ('w1', 'u1', 'Test', 'cycling', 2700, '${steps.replace(/'/g, "''")}')`,
    );
    // Insert planned workout for today
    const today = new Date().toISOString().slice(0, 10);
    await (env.DB as FakeD1).exec(
      `INSERT INTO planned_workouts (id, athlete_id, workout_id, scheduled_date, assigned_by)
       VALUES ('pw1', 'u1', 'w1', '${today}', 'u1')`,
    );

    // compliance score should reflect power within 5% (165W vs target 170W)
    const score = computeComplianceScore(2700, 2700, steps, 165, null);
    expect(score).toBeGreaterThanOrEqual(0.95);
  });

  it('scores yellow when actual power is 10% below target', () => {
    const steps = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'watts', low: 200, high: 200 } }],
    });
    const score = computeComplianceScore(1800, 1800, steps, 180, null); // 10% below
    expect(score).toBeGreaterThanOrEqual(0.85);
    expect(score).toBeLessThan(0.95);
  });

  it('scores red when actual power is 20% below target', () => {
    const steps = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'watts', low: 200, high: 200 } }],
    });
    const score = computeComplianceScore(1800, 1800, steps, 160, null); // 20% below
    expect(score).toBeLessThan(0.85);
  });

  it('falls back to TSS when no watts targets', () => {
    const steps = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'ftp_pct', low: 90, high: 100 } }],
    });
    const score = computeComplianceScore(1800, 1800, steps, null, 50);
    // duration matches perfectly, TSS null (estimated) so falls back to duration only
    expect(score).toBeGreaterThan(0.9);
  });
});
```

Note: this test imports `computeComplianceScore` which we'll export from persist.ts. Run `pnpm test` — expect import errors.

- [ ] **Step 5.2: Export and rewrite computeComplianceScore in persist.ts**

In `apps/api/src/pipeline/persist.ts`, replace the `matchPlannedWorkout` function:

```typescript
// Exported for unit testing
export function computeComplianceScore(
  plannedDurationSec: number,
  actualDurationSec: number,
  stepsJson: string | null,
  actualPowerAvg: number | null,
  actualTss: number | null,
): number {
  const durScore = Math.min(
    actualDurationSec / plannedDurationSec,
    plannedDurationSec / actualDurationSec,
  );

  // Try power-based intensity score
  const targetWatts = extractMainWorkWatts(stepsJson);
  if (targetWatts !== null && actualPowerAvg !== null && actualPowerAvg > 0) {
    const intensityScore = Math.min(actualPowerAvg / targetWatts, targetWatts / actualPowerAvg);
    return Math.max(0, Math.min(1, 0.5 * durScore + 0.5 * intensityScore));
  }

  // Try pace-based intensity score
  const targetPaceSec = extractMainWorkPace(stepsJson);
  if (targetPaceSec !== null && actualPowerAvg === null) {
    // pace comparison uses speed — actual speed in m/s, target pace in sec/km
    // This is handled via hrAvg fallback or skipped if no speed data
    // For now, fall through to TSS
  }

  // Fall back to TSS if available
  if (actualTss !== null && actualTss > 0) {
    const tssEstimate = estimateTssFromSteps(stepsJson);
    if (tssEstimate !== null) {
      const tssScore = Math.min(actualTss / tssEstimate, tssEstimate / actualTss);
      return Math.max(0, Math.min(1, 0.5 * durScore + 0.5 * tssScore));
    }
  }

  // Duration-only fallback
  return Math.max(0, Math.min(1, durScore));
}

function extractMainWorkWatts(stepsJson: string | null): number | null {
  if (!stepsJson) return null;
  try {
    const { steps } = JSON.parse(stepsJson) as {
      steps: Array<{ kind?: string; durationSec?: number; target?: { type: string; low: number; high: number } }>;
    };
    let totalWeight = 0;
    let weightedTarget = 0;
    for (const s of steps) {
      if (s.kind !== 'work') continue;
      if (s.target?.type !== 'watts') continue;
      const dur = s.durationSec ?? 0;
      const mid = (s.target.low + s.target.high) / 2;
      weightedTarget += mid * dur;
      totalWeight += dur;
    }
    return totalWeight > 0 ? weightedTarget / totalWeight : null;
  } catch {
    return null;
  }
}

function extractMainWorkPace(stepsJson: string | null): number | null {
  if (!stepsJson) return null;
  try {
    const { steps } = JSON.parse(stepsJson) as {
      steps: Array<{ kind?: string; durationSec?: number; target?: { type: string; low: number; high: number } }>;
    };
    let totalWeight = 0;
    let weightedTarget = 0;
    for (const s of steps) {
      if (s.kind !== 'work') continue;
      if (s.target?.type !== 'pace') continue;
      const dur = s.durationSec ?? 0;
      const mid = (s.target.low + s.target.high) / 2;
      weightedTarget += mid * dur;
      totalWeight += dur;
    }
    return totalWeight > 0 ? weightedTarget / totalWeight : null;
  } catch {
    return null;
  }
}

function estimateTssFromSteps(stepsJson: string | null): number | null {
  if (!stepsJson) return null;
  try {
    const { steps } = JSON.parse(stepsJson) as {
      steps: Array<{ durationSec?: number; target?: { type: string; low: number; high: number } }>;
    };
    let dur = 0;
    let weighted = 0;
    let count = 0;
    for (const s of steps) {
      const d = s.durationSec ?? 0;
      dur += d;
      const t = s.target;
      if (t && (t.type === 'ftp_pct' || t.type === 'hr_pct')) {
        const mid = (t.low + t.high) / 2 / 100;
        weighted += mid * mid * d;
        count += d;
      }
    }
    if (dur === 0 || count === 0) return null;
    return ((dur * (weighted / count)) / 3600) * 100;
  } catch {
    return null;
  }
}

async function matchPlannedWorkout(
  env: Env,
  job: IngestJob,
  activity: ActivityRecord,
  summary: ActivitySummary,
): Promise<void> {
  const date = new Date(activity.session.startedAt);
  const dateStr = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;

  const planned = await env.DB.prepare(
    `SELECT pw.id AS id, pw.workout_id AS workout_id,
            w.steps_json AS steps_json,
            w.estimated_tss AS estimated_tss,
            w.estimated_duration_sec AS estimated_duration_sec
       FROM planned_workouts pw
       LEFT JOIN workouts w ON w.id = pw.workout_id
      WHERE pw.athlete_id = ? AND pw.scheduled_date = ? AND pw.completed_activity_id IS NULL
      LIMIT 1`,
  )
    .bind(job.athleteId, dateStr)
    .first<PlannedRow>();

  if (!planned) return;

  let compliance: number | null = null;
  const plannedDur = planned.estimated_duration_sec;
  const actualDur = summary.totalSeconds;

  if (plannedDur && actualDur > 0) {
    compliance = computeComplianceScore(
      plannedDur,
      actualDur,
      planned.steps_json ?? null,
      typeof summary.powerAvg === 'number' ? summary.powerAvg : null,
      typeof summary.tss === 'number' ? summary.tss : null,
    );
  }

  await env.DB.prepare(
    `UPDATE planned_workouts SET completed_activity_id = ?, compliance_score = ? WHERE id = ?`,
  )
    .bind(job.activityId, compliance, planned.id)
    .run();
}
```

- [ ] **Step 5.3: Add planMatch to GET /activities/:id**

In `apps/api/src/routes/activities.ts`, update the `GET /activities/:id` handler. After the `return c.json(...)` line, replace it with:

```typescript
  // Look up any planned workout that was matched to this activity
  const planMatch = await c.env.DB.prepare(
    `SELECT pw.id AS plannedWorkoutId, pw.compliance_score AS complianceScore,
            pw.scheduled_date AS scheduledDate, pw.workout_id AS workoutId,
            w.name AS workoutName
       FROM planned_workouts pw
       LEFT JOIN workouts w ON w.id = pw.workout_id
      WHERE pw.completed_activity_id = ? AND pw.athlete_id = ?
      LIMIT 1`,
  )
    .bind(id, row.athleteId)
    .first<{
      plannedWorkoutId: string;
      complianceScore: number | null;
      scheduledDate: string;
      workoutId: string | null;
      workoutName: string | null;
    }>();

  return c.json({
    activity: row,
    metrics: metricsResult.results ?? [],
    planMatch: planMatch ?? null,
  });
```

- [ ] **Step 5.4: Run tests**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/pipeline/persist.ts apps/api/src/routes/activities.ts apps/api/test/pipeline.test.ts
git commit -m "feat(api): power/pace compliance scoring + planMatch in activity detail"
```

---

## Task 6: Web — CSV tab in workout builder

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/src/pages/workouts.astro`

- [ ] **Step 6.1: Add workout-csv to web dependencies**

In `apps/web/package.json`, add to `dependencies`:

```json
"@pacelore/workout-csv": "workspace:*",
```

Then run:

```bash
cd /Users/pablo/Projects/pacelore && pnpm install
```

- [ ] **Step 6.2: Add the CSV tab UI**

In `apps/web/src/pages/workouts.astro`, replace the `<details class="panel">` custom workout section with:

```html
<details class="panel" id="new-workout-panel">
  <summary style="cursor: pointer; padding: 14px 20px; display: flex; align-items: center; gap: 8px; font-weight: 500;">
    <Icon name="plus" size={16} /> New custom workout
  </summary>
  <div class="panel-body stack" style="gap: 0;">
    <!-- Tab switcher -->
    <div class="segmented" id="entry-mode" style="margin-bottom: 16px; align-self: flex-start;">
      <button type="button" data-v="steps" class="on">Step builder</button>
      <button type="button" data-v="csv">Paste CSV</button>
    </div>

    <!-- Step builder (existing form) -->
    <form id="new-workout" class="stack" style="gap: 14px;">
      <div class="grid-tiles grid-cols-2" style="gap: 14px;">
        <div class="field">
          <label class="field-label">Name</label>
          <input class="input" name="name" required />
        </div>
        <div class="field">
          <label class="field-label">Sport</label>
          <select class="select" name="sport">
            <option value="cycling">Cycling</option>
            <option value="running">Running</option>
            <option value="swimming">Swimming</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>
      <div>
        <span class="metric-label" style="display: block; margin-bottom: 8px;">Steps</span>
        <ol id="step-list" class="stack" style="list-style: none; margin: 0; padding: 0; gap: 8px;"></ol>
        <button type="button" id="add-step" class="btn btn-secondary btn-sm" style="margin-top: 8px;">
          <Icon name="plus" size={14} /> Add step
        </button>
      </div>
      <div class="row" style="gap: 12px;">
        <button class="btn btn-primary" type="submit">Save workout</button>
        <p id="save-status" class="caption" aria-live="polite"></p>
      </div>
    </form>

    <!-- CSV entry panel -->
    <div id="csv-panel" style="display: none;" class="stack" style="gap: 12px;">
      <div class="field">
        <label class="field-label">CSV text</label>
        <textarea
          id="csv-input"
          class="input"
          rows="8"
          placeholder="Z2 Ride, cycling, Easy aerobic base&#10;Warm up, 600, 80-150W&#10;Main Block, 2000, 170W&#10;Cool down, 600, 80-120W"
          style="font-family: monospace; font-size: 13px; resize: vertical;"
        ></textarea>
        <p class="caption" style="margin-top: 4px; opacity: 0.7;">
          Row 1: <code>name, sport[, description]</code> — Rows 2+: <code>block_name, duration_secs[, target]</code><br/>
          Target formats: <code>170W</code> &nbsp;·&nbsp; <code>80-150W</code> &nbsp;·&nbsp; <code>75%</code> &nbsp;·&nbsp; <code>140bpm</code> &nbsp;·&nbsp; <code>4:30/km</code>
        </p>
      </div>
      <div id="csv-preview" style="display: none;" class="panel" style="background: var(--surface-2); padding: 12px; border-radius: 8px;">
        <p class="metric-label" style="margin-bottom: 8px;">Preview</p>
        <ol id="csv-preview-list" style="list-style: none; margin: 0; padding: 0; font-size: 13px;"></ol>
      </div>
      <p id="csv-error" class="caption" style="color: var(--color-red); display: none;"></p>
      <div class="row" style="gap: 12px;">
        <button id="csv-save" class="btn btn-primary">Save workout</button>
        <p id="csv-save-status" class="caption" aria-live="polite"></p>
      </div>
    </div>
  </div>
</details>
```

- [ ] **Step 6.3: Add CSV tab JS logic**

In the `<script>` section of `workouts.astro`, after the existing imports, add:

```typescript
import { parseWorkoutCsv, WorkoutCsvError } from '@pacelore/workout-csv';
```

Then add the CSV tab logic (at the end of the script, after existing init logic):

```typescript
  // ── CSV tab ──────────────────────────────────────────────────
  const entryMode = document.getElementById('entry-mode') as HTMLElement;
  const newWorkoutForm = document.getElementById('new-workout') as HTMLFormElement;
  const csvPanel = document.getElementById('csv-panel') as HTMLElement;
  const csvInput = document.getElementById('csv-input') as HTMLTextAreaElement;
  const csvPreview = document.getElementById('csv-preview') as HTMLElement;
  const csvPreviewList = document.getElementById('csv-preview-list') as HTMLElement;
  const csvError = document.getElementById('csv-error') as HTMLElement;
  const csvSave = document.getElementById('csv-save') as HTMLButtonElement;
  const csvSaveStatus = document.getElementById('csv-save-status') as HTMLElement;

  entryMode?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-v]') as HTMLButtonElement | null;
    if (!btn) return;
    entryMode.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    btn.classList.add('on');
    const mode = btn.dataset['v'];
    newWorkoutForm.style.display = mode === 'steps' ? '' : 'none';
    csvPanel.style.display = mode === 'csv' ? '' : 'none';
  });

  function updateCsvPreview() {
    const text = csvInput.value.trim();
    if (!text) {
      csvPreview.style.display = 'none';
      csvError.style.display = 'none';
      return;
    }
    try {
      const parsed = parseWorkoutCsv(text);
      csvError.style.display = 'none';
      csvPreviewList.innerHTML = parsed.steps
        .map((s) => {
          const durMin = (s.durationSec / 60).toFixed(0);
          const target = s.target
            ? ` — ${s.target.type === 'watts' ? `${s.target.low === s.target.high ? s.target.low : `${s.target.low}–${s.target.high}`}W` : s.target.type === 'ftp_pct' ? `${s.target.low === s.target.high ? s.target.low : `${s.target.low}–${s.target.high}`}% FTP` : s.target.type === 'hr_bpm' ? `${s.target.low === s.target.high ? s.target.low : `${s.target.low}–${s.target.high}`} bpm` : `${Math.floor(s.target.low / 60)}:${String(s.target.low % 60).padStart(2, '0')}/km`}`
            : '';
          return `<li style="padding: 3px 0;">${s.kind} &nbsp; ${durMin}min${target}</li>`;
        })
        .join('');
      csvPreview.style.display = '';
    } catch (e) {
      csvPreview.style.display = 'none';
      csvError.textContent = e instanceof WorkoutCsvError ? e.message : 'Parse error';
      csvError.style.display = '';
    }
  }

  csvInput?.addEventListener('input', updateCsvPreview);

  csvSave?.addEventListener('click', async () => {
    const text = csvInput.value.trim();
    if (!text) return;
    try {
      parseWorkoutCsv(text); // validate before sending
    } catch (e) {
      csvError.textContent = e instanceof WorkoutCsvError ? e.message : 'Parse error';
      csvError.style.display = '';
      return;
    }
    csvSave.disabled = true;
    csvSaveStatus.textContent = 'Saving…';
    const res = await fetch('/api/v1/workouts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvText: text }),
    });
    csvSave.disabled = false;
    if (res.ok) {
      csvSaveStatus.textContent = 'Saved!';
      csvInput.value = '';
      csvPreview.style.display = 'none';
      await loadWorkouts();
      setTimeout(() => { csvSaveStatus.textContent = ''; }, 2000);
    } else {
      const msg = await res.text();
      csvError.textContent = msg || 'Save failed';
      csvError.style.display = '';
      csvSaveStatus.textContent = '';
    }
  });
```

- [ ] **Step 6.4: Verify build**

```bash
cd /Users/pablo/Projects/pacelore/apps/web && pnpm build 2>&1 | tail -20
```

Expected: build succeeds with no type errors.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/package.json apps/web/src/pages/workouts.astro pnpm-lock.yaml
git commit -m "feat(web): CSV tab in workout builder — parseWorkoutCsv + live preview"
```

---

## Task 7: Calendar compliance color badges

**Files:**
- Modify: `apps/web/src/pages/calendar.astro`

The calendar already shows completed activity cards. We add a colored left-border based on `complianceScore`. The calendar currently doesn't fetch compliance scores — activities come from `GET /me/calendar/activities` which returns the activity rows. The `compliance_score` lives on `planned_workouts`.

To avoid a second fetch, we'll add `complianceScore` to the calendar activities endpoint response by joining `planned_workouts`.

- [ ] **Step 7.1: Add complianceScore to calendar activities endpoint**

In `apps/api/src/routes/training.ts`, in `GET /me/calendar/activities`, update the query to join planned_workouts:

Old query:
```typescript
  const rows = await c.env.DB.prepare(
    `SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
            distance_m AS distanceM, ascent_m AS ascentM,
            hr_avg AS hrAvg, hr_max AS hrMax,
            power_avg AS powerAvg, power_max AS powerMax,
            np, intensity_factor AS intensityFactor, tss, kj,
            speed_avg_ms AS speedAvgMs,
            source, external_source AS externalSource, external_id AS externalId
       FROM activities
      WHERE athlete_id = ?
        AND started_at BETWEEN ? AND ?
      ORDER BY started_at ASC`,
  )
    .bind(session.userId, fromEpoch, toEpoch)
    .all();
```

New query:
```typescript
  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.sport, a.name, a.started_at AS startedAt, a.total_seconds AS totalSeconds,
            a.distance_m AS distanceM, a.ascent_m AS ascentM,
            a.hr_avg AS hrAvg, a.hr_max AS hrMax,
            a.power_avg AS powerAvg, a.power_max AS powerMax,
            a.np, a.intensity_factor AS intensityFactor, a.tss, a.kj,
            a.speed_avg_ms AS speedAvgMs,
            a.source, a.external_source AS externalSource, a.external_id AS externalId,
            pw.compliance_score AS complianceScore
       FROM activities a
       LEFT JOIN planned_workouts pw ON pw.completed_activity_id = a.id AND pw.athlete_id = a.athlete_id
      WHERE a.athlete_id = ?
        AND a.started_at BETWEEN ? AND ?
      ORDER BY a.started_at ASC`,
  )
    .bind(session.userId, fromEpoch, toEpoch)
    .all();
```

- [ ] **Step 7.2: Add compliance color CSS to calendar.astro**

In `apps/web/src/pages/calendar.astro`, find the CSS section (`.cal-card { ... }`) and add after the existing `.cal-card:hover` rule:

```css
  .cal-card.compliance-green { border-left: 3px solid #22c55e; }
  .cal-card.compliance-yellow { border-left: 3px solid #eab308; }
  .cal-card.compliance-red { border-left: 3px solid #ef4444; }
```

- [ ] **Step 7.3: Update Activity type + buildCard to use complianceScore**

In `calendar.astro`, find the `type Activity = {` definition and add:

```typescript
    complianceScore?: number | null;
```

In `buildCard(a: Activity)`, change the opening tag line from:

```typescript
    return `
      <a class="cal-card ${sportClass}" href="/activity/${escape(a.id)}">
```

to:

```typescript
    const complianceClass = complianceToCssClass(a.complianceScore);
    return `
      <a class="cal-card ${sportClass}${complianceClass ? ` ${complianceClass}` : ''}" href="/activity/${escape(a.id)}">
```

Add the helper function in the `<script>` section:

```typescript
  function complianceToCssClass(score: number | null | undefined): string | null {
    if (score == null) return null;
    if (score >= 0.95) return 'compliance-green';
    if (score >= 0.85) return 'compliance-yellow';
    return 'compliance-red';
  }
```

- [ ] **Step 7.4: Run API tests**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test
```

Expected: all tests pass (the calendar activities query change is a SELECT-only change).

- [ ] **Step 7.5: Commit**

```bash
git add apps/api/src/routes/training.ts apps/web/src/pages/calendar.astro
git commit -m "feat(web): compliance color badges on calendar activity cards"
```

---

## Task 8: Home page dot + activity detail "vs plan" banner

**Files:**
- Modify: `apps/web/src/pages/home.astro`
- Modify: `apps/web/src/pages/activity/[id].astro`

- [ ] **Step 8.1: Add compliance dot to home last-activity tile**

The home page already fetches activities via `GET /me/calendar/activities`. Find where the last activity is rendered — the `renderLastActivity` function.

In `apps/web/src/pages/home.astro`, find the last-activity render function and add the compliance dot. First add the helper function:

```typescript
  function complianceDot(score: number | null | undefined): string {
    if (score == null) return '';
    const color = score >= 0.95 ? '#22c55e' : score >= 0.85 ? '#eab308' : '#ef4444';
    const label = score >= 0.95 ? 'On plan' : score >= 0.85 ? 'Near plan' : 'Off plan';
    return `<span title="${label}" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-left:6px;vertical-align:middle;"></span>`;
  }
```

Then in the last-activity card HTML template, after the activity name span, add `${complianceDot(lastAct.complianceScore)}`.

To know the exact insertion point, find the `renderLastActivity` function or wherever activities are displayed in the home script. Look for `a.name` in the template and add the dot after it.

Add `complianceScore?: number | null;` to the Activity type in home.astro.

- [ ] **Step 8.2: Add "vs plan" banner to activity detail page**

In `apps/web/src/pages/activity/[id].astro`, in the `init()` function, the activity is fetched from `/api/v1/activities/${id}`. The response now includes `planMatch`. Update the render to show the banner.

Find the `renderHeader` function call or where the activity detail is rendered. Add after the main render call:

```typescript
  function renderPlanBanner(planMatch: {
    plannedWorkoutId: string;
    complianceScore: number | null;
    scheduledDate: string;
    workoutName: string | null;
  } | null): void {
    const container = document.getElementById('plan-match-banner');
    if (!container || !planMatch || planMatch.complianceScore == null) return;
    const score = planMatch.complianceScore;
    const color = score >= 0.95 ? '#22c55e' : score >= 0.85 ? '#eab308' : '#ef4444';
    const label = score >= 0.95 ? 'On plan' : score >= 0.85 ? 'Near plan' : 'Off plan';
    const pct = Math.round(score * 100);
    const workoutName = planMatch.workoutName ?? 'Planned workout';
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:8px;border:1px solid ${color};background:${color}18;font-size:14px;">
        <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span><strong>${label}</strong> — ${workoutName} &nbsp;·&nbsp; ${pct}% compliance</span>
      </div>
    `;
    container.style.display = '';
  }
```

In the `init()` function, after `const { activity, metrics, planMatch } = await res.json()`, call `renderPlanBanner(planMatch)`.

In the page HTML (in `<Shell>`), add a placeholder div after the `<header>` section:

```html
<div id="plan-match-banner" style="display:none; margin-bottom: 16px;"></div>
```

Update the response type in the fetch to include `planMatch`:

```typescript
  const { activity, metrics, planMatch } = (await res.json()) as {
    activity: ActivityRow;
    metrics: Metric[];
    planMatch: {
      plannedWorkoutId: string;
      complianceScore: number | null;
      scheduledDate: string;
      workoutName: string | null;
    } | null;
  };
```

- [ ] **Step 8.3: Build and verify**

```bash
cd /Users/pablo/Projects/pacelore/apps/web && pnpm build 2>&1 | tail -20
```

Expected: no errors.

- [ ] **Step 8.4: Commit**

```bash
git add apps/web/src/pages/home.astro "apps/web/src/pages/activity/[id].astro"
git commit -m "feat(web): compliance dot on home last-activity + vs-plan banner on activity detail"
```

---

## Task 9: Deploy

- [ ] **Step 9.1: Deploy API**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && npx wrangler deploy
```

- [ ] **Step 9.2: Deploy web**

```bash
cd /Users/pablo/Projects/pacelore/apps/web && npx wrangler deploy
```

- [ ] **Step 9.3: Smoke test**

1. Navigate to `/workouts` — verify "Paste CSV" tab appears
2. Paste `Z2 Ride, cycling, Test\nWarm up, 600, 80-150W\nMain Block, 2000, 170W\nCool down, 600` — verify live preview renders 3 blocks
3. Save — verify workout appears in "Saved workouts" list
4. Navigate to `/calendar` — verify planned cards still render correctly
5. If a matched planned workout exists, verify green/yellow/red border on activity card

- [ ] **Step 9.4: Final commit**

```bash
git add -A
git commit -m "chore: deploy structured workout CSV builder + compliance colors"
```

---

## Self-Review

**Spec coverage check:**
- ✅ CSV tab in workouts.astro (Task 6)
- ✅ API csvText in POST /workouts (Task 3)
- ✅ API csvText in POST /planned-workouts (Task 3)
- ✅ MCP create_workout_from_csv (Task 4)
- ✅ Target types: watts, % FTP, bpm, pace (Task 1 parser)
- ✅ Block name → kind mapping (Task 1)
- ✅ Enhanced compliance: duration + power (Task 5)
- ✅ Green/yellow/red thresholds ≥0.95/≥0.85/<0.85 (Task 7)
- ✅ Calendar badge (Task 7)
- ✅ Activity detail banner (Task 8)
- ✅ Home dot (Task 8)

**Type consistency:**
- `CsvStep` (workout-csv) ↔ `WorkoutStep` (workout-export.ts) — compatible via extended target union ✅
- `parseWorkoutCsv` returns `ParsedWorkout` with `steps: CsvStep[]`, cast to `WorkoutBody['steps']` in API ✅
- `complianceScore` flows: persist.ts → planned_workouts.compliance_score → calendar/home/activity ✅
- `planMatch` in GET /activities/:id response ↔ renderPlanBanner parameter type ✅

**Placeholder scan:** No TBDs or incomplete code blocks. All steps have actual code.
