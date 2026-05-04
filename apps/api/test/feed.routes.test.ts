import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

function seed(env: ReturnType<typeof fakeEnv>) {
  const db = env.DB as unknown as FakeD1;
  for (const id of ['u1', 'u2', 'u3']) {
    db.users.push({ id, handle: id, email: `${id}@x`, displayName: null });
  }
  // Self-private (visible)
  db.activities.push({
    id: 'a1',
    athlete_id: 'u1',
    source: 'gpx',
    sport: 'cycling',
    started_at: 100,
    total_seconds: 10,
    visibility: 'private',
  });
  // Friend public (visible)
  db.activities.push({
    id: 'a2',
    athlete_id: 'u2',
    source: 'gpx',
    sport: 'running',
    started_at: 200,
    total_seconds: 10,
    visibility: 'public',
  });
  // Friend followers-only (visible only if u1 follows u2)
  db.activities.push({
    id: 'a3',
    athlete_id: 'u2',
    source: 'gpx',
    sport: 'cycling',
    started_at: 300,
    total_seconds: 10,
    visibility: 'followers',
  });
  // Stranger private (hidden)
  db.activities.push({
    id: 'a4',
    athlete_id: 'u3',
    source: 'gpx',
    sport: 'running',
    started_at: 400,
    total_seconds: 10,
    visibility: 'private',
  });
}

describe('feed', () => {
  it('shows self + public activities, hides strangers private', async () => {
    const { env, cookie } = await authedEnv('u1');
    seed(env);
    const app = buildApp();
    const res = await app.request('/api/v1/feed', { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { items: { id: string }[] };
    const ids = body.items.map((i) => i.id);
    expect(ids).toContain('a1'); // self
    expect(ids).toContain('a2'); // public
    expect(ids).not.toContain('a3'); // followers-only, not following
    expect(ids).not.toContain('a4'); // stranger private
  });

  it('reveals followers-only activity once you follow', async () => {
    const { env, cookie } = await authedEnv('u1');
    seed(env);
    const app = buildApp();
    await app.request('/api/v1/follows/u2', { method: 'POST', headers: { Cookie: cookie } }, env);
    const res = await app.request('/api/v1/feed', { headers: { Cookie: cookie } }, env);
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((i) => i.id)).toContain('a3');
  });

  it('paginates by cursor', async () => {
    const { env, cookie } = await authedEnv('u1');
    seed(env);
    const app = buildApp();
    const first = await app.request('/api/v1/feed?limit=1', { headers: { Cookie: cookie } }, env);
    const f = (await first.json()) as { items: { startedAt: number }[]; nextCursor: string | null };
    expect(f.items).toHaveLength(1);
    expect(f.nextCursor).toBeTruthy();
    const second = await app.request(
      `/api/v1/feed?limit=10&cursor=${f.nextCursor}`,
      { headers: { Cookie: cookie } },
      env,
    );
    const s = (await second.json()) as { items: { startedAt: number }[] };
    expect(s.items[0]!.startedAt).toBeLessThan(f.items[0]!.startedAt);
  });

  it('rejects unauthenticated', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/feed', {}, fakeEnv());
    expect(res.status).toBe(401);
  });
});
