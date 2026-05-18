# Planned Workouts Endpoint + MCP Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST/GET/DELETE /api/v1/planned-workouts` REST endpoints and `schedule_workout`, `list_planned_workouts`, `delete_planned_workout` MCP tools so Claude and external apps can create and manage ad-hoc planned workouts without a pre-existing workout library entry.

**Architecture:** New route handlers in `training.ts` write inline session data (sport, durationMin, targetZone, description) to the existing `planned_workouts.session_json` column. MCP layer gets three new tools under a new `write:training` scope, implemented directly in `mcp.ts` using the same D1 queries. No schema migration needed — `session_json` and nullable `workout_id` already exist.

**Tech Stack:** Hono (routing), Cloudflare D1 (SQLite), Vitest (tests), TypeScript

---

## File Map

| File | Change |
|---|---|
| `apps/api/src/routes/training.ts` | Add POST/GET/DELETE /planned-workouts |
| `apps/api/src/routes/mcp.ts` | Add 3 tools + `write:training` scope + uuidv7 import |
| `apps/api/test/helpers.ts` | Add SQL handlers: planned_workouts inserts/selects, api_keys CRUD |
| `apps/api/test/training.routes.test.ts` | New: REST endpoint tests |
| `apps/api/test/mcp.tools.test.ts` | New: MCP tool tests |

---

## Task 1: REST endpoints in training.ts

**Files:**
- Modify: `apps/api/src/routes/training.ts` (append after the existing calendar DELETE handler, before `// Coach links`)

- [ ] **Step 1: Add the three route handlers**

In `apps/api/src/routes/training.ts`, insert the following block between the `trainingRoutes.delete('/me/calendar/:id', ...)` handler and the `// Coach links` comment:

```typescript
// Planned workouts (ad-hoc, inline session details) ----------------

interface PlannedWorkoutBody {
  scheduledDate?: string;
  sport?: string;
  durationMin?: number;
  targetZone?: string;
  description?: string;
  notes?: string;
  athleteId?: string;
}

trainingRoutes.post('/planned-workouts', async (c) => {
  const session = c.get('session');
  const body = (await c.req.json()) as PlannedWorkoutBody;

  if (!body.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(body.scheduledDate)) {
    throw new HTTPException(400, { message: 'scheduledDate (YYYY-MM-DD) required' });
  }
  if (!body.sport || !SPORTS.has(body.sport)) {
    throw new HTTPException(400, { message: 'invalid sport' });
  }
  if (typeof body.durationMin !== 'number' || body.durationMin < 1) {
    throw new HTTPException(400, { message: 'durationMin ≥ 1 required' });
  }

  const targetAthlete = body.athleteId ?? session.userId;
  if (targetAthlete !== session.userId) {
    const ok = await isCoachOf(c.env, session.userId, targetAthlete);
    if (!ok) throw new HTTPException(403, { message: 'not your athlete' });
  }

  const id = uuidv7();
  const sessionJson = JSON.stringify({
    sport: body.sport,
    durationMin: body.durationMin,
    ...(body.targetZone != null ? { targetZone: body.targetZone } : {}),
    ...(body.description != null ? { description: body.description } : {}),
  });

  await c.env.DB.prepare(
    `INSERT INTO planned_workouts (id, athlete_id, scheduled_date, notes, session_json, assigned_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
  )
    .bind(id, targetAthlete, body.scheduledDate, body.notes ?? null, sessionJson, session.userId)
    .run();

  return c.json({ id }, 201);
});

