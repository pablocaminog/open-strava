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
import { sendEmail } from '../integrations/email.js';
import { kudosEmail, commentEmail } from '../integrations/email-templates.js';

export const activityRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

activityRoutes.use('*', requireSession());

const MAX_BYTES = 25 * 1024 * 1024; // 25 MB — well above any real activity file
const VALID_SOURCES = new Set(['fit', 'tcx', 'gpx'] as const);

activityRoutes.get('/activities/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await c.env.DB.prepare(
    `SELECT
       id, athlete_id AS athleteId, source, sport, name, description,
       started_at AS startedAt, total_seconds AS totalSeconds,
       distance_m AS distanceM, ascent_m AS ascentM, descent_m AS descentM,
       hr_avg AS hrAvg, hr_max AS hrMax,
       power_avg AS powerAvg, power_max AS powerMax,
       np, intensity_factor AS intensityFactor, tss, kj,
       speed_avg_ms AS speedAvgMs, speed_max_ms AS speedMaxMs,
       calories, visibility,
       parsed_r2_path AS parsedR2Path
     FROM activities WHERE id = ?`,
  )
    .bind(id)
    .first<ActivityRow>();
  if (!row) throw new HTTPException(404, { message: 'activity not found' });

  if (!(await canView(c.env, row, session.userId))) {
    throw new HTTPException(403, { message: 'not allowed to view this activity' });
  }

  const metricsResult = await c.env.DB.prepare(
    'SELECT key, value FROM activity_metrics WHERE activity_id = ?',
  )
    .bind(id)
    .all<{ key: string; value: number }>();

  return c.json({
    activity: row,
    metrics: metricsResult.results ?? [],
  });
});

activityRoutes.get('/activities/:id/stream', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await c.env.DB.prepare(
    'SELECT id, athlete_id AS athleteId, visibility, parsed_r2_path AS parsedR2Path FROM activities WHERE id = ?',
  )
    .bind(id)
    .first<{ id: string; athleteId: string; visibility: string; parsedR2Path: string | null }>();
  if (!row) throw new HTTPException(404, { message: 'activity not found' });
  if (!(await canView(c.env, row, session.userId))) {
    throw new HTTPException(403, { message: 'not allowed' });
  }
  if (!row.parsedR2Path) {
    throw new HTTPException(404, { message: 'parsed stream not yet available' });
  }
  const obj = await c.env.PARSED_BUCKET.get(row.parsedR2Path);
  if (!obj) throw new HTTPException(404, { message: 'parsed object missing' });
  return new Response(obj.body as ReadableStream, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=300',
    },
  });
});

