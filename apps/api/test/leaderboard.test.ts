import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv() {
  const env = fakeEnv();
  const { cookie } = await createSession(env, 'u1');
  return { env, cookie: cookie.split(';')[0]! };
}

describe('segment leaderboard', () => {
  it('returns efforts sorted by time, KV-cached', async () => {
    const { env, cookie } = await authedEnv();
    const db = env.DB as unknown as FakeD1;
    db.users.push({ id: 'u1', handle: 'alice', email: 'a@x', displayName: null });
    db.users.push({ id: 'u2', handle: 'bob', email: 'b@x', displayName: null });
    db.segments.push({
      id: 's1',
      name: 'X',
      sport: 'cycling',
      polyline: '[]',
      distance_m: 100,
      bbox_min_lat: 0,
      bbox_min_lng: 0,
      bbox_max_lat: 0,
      bbox_max_lng: 0,
      created_by: 'u1',
      created_at: 0,
    });
    const now = Math.floor(Date.now() / 1000);
    db.segmentEfforts.push({
      id: 'e1',
      segment_id: 's1',
      athlete_id: 'u1',
      activity_id: 'a1',
      time_seconds: 120,
      started_at: now,
    });
    db.segmentEfforts.push({
      id: 'e2',
      segment_id: 's1',
      athlete_id: 'u2',
      activity_id: 'a2',
      time_seconds: 90,
      started_at: now,
    });

    const app = buildApp();
    const res = await app.request(
      '/api/v1/segments/s1/leaderboard?window=all',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { athleteId: string; timeSeconds: number }[] };
    expect(body.items[0]!.athleteId).toBe('u2'); // KOM = fastest
    expect(body.items[0]!.timeSeconds).toBe(90);
  });

  it('404 for unknown segment', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/segments/missing/leaderboard',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(404);
  });
});