trainingRoutes.get('/planned-workouts', async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  if (!from || !to) {
    throw new HTTPException(400, { message: 'from and to required (YYYY-MM-DD)' });
  }
  const athleteId = url.searchParams.get('athleteId') ?? session.userId;
  if (athleteId !== session.userId) {
    const ok = await isCoachOf(c.env, session.userId, athleteId);
    if (!ok) throw new HTTPException(403, { message: 'not your athlete' });
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, scheduled_date AS scheduledDate, notes,
            workout_id AS workoutId, completed_activity_id AS completedActivityId,
            compliance_score AS complianceScore, session_json AS sessionJson,
            created_at AS createdAt
       FROM planned_workouts
      WHERE athlete_id = ?
        AND scheduled_date BETWEEN ? AND ?
      ORDER BY scheduled_date ASC`,
  )
    .bind(athleteId, from, to)
    .all();

  const items = (rows.results ?? []).map((r: Record<string, unknown>) => {
    const { sessionJson, ...rest } = r;
    const parsed = typeof sessionJson === 'string' ? JSON.parse(sessionJson) : {};
    return { ...rest, ...parsed };
  });

  return c.json({ items });
});

trainingRoutes.delete('/planned-workouts/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare(
    `DELETE FROM planned_workouts WHERE id = ? AND (athlete_id = ? OR assigned_by = ?)`,
  )
    .bind(id, session.userId, session.userId)
    .run();
  return c.json({ ok: true });
});
```

- [ ] **Step 2: Typecheck**

```bash
cd apps/api && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/training.ts
git commit -m "feat(api): add POST/GET/DELETE /planned-workouts endpoints"
```

---

## Task 2: FakeD1 SQL handlers + api_keys support

**Files:**
- Modify: `apps/api/test/helpers.ts`

- [ ] **Step 1: Add planned_workouts INSERT handler**

In `FakeD1.execute()`, find the block that starts:
```typescript
if (trimmed.startsWith('UPDATE planned_workouts SET completed_activity_id')) {
```

Insert this block **before** it:

```typescript
if (trimmed.startsWith('INSERT INTO planned_workouts')) {
  const [id, athlete_id, scheduled_date, notes, session_json, assigned_by] = params;
  this.plannedWorkouts.push({
    id,
    athlete_id,
    scheduled_date,
    notes: notes ?? null,
    session_json: session_json ?? null,
    workout_id: null,
    assigned_by: assigned_by ?? null,
    completed_activity_id: null,
    compliance_score: null,
    created_at: Math.floor(Date.now() / 1000),
  });
  return [];
}
```

- [ ] **Step 2: Add planned_workouts SELECT handler (GET /planned-workouts)**

Insert this block after the INSERT handler you just added:

```typescript
if (
  trimmed.includes('session_json AS sessionJson') &&
  trimmed.includes('FROM planned_workouts') &&
  !trimmed.includes('LEFT JOIN')
) {
  const [athleteId, from, to] = params;
  return this.plannedWorkouts
    .filter(
      (pw) =>
        pw.athlete_id === athleteId &&
        String(pw.scheduled_date) >= String(from) &&
        String(pw.scheduled_date) <= String(to),
    )
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
    .map((pw) => ({
      id: pw.id,
      scheduledDate: pw.scheduled_date,
      notes: pw.notes ?? null,
      workoutId: pw.workout_id ?? null,
      completedActivityId: pw.completed_activity_id ?? null,
      complianceScore: pw.compliance_score ?? null,
      sessionJson: pw.session_json ?? null,
      createdAt: pw.created_at,
    }));
}
```

- [ ] **Step 3: Add planned_workouts DELETE handler**

Insert after the SELECT handler:

```typescript
if (trimmed.startsWith('DELETE FROM planned_workouts')) {
  const [id, userId1, userId2] = params;
  this.plannedWorkouts = this.plannedWorkouts.filter(
    (pw) =>
      !(
        pw.id === id &&
        (pw.athlete_id === userId1 || pw.assigned_by === userId2)
      ),
  );
  return [];
}
```

- [ ] **Step 4: Add MCP list planned_workouts handler (LEFT JOIN workouts)**

Insert after the DELETE handler:

```typescript
if (
  trimmed.includes('FROM planned_workouts pw') &&
  trimmed.includes('LEFT JOIN workouts w')
) {
  const [athleteId, from, to] = params;
  return this.plannedWorkouts
    .filter(
      (pw) =>
        pw.athlete_id === athleteId &&
        String(pw.scheduled_date) >= String(from) &&
        String(pw.scheduled_date) <= String(to),
    )
    .sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)))
    .map((pw) => {
      const w = this.workouts.find((x) => x.id === pw.workout_id);
      return {
        id: pw.id,
        scheduledDate: pw.scheduled_date,
        notes: pw.notes ?? null,
        workoutId: pw.workout_id ?? null,
        completedActivityId: pw.completed_activity_id ?? null,
        complianceScore: pw.compliance_score ?? null,
        sessionJson: pw.session_json ?? null,
        workoutName: w?.name ?? null,
        workoutSport: w?.sport ?? null,
        estimatedTss: w?.estimated_tss ?? null,
        estimatedDurationSec: w?.estimated_duration_sec ?? null,
      };
    });
}
```

- [ ] **Step 5: Add api_keys handlers**

Add the `apiKeys: Row[] = [];` property to `FakeD1` class (it already exists — verify it's there, skip if so).

Then insert three api_key handlers at the **end** of `execute()`, before the final `return [];`:

```typescript
if (trimmed.startsWith('SELECT id, user_id AS userId, hashed_key')) {
  const id = params[0];
  const row = this.apiKeys.find((r) => r.id === id);
  return row
    ? [
        {
          id: row.id,
          userId: row.user_id,
          hashedKey: row.hashed_key,
          scopes: row.scopes,
          revokedAt: row.revoked_at ?? null,
        },
      ]
    : [];
}
if (trimmed.startsWith('INSERT INTO api_keys')) {
  const [id, user_id, hashed_key, scopes, name] = params;
  this.apiKeys.push({ id, user_id, hashed_key, scopes, name: name ?? null, revoked_at: null });
  return [];
}
if (trimmed.startsWith('UPDATE api_keys')) {
  return [];
}
```

- [ ] **Step 6: Typecheck**

```bash
cd apps/api && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/helpers.ts
git commit -m "test(api): add FakeD1 handlers for planned_workouts and api_keys"
```

---

## Task 3: REST endpoint tests

**Files:**
- Create: `apps/api/test/training.routes.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

describe('POST /api/v1/planned-workouts', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      { method: 'POST', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } },
      fakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('rejects missing scheduledDate', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sport: 'running', durationMin: 60 }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/scheduledDate/);
  });

  it('rejects invalid sport', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate: '2026-06-01', sport: 'basketball', durationMin: 60 }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing durationMin', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledDate: '2026-06-01', sport: 'running' }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('creates a planned workout and returns id', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduledDate: '2026-06-01',
          sport: 'running',
          durationMin: 60,
          targetZone: 'z2',
          description: 'Easy aerobic run',
          notes: 'keep HR <145',
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);

    // verify persisted in FakeD1
    const db = env.DB as unknown as FakeD1;
    const pw = db.plannedWorkouts[0]!;
    expect(pw.scheduled_date).toBe('2026-06-01');
    expect(pw.athlete_id).toBe('u1');
    const parsed = JSON.parse(pw.session_json as string);
    expect(parsed.sport).toBe('running');
    expect(parsed.durationMin).toBe(60);
    expect(parsed.targetZone).toBe('z2');
    expect(parsed.description).toBe('Easy aerobic run');
  });
});

describe('GET /api/v1/planned-workouts', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts?from=2026-06-01&to=2026-06-30',
      {},
      fakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('requires from and to params', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns workouts in range with session_json fields merged', async () => {
    const { env, cookie } = await authedEnv('u1');
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-1',
      athlete_id: 'u1',
      scheduled_date: '2026-06-05',
      notes: 'easy day',
      session_json: JSON.stringify({ sport: 'cycling', durationMin: 90, targetZone: 'z2' }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });
    db.plannedWorkouts.push({
      id: 'pw-2',
      athlete_id: 'u1',
      scheduled_date: '2026-07-01', // outside range
      notes: null,
      session_json: JSON.stringify({ sport: 'running', durationMin: 45 }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_001,
    });

    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts?from=2026-06-01&to=2026-06-30',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Record<string, unknown>[] };
    expect(body.items).toHaveLength(1);
    const item = body.items[0]!;
    expect(item.id).toBe('pw-1');
    expect(item.sport).toBe('cycling');
    expect(item.durationMin).toBe(90);
    expect(item.targetZone).toBe('z2');
    expect(item.notes).toBe('easy day');
  });

  it('does not return another athlete\'s workouts', async () => {
    const { env, cookie } = await authedEnv('u1');
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-other',
      athlete_id: 'u2',
      scheduled_date: '2026-06-05',
      notes: null,
      session_json: JSON.stringify({ sport: 'running', durationMin: 30 }),
      workout_id: null,
      assigned_by: 'u2',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });

    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts?from=2026-06-01&to=2026-06-30',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(0);
  });
});

describe('DELETE /api/v1/planned-workouts/:id', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts/pw-1',
      { method: 'DELETE' },
      fakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('deletes owned planned workout', async () => {
    const { env, cookie } = await authedEnv('u1');
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-del',
      athlete_id: 'u1',
      scheduled_date: '2026-06-05',
      notes: null,
      session_json: JSON.stringify({ sport: 'running', durationMin: 45 }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });

    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts/pw-del',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    expect(db.plannedWorkouts).toHaveLength(0);
  });

  it('returns 200 for non-existent id (idempotent)', async () => {
    const { env, cookie } = await authedEnv('u1');
    const app = buildApp();
    const res = await app.request(
      '/api/v1/planned-workouts/does-not-exist',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/api && pnpm test -- --reporter=verbose training.routes
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/training.routes.test.ts
git commit -m "test(api): planned-workouts REST endpoint tests"
```

---

## Task 4: MCP tools in mcp.ts

**Files:**
- Modify: `apps/api/src/routes/mcp.ts`

- [ ] **Step 1: Add uuidv7 import**

At the top of `apps/api/src/routes/mcp.ts`, after the existing imports, add:

```typescript
import { uuidv7 } from '../util/uuid.js';
```

- [ ] **Step 2: Add write:training to scopes_supported**

Find the `authServerMeta` function and update `scopes_supported`:

```typescript
scopes_supported: ['read:activities', 'read:social', 'write:social', 'write:training'],
```

- [ ] **Step 3: Add the three tools to the TOOLS array**

At the end of the `TOOLS` array (before `] as const;`), add:

```typescript
{
  name: 'list_planned_workouts',
  description: 'List planned workouts between two dates (inclusive).',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    },
    required: ['from', 'to'],
  },
  requiredScope: 'read:activities',
},
{
  name: 'schedule_workout',
  description: 'Schedule a planned workout on a specific date.',
  inputSchema: {
    type: 'object',
    properties: {
      scheduledDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      sport: { type: 'string', enum: ['cycling', 'running', 'swimming', 'other'] },
      durationMin: { type: 'integer', minimum: 1 },
      targetZone: { type: 'string' },
      description: { type: 'string' },
      notes: { type: 'string' },
    },
    required: ['scheduledDate', 'sport', 'durationMin'],
  },
  requiredScope: 'write:training',
},
{
  name: 'delete_planned_workout',
  description: 'Remove a planned workout by id.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
    },
    required: ['id'],
  },
  requiredScope: 'write:training',
},
```

- [ ] **Step 4: Add the three switch cases in runTool**

In the `switch (name)` block inside `runTool`, add these three cases before the final `default` / closing brace. Find the last existing `case` (likely `'unfollow'` or `'get_feed'`) and append after it:

```typescript
case 'list_planned_workouts': {
  const from = typeof args.from === 'string' ? args.from : '';
  const to = typeof args.to === 'string' ? args.to : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return jsonRpcError(c, id, -32602, 'from and to must be YYYY-MM-DD');
  }
  const rows = await env.DB.prepare(
    `SELECT pw.id, pw.scheduled_date AS scheduledDate, pw.notes,
            pw.workout_id AS workoutId, pw.completed_activity_id AS completedActivityId,
            pw.compliance_score AS complianceScore, pw.session_json AS sessionJson,
            w.name AS workoutName, w.sport AS workoutSport,
            w.estimated_tss AS estimatedTss, w.estimated_duration_sec AS estimatedDurationSec
       FROM planned_workouts pw
       LEFT JOIN workouts w ON w.id = pw.workout_id
      WHERE pw.athlete_id = ?
        AND pw.scheduled_date BETWEEN ? AND ?
      ORDER BY pw.scheduled_date ASC`,
  )
    .bind(userId, from, to)
    .all();
  const items = (rows.results ?? []).map((r: Record<string, unknown>) => {
    const { sessionJson, ...rest } = r;
    const parsed = typeof sessionJson === 'string' ? JSON.parse(sessionJson) : {};
    return { ...rest, ...parsed };
  });
  return ok({ items });
}
case 'schedule_workout': {
  const scheduledDate = typeof args.scheduledDate === 'string' ? args.scheduledDate : '';
  const sport = typeof args.sport === 'string' ? args.sport : '';
  const durationMin = Number(args.durationMin ?? 0);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
    return jsonRpcError(c, id, -32602, 'scheduledDate must be YYYY-MM-DD');
  }
  if (!['cycling', 'running', 'swimming', 'other'].includes(sport)) {
    return jsonRpcError(c, id, -32602, 'invalid sport');
  }
  if (!Number.isFinite(durationMin) || durationMin < 1) {
    return jsonRpcError(c, id, -32602, 'durationMin ≥ 1 required');
  }
  const pwId = uuidv7();
  const sessionJson = JSON.stringify({
    sport,
    durationMin,
    ...(args.targetZone != null ? { targetZone: String(args.targetZone) } : {}),
    ...(args.description != null ? { description: String(args.description) } : {}),
  });
  await env.DB.prepare(
    `INSERT INTO planned_workouts (id, athlete_id, scheduled_date, notes, session_json, assigned_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
  )
    .bind(
      pwId,
      userId,
      scheduledDate,
      args.notes != null ? String(args.notes) : null,
      sessionJson,
      userId,
    )
    .run();
  return ok({ id: pwId });
}
case 'delete_planned_workout': {
  const pwId = typeof args.id === 'string' ? args.id : '';
  await env.DB.prepare(
    `DELETE FROM planned_workouts WHERE id = ? AND athlete_id = ?`,
  )
    .bind(pwId, userId)
    .run();
  return ok({ ok: true });
}
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/api && pnpm typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/mcp.ts
git commit -m "feat(mcp): add schedule_workout, list_planned_workouts, delete_planned_workout tools"
```

---

## Task 5: MCP tool tests

**Files:**
- Create: `apps/api/test/mcp.tools.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { mintApiKey } from '../src/auth/apiKey.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

const mockCtx = {
  waitUntil: (_p: Promise<unknown>) => {},
  passThroughOnException: () => {},
} as ExecutionContext;

async function mcpRequest(
  env: ReturnType<typeof fakeEnv>,
  apiKey: string,
  method: string,
  params: Record<string, unknown> = {},
) {
  const app = buildApp();
  return app.request(
    '/mcp',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env,
    mockCtx,
  );
}

async function mcpToolCall(
  env: ReturnType<typeof fakeEnv>,
  apiKey: string,
  name: string,
  args: Record<string, unknown> = {},
) {
  return mcpRequest(env, apiKey, 'tools/call', { name, arguments: args });
}

describe('MCP schedule_workout tool', () => {
  it('returns error without write:training scope', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['read:activities']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: '2026-06-01',
      sport: 'running',
      durationMin: 60,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32004);
  });

  it('creates a planned workout', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['read:activities', 'write:training']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: '2026-06-10',
      sport: 'cycling',
      durationMin: 90,
      targetZone: 'z3',
      description: 'Threshold intervals',
      notes: '3x10 min at FTP',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { content: { text: string }[] } };
    const result = JSON.parse(body.result!.content[0]!.text) as { id: string };
    expect(typeof result.id).toBe('string');

    const db = env.DB as unknown as FakeD1;
    const pw = db.plannedWorkouts[0]!;
    expect(pw.scheduled_date).toBe('2026-06-10');
    const parsed = JSON.parse(pw.session_json as string);
    expect(parsed.sport).toBe('cycling');
    expect(parsed.durationMin).toBe(90);
    expect(parsed.targetZone).toBe('z3');
  });

  it('rejects invalid scheduledDate', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: 'not-a-date',
      sport: 'running',
      durationMin: 60,
    });
    const body = (await res.json()) as { error?: { code: number; message: string } };
    expect(body.error?.code).toBe(-32602);
  });

  it('rejects invalid sport', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'schedule_workout', {
      scheduledDate: '2026-06-01',
      sport: 'weightlifting',
      durationMin: 60,
    });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32602);
  });
});

