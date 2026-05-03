/**
 * Activity ingest endpoint.
 *
 *   POST /api/v1/activities
 *     Content-Type: application/octet-stream | application/vnd.fit
 *                   | application/gpx+xml | application/tcx+xml
 *     X-Activity-Source: fit | tcx | gpx     (or inferred from MIME)
 *     body: raw FIT bytes / TCX text / GPX text
 *
 *   Returns 202 { activityId } with the queued ingest job. The activity
 *   row is written by the parse stage of the pipeline (T19).
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env, IngestJob } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const activityRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

activityRoutes.use('*', requireSession());

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — well above any real activity file
const VALID_SOURCES = new Set(['fit', 'tcx', 'gpx'] as const);

activityRoutes.post('/activities', async (c) => {
  const session = c.get('session');
  const source = inferSource(c.req.raw);
  if (!source) {
    throw new HTTPException(415, {
      message: 'unsupported activity source — set X-Activity-Source: fit|tcx|gpx',
    });
  }

  const buf = await readBody(c.req.raw);
  if (buf.byteLength === 0) throw new HTTPException(400, { message: 'empty body' });
  if (buf.byteLength > MAX_BYTES) {
    throw new HTTPException(413, { message: `body exceeds ${MAX_BYTES} bytes` });
  }

  const activityId = uuidv7();
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const rawPath = `raw/${session.userId}/${yyyy}/${mm}/${activityId}.${source}`;

  await c.env.RAW_BUCKET.put(rawPath, buf, {
    httpMetadata: { contentType: contentTypeFor(source) },
    customMetadata: {
      athleteId: session.userId,
      activityId,
      source,
    },
  });

  const job: IngestJob = {
    activityId,
    athleteId: session.userId,
    rawR2Path: rawPath,
    source,
  };
  await c.env.INGEST_QUEUE.send(job);

  return c.json({ activityId, source, rawR2Path: rawPath }, 202);
});

function inferSource(req: Request): IngestJob['source'] | null {
  const explicit = req.headers.get('x-activity-source')?.toLowerCase();
  if (explicit && VALID_SOURCES.has(explicit as never)) return explicit as IngestJob['source'];
  const ct = req.headers.get('content-type')?.toLowerCase() ?? '';
  if (ct.includes('fit')) return 'fit';
  if (ct.includes('tcx')) return 'tcx';
  if (ct.includes('gpx')) return 'gpx';
  return null;
}

function contentTypeFor(source: IngestJob['source']): string {
  switch (source) {
    case 'fit':
      return 'application/vnd.fit';
    case 'tcx':
      return 'application/tcx+xml';
    case 'gpx':
      return 'application/gpx+xml';
  }
}

async function readBody(req: Request): Promise<ArrayBuffer> {
  const cl = Number(req.headers.get('content-length') ?? '0');
  if (cl > MAX_BYTES) {
    throw new HTTPException(413, { message: `body exceeds ${MAX_BYTES} bytes` });
  }
  return (await req.arrayBuffer()) as ArrayBuffer;
}
