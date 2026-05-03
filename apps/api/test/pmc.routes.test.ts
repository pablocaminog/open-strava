import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

function seedTss(
  env: ReturnType<typeof fakeEnv>,
  athleteId: string,
  rows: { date: string; tss: number }[],
) {
  const db = env.DB as unknown as FakeD1;
  for (const r of rows) {
    db.pmcDaily.set(`${athleteId}:${r.date}`, { athlete_id: athleteId, date: r.date, tss: r.tss });
  }
}

describe('GET /api/v1/athletes/:id/pmc', () => {
  it('rejects unauthenticated requests', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/athletes/u1/pmc?to=2026-05-10', {}, fakeEnv());
    expect(res.status).toBe(401);
  });

  it('rejects access to another athletes PMC', async () => {
    const { env, cookie } = await authedEnv('u1');
    const app = buildApp();
    const res = await app.request(
      '/api/v1/athletes/u2/pmc?to=2026-05-10',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns CTL/ATL/TSB series derived from pmc_daily TSS', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedTss(env, 'u1', [
      { date: '2026-05-01', tss: 100 },
      { date: '2026-05-02', tss: 80 },
    ]);
    const app = buildApp();
    const res = await app.request(
      '/api/v1/athletes/u1/pmc?from=2026-05-01&to=2026-05-05',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      days: { date: string; tss: number; ctl: number; atl: number; tsb: number }[];
    };
    expect(body.days.length).toBeGreaterThanOrEqual(5);
    const day1 = body.days[0]!;
    expect(day1.tss).toBe(100);
    expect(day1.ctl).toBeGreaterThan(0);
    expect(day1.atl).toBeGreaterThan(day1.ctl); // ATL ramps faster
  });

  it('rejects malformed date params', async () => {
    const { env, cookie } = await authedEnv('u1');
    const app = buildApp();
    const res = await app.request(
      '/api/v1/athletes/u1/pmc?to=not-a-date',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(400);
  });
});