describe('MCP list_planned_workouts tool', () => {
  it('requires read:activities scope', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const res = await mcpToolCall(env, key, 'list_planned_workouts', {
      from: '2026-06-01',
      to: '2026-06-30',
    });
    const body = (await res.json()) as { error?: { code: number } };
    expect(body.error?.code).toBe(-32004);
  });

  it('returns workouts with session fields merged', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['read:activities']);
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-mcp-1',
      athlete_id: 'u1',
      scheduled_date: '2026-06-15',
      notes: 'morning run',
      session_json: JSON.stringify({ sport: 'running', durationMin: 45, targetZone: 'z1' }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });

    const res = await mcpToolCall(env, key, 'list_planned_workouts', {
      from: '2026-06-01',
      to: '2026-06-30',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { content: { text: string }[] } };
    const result = JSON.parse(body.result!.content[0]!.text) as {
      items: Record<string, unknown>[];
    };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.sport).toBe('running');
    expect(result.items[0]!.durationMin).toBe(45);
    expect(result.items[0]!.targetZone).toBe('z1');
  });
});

describe('MCP delete_planned_workout tool', () => {
  it('removes the workout and returns ok', async () => {
    const env = fakeEnv();
    const { key } = await mintApiKey(env, 'u1', ['write:training']);
    const db = env.DB as unknown as FakeD1;
    db.plannedWorkouts.push({
      id: 'pw-del-mcp',
      athlete_id: 'u1',
      scheduled_date: '2026-06-20',
      notes: null,
      session_json: JSON.stringify({ sport: 'swimming', durationMin: 30 }),
      workout_id: null,
      assigned_by: 'u1',
      completed_activity_id: null,
      compliance_score: null,
      created_at: 1_000_000,
    });

    const res = await mcpToolCall(env, key, 'delete_planned_workout', { id: 'pw-del-mcp' });
    expect(res.status).toBe(200);
    expect(db.plannedWorkouts).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/api && pnpm test -- --reporter=verbose mcp.tools
```

Expected: all tests pass.

- [ ] **Step 3: Run full test suite**

```bash
cd apps/api && pnpm test
```

Expected: all tests pass with no regressions.

- [ ] **Step 4: Commit**

```bash
git add apps/api/test/mcp.tools.test.ts
git commit -m "test(api): MCP planned-workout tool tests"
```

---

## Task 6: Deploy

- [ ] **Step 1: Deploy to production**

```bash
cd apps/api && pnpm deploy
```

Expected: wrangler reports successful deploy. New version ID printed.

- [ ] **Step 2: Smoke-test REST endpoint**

```bash
curl -s -X POST https://api.pacelore.com/api/v1/planned-workouts \
  -H 'Content-Type: application/json' \
  -H 'Cookie: <your-session-cookie>' \
  -d '{"scheduledDate":"2026-05-20","sport":"running","durationMin":45,"targetZone":"z2"}' \
  | jq .
```

Expected: `{ "id": "..." }` with status 201.

- [ ] **Step 3: Smoke-test MCP tool via curl**

```bash
curl -s -X POST https://api.pacelore.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'X-Api-Key: <your-api-key>' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | jq '.result.tools[].name'
```

Expected output includes: `"list_planned_workouts"`, `"schedule_workout"`, `"delete_planned_workout"`.

- [ ] **Step 4: Final commit**

```bash
git add -A && git status  # confirm nothing unexpected
git commit -m "chore: planned-workouts feature complete" --allow-empty
```
