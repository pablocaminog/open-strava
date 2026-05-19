import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

describe('GET /api/v1/me/connections', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/me/connections', {}, fakeEnv());
    expect(res.status).toBe(401);
  });

  it('returns empty connections for new user', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { strava: boolean; garmin: boolean };
    expect(data.strava).toBe(false);
    expect(data.garmin).toBe(false);
  });

  it('returns true for connected provider', async () => {
    const { env, cookie } = await authedEnv('u1');
    await (env.DB as FakeD1).exec(
      `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
       VALUES ('strava', 'ext-1', 'u1', 'tok', 'ref', 9999999999, 'read')`,
    );
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { strava: boolean; garmin: boolean };
    expect(data.strava).toBe(true);
    expect(data.garmin).toBe(false);
  });
});

describe('DELETE /api/v1/me/connections/:provider', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections/strava',
      { method: 'DELETE' },
      fakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid provider', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections/facebook',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('deletes the oauth identity and returns ok', async () => {
    const { env, cookie } = await authedEnv('u1');
    await (env.DB as FakeD1).exec(
      `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
       VALUES ('strava', 'ext-1', 'u1', 'tok', 'ref', 9999999999, 'read')`,
    );
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections/strava',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});
