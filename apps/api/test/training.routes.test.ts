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
    const text = await res.text();
    expect(text).toMatch(/scheduledDate/);
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
