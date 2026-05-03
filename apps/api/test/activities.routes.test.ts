import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession, SESSION_COOKIE } from '../src/auth/session.js';
import { fakeEnv, type FakeQueue, type FakeR2 } from './helpers.js';
import type { IngestJob } from '../src/env.js';

async function authedEnv() {
  const env = fakeEnv();
  const { cookie } = await createSession(env, 'user-1');
  const setVal = cookie.split(';')[0]!;
  return { env, cookie: setVal };
}

describe('POST /api/v1/activities', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities',
      {
        method: 'POST',
        headers: { 'X-Activity-Source': 'gpx' },
        body: '<gpx></gpx>',
      },
      fakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('rejects unknown source with 415', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/octet-stream' },
        body: 'whatever',
      },
      env,
    );
    expect(res.status).toBe(415);
  });

  it('rejects empty body with 400', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Activity-Source': 'gpx' },
        body: '',
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('writes raw bytes to R2 and enqueues an ingest job', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const fitBytes = new Uint8Array([0x0e, 0x20, 0x5c, 0x08]);

    const res = await app.request(
      '/api/v1/activities',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'X-Activity-Source': 'fit' },
        body: fitBytes,
      },
      env,
    );

    expect(res.status).toBe(202);
    const body = (await res.json()) as { activityId: string; rawR2Path: string; source: string };
    expect(body.source).toBe('fit');
    expect(body.activityId).toBeTruthy();
    expect(body.rawR2Path).toMatch(/^raw\/user-1\/\d{4}\/\d{2}\/.+\.fit$/);

    const r2 = env.RAW_BUCKET as unknown as FakeR2;
    expect(r2.store.has(body.rawR2Path)).toBe(true);
    const stored = r2.store.get(body.rawR2Path)!;
    expect(stored.customMetadata.activityId).toBe(body.activityId);

    const queue = env.INGEST_QUEUE as unknown as FakeQueue<IngestJob>;
    expect(queue.sent).toHaveLength(1);
    expect(queue.sent[0]).toMatchObject({
      activityId: body.activityId,
      athleteId: 'user-1',
      source: 'fit',
    });
  });

  it('infers source from MIME type when X-Activity-Source missing', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities',
      {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/gpx+xml' },
        body: '<gpx>x</gpx>',
      },
      env,
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('gpx');
  });

  it('rejects bodies bigger than 25 MB by Content-Length header', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/activities',
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'X-Activity-Source': 'fit',
          'Content-Length': String(30 * 1024 * 1024),
        },
        body: 'x',
      },
      env,
    );
    expect(res.status).toBe(413);
  });
});

void SESSION_COOKIE;
