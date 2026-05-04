/**
 * Garmin Connect Developer / Wellness API integration.
 *
 *   GET  /api/v1/auth/garmin/start          — OAuth1.0a request token + 302
 *   GET  /api/v1/auth/garmin/callback       — exchange verifier → access token
 *   POST /api/v1/webhooks/garmin/activities — push notification (Garmin → us)
 *
 * Garmin still uses OAuth1.0a (HMAC-SHA1) for both Connect Developer
 * and Health API. Production access requires partner approval; the
 * route shape matches the documented contract.
 *
 * Webhook payload contains activity summaries with `callbackURL` fields
 * pointing at the FIT file. We download the FIT, store in R2, queue
 * the same ingest job manual uploads use.
 *
 * Secrets:
 *   GARMIN_CONSUMER_KEY
 *   GARMIN_CONSUMER_SECRET
 *
 * KV stash for request_token → tokenSecret mapping during the OAuth
 * dance lives in KV_SESSIONS under `garmin:reqtok:<token>`.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, IngestJob } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { parseFormBody, signOAuth1 } from '../integrations/oauth1.js';
import { uuidv7 } from '../util/uuid.js';

export const garminRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

const REQ_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://connectapi.garmin.com/oauth-service/oauth/access_token';
const AUTHORIZE_URL = 'https://connect.garmin.com/oauthConfirm';

function consumer(env: Env) {
  if (!env.GARMIN_CONSUMER_KEY || !env.GARMIN_CONSUMER_SECRET) {
    throw new HTTPException(500, { message: 'Garmin consumer credentials not set' });
  }
  return {
    consumerKey: env.GARMIN_CONSUMER_KEY,
    consumerSecret: env.GARMIN_CONSUMER_SECRET,
  };
}

garminRoutes.get('/auth/garmin/start', requireSession(), async (c) => {
  const session = c.get('session');
  const callback = `${c.env.APP_ORIGIN.replace(/\/$/, '')}/api/v1/auth/garmin/callback`;

  const signed = await signOAuth1(consumer(c.env), 'POST', REQ_TOKEN_URL, {
    oauth_callback: callback,
  });
  const res = await fetch(signed.url, { method: 'POST', headers: signed.headers });
  if (!res.ok) {
    throw new HTTPException(502, { message: `Garmin request_token failed (${res.status})` });
  }
  const body = parseFormBody(await res.text());
  const token = body.oauth_token;
  const secret = body.oauth_token_secret;
  if (!token || !secret) throw new HTTPException(502, { message: 'malformed request_token' });

  await c.env.KV_SESSIONS.put(
    `garmin:reqtok:${token}`,
    JSON.stringify({ secret, userId: session.userId }),
    {
      expirationTtl: 600,
    },
  );

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('oauth_token', token);
  return c.redirect(url.toString());
});

garminRoutes.get('/auth/garmin/callback', async (c) => {
  const url = new URL(c.req.url);
  const oauthToken = url.searchParams.get('oauth_token');
  const verifier = url.searchParams.get('oauth_verifier');
  if (!oauthToken || !verifier) {
    throw new HTTPException(400, { message: 'missing oauth_token or oauth_verifier' });
  }

  const stash = await c.env.KV_SESSIONS.get(`garmin:reqtok:${oauthToken}`, 'json' as const);
  if (!stash) throw new HTTPException(400, { message: 'unknown request token' });
  const { secret, userId } = stash as { secret: string; userId: string };

  const cons = consumer(c.env);
  const signed = await signOAuth1(
    { ...cons, token: oauthToken, tokenSecret: secret },
    'POST',
    ACCESS_TOKEN_URL,
    { oauth_verifier: verifier },
  );
  const res = await fetch(signed.url, { method: 'POST', headers: signed.headers });
  if (!res.ok) {
    throw new HTTPException(502, { message: `Garmin access_token failed (${res.status})` });
  }
  const body = parseFormBody(await res.text());
  const accessToken = body.oauth_token;
  const accessSecret = body.oauth_token_secret;
  const garminUserId = body.user_id ?? body.userId ?? oauthToken;
  if (!accessToken || !accessSecret) {
    throw new HTTPException(502, { message: 'malformed access_token response' });
  }

  await c.env.DB.prepare(
    `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
     VALUES ('garmin', ?, ?, ?, ?, 0, 'wellness:read')
     ON CONFLICT(provider, external_id) DO UPDATE
       SET user_id = excluded.user_id,
           access_token = excluded.access_token,
           refresh_token = excluded.refresh_token`,
  )
    .bind(String(garminUserId), userId, accessToken, accessSecret)
    .run();

  await c.env.KV_SESSIONS.delete(`garmin:reqtok:${oauthToken}`);
  return c.redirect('/settings');
});

interface GarminActivityPush {
  userId: string;
  userAccessToken?: string;
  summaryId: string;
  activityId?: number;
  activityFileType?: 'FIT' | 'TCX' | 'GPX';
  callbackURL: string;
  startTimeInSeconds?: number;
}

interface GarminWebhookBody {
  activityFiles?: GarminActivityPush[];
  activities?: GarminActivityPush[];
}

garminRoutes.post('/webhooks/garmin/activities', async (c) => {
  const payload = (await c.req.json()) as GarminWebhookBody;
  const items = [...(payload.activityFiles ?? []), ...(payload.activities ?? [])];
  let queued = 0;
  for (const it of items) {
    const ident = await c.env.DB.prepare(
      `SELECT user_id AS userId, access_token AS accessToken, refresh_token AS tokenSecret
         FROM oauth_identities WHERE provider = 'garmin' AND external_id = ?`,
    )
      .bind(String(it.userId))
      .first<{ userId: string; accessToken: string; tokenSecret: string }>();
    if (!ident) continue;

    const signed = await signOAuth1(
      {
        consumerKey: c.env.GARMIN_CONSUMER_KEY!,
        consumerSecret: c.env.GARMIN_CONSUMER_SECRET!,
        token: ident.accessToken,
        tokenSecret: ident.tokenSecret,
      },
      'GET',
      it.callbackURL,
    );
    const fileRes = await fetch(signed.url, { headers: signed.headers });
    if (!fileRes.ok) continue;
    const buf = await fileRes.arrayBuffer();

    const ext = (it.activityFileType ?? 'FIT').toLowerCase();
    const source: IngestJob['source'] = ext === 'tcx' ? 'tcx' : ext === 'gpx' ? 'gpx' : 'fit';
    const activityId = uuidv7();
    const ts = it.startTimeInSeconds ? new Date(it.startTimeInSeconds * 1000) : new Date();
    const yyyy = ts.getUTCFullYear();
    const mm = String(ts.getUTCMonth() + 1).padStart(2, '0');
    const rawPath = `raw/${ident.userId}/${yyyy}/${mm}/${activityId}.${source}`;
    await c.env.RAW_BUCKET.put(rawPath, buf, {
      httpMetadata: {
        contentType:
          source === 'fit'
            ? 'application/vnd.fit'
            : source === 'tcx'
              ? 'application/tcx+xml'
              : 'application/gpx+xml',
      },
      customMetadata: {
        athleteId: ident.userId,
        activityId,
        source: 'garmin-webhook',
        garminSummaryId: String(it.summaryId),
      },
    });
    const job: IngestJob = {
      activityId,
      athleteId: ident.userId,
      rawR2Path: rawPath,
      source,
    };
    await c.env.INGEST_QUEUE.send(job);
    queued++;
  }
  return c.json({ ok: true, queued });
});
