/**
 * Roadmap routes — public-by-design kanban.
 *
 *   GET    /api/v1/roadmap                — every item, grouped by status
 *   POST   /api/v1/roadmap                { title, description? }
 *   POST   /api/v1/roadmap/:id/vote
 *   DELETE /api/v1/roadmap/:id/vote
 *   GET    /api/v1/roadmap/:id/votes      — who upvoted, when (audit)
 *   PATCH  /api/v1/roadmap/:id            { status?, sortOrder? }   (owner-only)
 *
 * Vote counts + my-vote flag are computed inline. We keep both raw
 * vote count and a fixed sort_order so seeded items can pin to the top
 * regardless of community votes.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const roadmapRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
roadmapRoutes.use('*', requireSession());

interface ItemRow {
  id: string;
  title: string;
  description: string | null;
  status: 'backlog' | 'planned' | 'in_progress' | 'released';
  releasedAt: number | null;
  createdBy: string | null;
  creatorHandle: string | null;
  creatorName: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  votes: number;
  voted: number;
}

roadmapRoutes.get('/roadmap', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT r.id, r.title, r.description, r.status,
            r.released_at AS releasedAt,
            r.created_by AS createdBy,
            u.handle AS creatorHandle, u.display_name AS creatorName,
            r.sort_order AS sortOrder,
            r.created_at AS createdAt, r.updated_at AS updatedAt,
            (SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = r.id) AS votes,
            (SELECT COUNT(*) FROM roadmap_votes v WHERE v.item_id = r.id AND v.athlete_id = ?) AS voted
       FROM roadmap_items r
       LEFT JOIN users u ON u.id = r.created_by
      ORDER BY r.sort_order DESC, r.created_at DESC`,
  )
    .bind(session.userId)
    .all<ItemRow>();
  return c.json({ items: rows.results ?? [] });
});

roadmapRoutes.post('/roadmap', async (c) => {
  const session = c.get('session');
  const body = (await c.req.raw.json().catch(() => null)) as
    | { title?: string; description?: string }
    | null;
  const title = body?.title?.trim();
  if (!title) throw new HTTPException(400, { message: 'title required' });
  if (title.length > 140) throw new HTTPException(400, { message: 'title too long (max 140)' });
  const description = body?.description?.trim();
  if (description && description.length > 2000) {
    throw new HTTPException(400, { message: 'description too long (max 2000)' });
  }
  const id = uuidv7();
  await c.env.DB.prepare(
    `INSERT INTO roadmap_items (id, title, description, status, created_by)
     VALUES (?, ?, ?, 'backlog', ?)`,
  )
    .bind(id, title, description ?? null, session.userId)
    .run();
  // Auto-vote for your own submission.
  await c.env.DB.prepare(
    `INSERT INTO roadmap_votes (item_id, athlete_id) VALUES (?, ?)
     ON CONFLICT (item_id, athlete_id) DO NOTHING`,
  )
    .bind(id, session.userId)
    .run();
  return c.json({ id }, 201);
});

roadmapRoutes.post('/roadmap/:id/vote', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const exists = await c.env.DB.prepare('SELECT id FROM roadmap_items WHERE id = ?')
    .bind(id)
    .first();
  if (!exists) throw new HTTPException(404, { message: 'roadmap item not found' });
  await c.env.DB.prepare(
    `INSERT INTO roadmap_votes (item_id, athlete_id) VALUES (?, ?)
     ON CONFLICT (item_id, athlete_id) DO NOTHING`,
  )
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

roadmapRoutes.delete('/roadmap/:id/vote', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare('DELETE FROM roadmap_votes WHERE item_id = ? AND athlete_id = ?')
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

roadmapRoutes.get('/roadmap/:id/votes', async (c) => {
  const id = c.req.param('id');
  const rows = await c.env.DB.prepare(
    `SELECT v.athlete_id AS athleteId,
            u.handle, u.display_name AS displayName,
            v.voted_at AS votedAt
       FROM roadmap_votes v
       JOIN users u ON u.id = v.athlete_id
      WHERE v.item_id = ?
      ORDER BY v.voted_at ASC`,
  )
    .bind(id)
    .all();
  return c.json({ items: rows.results ?? [] });
});

roadmapRoutes.patch('/roadmap/:id', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  const row = await c.env.DB.prepare('SELECT created_by FROM roadmap_items WHERE id = ?')
    .bind(id)
    .first<{ created_by: string | null }>();
  if (!row) throw new HTTPException(404, { message: 'roadmap item not found' });
  // Only the creator can edit. System-seeded items (created_by NULL)
  // are admin-only — no athlete may edit until we ship a role check.
  if (row.created_by !== session.userId) {
    throw new HTTPException(403, { message: 'only the creator can edit this item' });
  }
  const body = (await c.req.raw.json().catch(() => null)) as
    | { status?: string; sortOrder?: number; title?: string; description?: string }
    | null;
  if (!body) throw new HTTPException(400, { message: 'body required' });

  const sets: string[] = [];
  const vals: unknown[] = [];
  const VALID_STATUS = new Set(['backlog', 'planned', 'in_progress', 'released']);
  if (body.status) {
    if (!VALID_STATUS.has(body.status)) {
      throw new HTTPException(400, { message: 'invalid status' });
    }
    sets.push('status = ?');
    vals.push(body.status);
    if (body.status === 'released') {
      sets.push('released_at = unixepoch()');
    }
  }
  if (typeof body.sortOrder === 'number') {
    sets.push('sort_order = ?');
    vals.push(body.sortOrder);
  }
  if (body.title) {
    sets.push('title = ?');
    vals.push(body.title.slice(0, 140));
  }
  if (body.description != null) {
    sets.push('description = ?');
    vals.push(body.description.slice(0, 2000));
  }
  if (sets.length === 0) return c.json({ ok: true });
  sets.push('updated_at = unixepoch()');
  await c.env.DB.prepare(`UPDATE roadmap_items SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals, id)
    .run();
  return c.json({ ok: true });
});
