import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv } from './helpers.js';

async function authedEnv() {
  const env = fakeEnv();
  const { cookie } = await createSession(env, 'u1');
  return { env, cookie: cookie.split(';')[0]! };
}

describe('segments CRUD', () => {
  it('creates and reads back a segment', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/segments',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Hill',
          sport: 'cycling',
          polyline: [
            [40.0, -74.0],
            [40.001, -74.0],
            [40.002, -74.0],
          ],
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; distanceM: number };
    expect(created.distanceM).toBeGreaterThan(0);

    const get = await app.request(
      `/api/v1/segments/${created.id}`,
      { headers: { Cookie: cookie } },
      env,
    );
    const body = (await get.json()) as { name: string; polyline: number[][] };
    expect(body.name).toBe('Test Hill');
    expect(body.polyline).toHaveLength(3);
  });

  it('rejects polyline with <2 points', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/segments',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', sport: 'cycling', polyline: [[40, -74]] }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('lists segments by bbox', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    await app.request(
      '/api/v1/segments',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'A',
          sport: 'cycling',
          polyline: [
            [40, -74],
            [40.01, -74],
          ],
        }),
      },
      env,
    );
    const list = await app.request(
      '/api/v1/segments?bbox=39.9,-74.1,40.1,-73.9',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(list.status).toBe(200);
    const body = (await list.json()) as { items: { id: string }[] };
    expect(body.items).toHaveLength(1);
  });
});