activityRoutes.patch('/activities/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await c.env.DB.prepare('SELECT athlete_id AS athleteId FROM activities WHERE id = ?')
    .bind(id)
    .first<{ athleteId: string }>();
  if (!row) throw new HTTPException(404, { message: 'activity not found' });
  if (row.athleteId !== session.userId) throw new HTTPException(403, { message: 'not owner' });

  const body = await readJsonBody<{ name?: string; description?: string; visibility?: string }>(
    c.req.raw,
  );
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === 'string') {
    if (body.name.length > 200) throw new HTTPException(400, { message: 'name too long' });
    sets.push('name = ?');
    vals.push(body.name);
  }
  if (typeof body.description === 'string') {
    if (body.description.length > 4000)
      throw new HTTPException(400, { message: 'description too long' });
    sets.push('description = ?');
    vals.push(body.description);
  }
  if (typeof body.visibility === 'string') {
    if (!['private', 'followers', 'public'].includes(body.visibility)) {
      throw new HTTPException(400, { message: 'invalid visibility' });
    }
    sets.push('visibility = ?');
    vals.push(body.visibility);
  }
  if (sets.length === 0) return c.json({ ok: true, changed: false });
  await c.env.DB.prepare(`UPDATE activities SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals, id)
    .run();
  return c.json({ ok: true, changed: true });
});

activityRoutes.post('/activities/:id/kudos', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await activityVisibilityRow(c.env, id);
  if (!row) throw new HTTPException(404, { message: 'activity not found' });
  if (!(await canView(c.env, row, session.userId))) {
    throw new HTTPException(403, { message: 'not allowed' });
  }
  const result = await c.env.DB.prepare(
    'INSERT INTO kudos (activity_id, athlete_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
  )
    .bind(id, session.userId)
    .run();

  // Notify the activity owner once per (activity, kudoer) pair —
  // ON CONFLICT swallows repeats, so meta.changes flips to 0 there.
  if (
    result.meta?.changes &&
    result.meta.changes > 0 &&
    row.athleteId !== session.userId
  ) {
    await notifyKudos(c.env, row.athleteId, session.userId, id).catch(() => {});
  }
  return c.json({ ok: true });
});

activityRoutes.delete('/activities/:id/kudos', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare('DELETE FROM kudos WHERE activity_id = ? AND athlete_id = ?')
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

activityRoutes.get('/activities/:id/kudos', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await activityVisibilityRow(c.env, id);
  if (!row) throw new HTTPException(404, { message: 'activity not found' });
  if (!(await canView(c.env, row, session.userId))) {
    throw new HTTPException(403, { message: 'not allowed' });
  }
  const result = await c.env.DB.prepare(
    `SELECT k.athlete_id AS athleteId, u.handle, u.display_name AS displayName
       FROM kudos k JOIN users u ON u.id = k.athlete_id
      WHERE k.activity_id = ?
      ORDER BY k.created_at DESC`,
  )
    .bind(id)
    .all();
  return c.json({ items: result.results ?? [] });
});

activityRoutes.post('/activities/:id/comments', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await activityVisibilityRow(c.env, id);
  if (!row) throw new HTTPException(404, { message: 'activity not found' });
  if (!(await canView(c.env, row, session.userId))) {
    throw new HTTPException(403, { message: 'not allowed' });
  }
  const body = await readJsonBody<{ body?: string; parentId?: string }>(c.req.raw);
  const text = (body.body ?? '').trim();
  if (text.length === 0) throw new HTTPException(400, { message: 'body required' });
  if (text.length > 2000) throw new HTTPException(400, { message: 'body too long (max 2000)' });

  const commentId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO comments (id, activity_id, athlete_id, body, parent_id) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(commentId, id, session.userId, text, body.parentId ?? null)
    .run();

  if (row.athleteId !== session.userId) {
    await notifyComment(c.env, row.athleteId, session.userId, id, text).catch(() => {});
  }
  return c.json({ id: commentId, body: text });
});

activityRoutes.get('/activities/:id/comments', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await activityVisibilityRow(c.env, id);
  if (!row) throw new HTTPException(404, { message: 'activity not found' });
  if (!(await canView(c.env, row, session.userId))) {
    throw new HTTPException(403, { message: 'not allowed' });
  }
  const result = await c.env.DB.prepare(
    `SELECT c.id, c.athlete_id AS athleteId, u.handle, u.display_name AS displayName,
            c.body, c.parent_id AS parentId, c.created_at AS createdAt
       FROM comments c JOIN users u ON u.id = c.athlete_id
      WHERE c.activity_id = ?
      ORDER BY c.created_at ASC`,
  )
    .bind(id)
    .all();
  return c.json({ items: result.results ?? [] });
});

activityRoutes.delete('/activities/:id/comments/:commentId', async (c) => {
  const session = c.get('session');
  const cid = c.req.param('commentId');
  const owned = await c.env.DB.prepare('SELECT athlete_id AS athleteId FROM comments WHERE id = ?')
    .bind(cid)
    .first<{ athleteId: string }>();
  if (!owned) throw new HTTPException(404, { message: 'comment not found' });
  if (owned.athleteId !== session.userId)
    throw new HTTPException(403, { message: 'not your comment' });
  await c.env.DB.prepare('DELETE FROM comments WHERE id = ?').bind(cid).run();
  return c.json({ ok: true });
});

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

interface ActivityRow {
  id: string;
  athleteId: string;
  visibility: string;
  [k: string]: unknown;
}

async function canView(
  env: Env,
  row: { athleteId: string; visibility: string },
  viewerId: string,
): Promise<boolean> {
  if (row.athleteId === viewerId) return true;
  if (row.visibility === 'public') return true;
  if (row.visibility === 'followers') {
    const edge = await env.DB.prepare(
      'SELECT 1 AS x FROM follows WHERE follower_id = ? AND followee_id = ?',
    )
      .bind(viewerId, row.athleteId)
      .first<{ x: number }>();
    return !!edge;
  }
  return false;
}

async function readJsonBody<T>(req: Request): Promise<T> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    throw new HTTPException(415, { message: 'expected application/json' });
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new HTTPException(400, { message: 'invalid JSON body' });
  }
}

async function activityVisibilityRow(
  env: Env,
  id: string,
): Promise<{ athleteId: string; visibility: string } | null> {
  const row = await env.DB.prepare(
    'SELECT athlete_id AS athleteId, visibility FROM activities WHERE id = ?',
  )
    .bind(id)
    .first<{ athleteId: string; visibility: string }>();
  return row ?? null;
}

async function readBody(req: Request): Promise<ArrayBuffer> {
  const cl = Number(req.headers.get('content-length') ?? '0');
  if (cl > MAX_BYTES) {
    throw new HTTPException(413, { message: `body exceeds ${MAX_BYTES} bytes` });
  }
  return (await req.arrayBuffer()) as ArrayBuffer;
}

interface NotifyContext {
  ownerEmail: string;
  ownerHandle: string;
  ownerDisplayName: string | null;
  actorHandle: string;
  actorDisplayName: string | null;
  activityName: string | null;
}

async function loadNotifyContext(
  env: Env,
  ownerId: string,
  actorId: string,
  activityId: string,
): Promise<NotifyContext | null> {
  const owner = await env.DB.prepare(
    `SELECT email, handle, display_name AS displayName FROM users WHERE id = ?`,
  )
    .bind(ownerId)
    .first<{ email: string; handle: string; displayName: string | null }>();
  if (!owner) return null;
  const actor = await env.DB.prepare(
    `SELECT handle, display_name AS displayName FROM users WHERE id = ?`,
  )
    .bind(actorId)
    .first<{ handle: string; displayName: string | null }>();
  if (!actor) return null;
  const activity = await env.DB.prepare(`SELECT name FROM activities WHERE id = ?`)
    .bind(activityId)
    .first<{ name: string | null }>();
  return {
    ownerEmail: owner.email,
    ownerHandle: owner.handle,
    ownerDisplayName: owner.displayName,
    actorHandle: actor.handle,
    actorDisplayName: actor.displayName,
    activityName: activity?.name ?? null,
  };
}

async function notifyKudos(
  env: Env,
  ownerId: string,
  actorId: string,
  activityId: string,
): Promise<void> {
  const ctx = await loadNotifyContext(env, ownerId, actorId, activityId);
  if (!ctx) return;
  const tpl = kudosEmail({
    appOrigin: env.APP_ORIGIN,
    athlete: { handle: ctx.ownerHandle, displayName: ctx.ownerDisplayName },
    kudosFromHandle: ctx.actorHandle,
    kudosFromName: ctx.actorDisplayName ?? ctx.actorHandle,
    activityId,
    activityName: ctx.activityName ?? 'an activity',
  });
  await sendEmail(env, {
    to: ctx.ownerEmail,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
    idempotencyKey: `kudos:${activityId}:${actorId}`,
  });
}

async function notifyComment(
  env: Env,
  ownerId: string,
  actorId: string,
  activityId: string,
  text: string,
): Promise<void> {
  const ctx = await loadNotifyContext(env, ownerId, actorId, activityId);
  if (!ctx) return;
  const tpl = commentEmail({
    appOrigin: env.APP_ORIGIN,
    athlete: { handle: ctx.ownerHandle, displayName: ctx.ownerDisplayName },
    commenterName: ctx.actorDisplayName ?? ctx.actorHandle,
    activityId,
    activityName: ctx.activityName ?? 'an activity',
    body: text,
  });
  await sendEmail(env, {
    to: ctx.ownerEmail,
    subject: tpl.subject,
    html: tpl.html,
    text: tpl.text,
  });
}

// ------------------------- Archive uploads --------------------------
//
// POST /api/v1/me/import/archive  — receives multipart/form-data upload
//   (or a raw application/zip body) and streams it to R2. Enqueues an
//   archive-process job for the queue consumer to unpack asynchronously
//   and fan out to per-activity ingest. Returns the archive id so the
//   client can poll for progress.
//
// Hard cap: 1 GB per archive. Bigger than that warrants chunking.

const MAX_ARCHIVE_BYTES = 1_000_000_000;

activityRoutes.post('/me/import/archive', async (c) => {
  const session = c.get('session');
  const ct = c.req.header('content-type') ?? '';
  let bytes: ArrayBuffer;
  let filename = `archive-${Date.now()}.zip`;

  if (ct.startsWith('multipart/form-data')) {
    const form = await c.req.raw.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: 'file form field required' });
    }
    bytes = (await file.arrayBuffer()) as ArrayBuffer;
    filename = file.name || filename;
  } else {
    bytes = (await c.req.raw.arrayBuffer()) as ArrayBuffer;
    const cd = c.req.header('content-disposition');
    const m = cd ? /filename="?([^"]+)"?/.exec(cd) : null;
    if (m && m[1]) filename = m[1];
  }
  if (bytes.byteLength === 0) {
    throw new HTTPException(400, { message: 'empty body' });
  }
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new HTTPException(413, {
      message: `archive exceeds ${MAX_ARCHIVE_BYTES} bytes`,
    });
  }

  const archiveId = uuidv7();
  const r2Path = `archives/${session.userId}/${archiveId}.zip`;
  await c.env.RAW_BUCKET.put(r2Path, bytes, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: {
      athleteId: session.userId,
      archiveId,
      originalFilename: filename,
    },
  });
  await c.env.DB.prepare(
    `INSERT INTO archive_imports (id, athlete_id, filename, size_bytes, r2_path, status)
     VALUES (?, ?, ?, ?, ?, 'queued')`,
  )
    .bind(archiveId, session.userId, filename, bytes.byteLength, r2Path)
    .run();
  await c.env.INGEST_QUEUE.send({
    kind: 'archive',
    archiveId,
    athleteId: session.userId,
    r2Path,
    filename,
  });
  return c.json(
    { id: archiveId, filename, sizeBytes: bytes.byteLength, status: 'queued' },
    202,
  );
});

activityRoutes.get('/me/notifications', async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const unread = url.searchParams.get('unread') === '1';
  const where = unread
    ? 'athlete_id = ? AND read_at IS NULL'
    : 'athlete_id = ?';
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, payload, read_at AS readAt,
            datetime(created_at, 'unixepoch') AS createdAt
       FROM notifications WHERE ${where}
      ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: rows.results ?? [] });
});

activityRoutes.post('/me/notifications/:id/read', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare(
    `UPDATE notifications SET read_at = unixepoch() WHERE id = ? AND athlete_id = ?`,
  )
    .bind(c.req.param('id'), session.userId)
    .run();
  return c.json({ ok: true });
});

activityRoutes.post('/me/notifications/read-all', async (c) => {
  const session = c.get('session');
  await c.env.DB.prepare(
    `UPDATE notifications SET read_at = unixepoch() WHERE athlete_id = ? AND read_at IS NULL`,
  )
    .bind(session.userId)
    .run();
  return c.json({ ok: true });
});

activityRoutes.get('/me/import/archives', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, size_bytes AS sizeBytes, status,
            total_files AS totalFiles, succeeded, duplicates, failed,
            last_error AS lastError,
            datetime(created_at, 'unixepoch') AS createdAt,
            datetime(updated_at, 'unixepoch') AS updatedAt,
            datetime(completed_at, 'unixepoch') AS completedAt
       FROM archive_imports
      WHERE athlete_id = ?
      ORDER BY created_at DESC
      LIMIT 50`,
  )
    .bind(session.userId)
    .all();
  return c.json({ items: rows.results ?? [] });
});
