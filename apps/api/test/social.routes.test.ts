import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

function seedActivity(
  env: ReturnType<typeof fakeEnv>,
  id = 'a1',
  owner = 'u1',
  visibility = 'public',
) {
  const db = env.DB as unknown as FakeD1;
  db.users.push({ id: owner, handle: owner, email: `${owner}@x`, displayName: null });
  db.activities.push({
    id,
    athlete_id: owner,
    source: 'gpx',
    sport: 'cycling',
    started_at: 100,
    total_seconds: 60,
    visibility,
  });
}

async function postJson(
  app: ReturnType<typeof buildApp>,
  env: ReturnType<typeof fakeEnv>,
  cookie: string,
  path: string,
  body: unknown,
) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('kudos', () => {
  it('add + list + remove (idempotent)', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedActivity(env, 'a1', 'u1', 'public');
    const app = buildApp();

    const a = await app.request(
      '/api/v1/activities/a1/kudos',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(a.status).toBe(200);
    const aa = await app.request(
      '/api/v1/activities/a1/kudos',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(aa.status).toBe(200); // idempotent

    const list = await app.request(
      '/api/v1/activities/a1/kudos',
      { headers: { Cookie: cookie } },
      env,
    );
    const body = (await list.json()) as { items: { athleteId: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.athleteId).toBe('u1');

    const d = await app.request(
      '/api/v1/activities/a1/kudos',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(d.status).toBe(200);
    expect((env.DB as unknown as FakeD1).kudos).toHaveLength(0);
  });

  it('blocks kudos on a private activity owned by someone else', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedActivity(env, 'a1', 'u2', 'private');
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities/a1/kudos',
      { method: 'POST', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(403);
  });
});

describe('comments', () => {
  it('post + list + delete own', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedActivity(env, 'a1', 'u1', 'public');
    const app = buildApp();

    const post = await postJson(app, env, cookie, '/api/v1/activities/a1/comments', {
      body: 'nice ride',
    });
    expect(post.status).toBe(200);
    const { id } = (await post.json()) as { id: string };

    const list = await app.request(
      '/api/v1/activities/a1/comments',
      { headers: { Cookie: cookie } },
      env,
    );
    const items = ((await list.json()) as { items: { body: string }[] }).items;
    expect(items.map((i) => i.body)).toContain('nice ride');

    const del = await app.request(
      `/api/v1/activities/a1/comments/${id}`,
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(del.status).toBe(200);
  });

  it('rejects empty body and oversized body', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedActivity(env, 'a1', 'u1', 'public');
    const app = buildApp();
    const empty = await postJson(app, env, cookie, '/api/v1/activities/a1/comments', {
      body: '   ',
    });
    expect(empty.status).toBe(400);
    const big = await postJson(app, env, cookie, '/api/v1/activities/a1/comments', {
      body: 'x'.repeat(2001),
    });
    expect(big.status).toBe(400);
  });
});

describe('PATCH /activities/:id', () => {
  it('updates name + visibility for owner', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedActivity(env, 'a1', 'u1', 'private');
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities/a1',
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Lunch ride', visibility: 'public' }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const db = env.DB as unknown as FakeD1;
    expect(db.activities[0]!.name).toBe('Lunch ride');
    expect(db.activities[0]!.visibility).toBe('public');
  });

  it('rejects PATCH from non-owner', async () => {
    const { env, cookie } = await authedEnv('u1');
    seedActivity(env, 'a1', 'u2', 'public');
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities/a1',
      {
        method: 'PATCH',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no' }),
      },
      env,
    );
    expect(res.status).toBe(403);
  });
});
