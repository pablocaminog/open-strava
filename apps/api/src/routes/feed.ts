/**
 * GET /api/v1/feed
 *
 * Reverse-chronological union of self + followees' visible activities.
 * Pagination is a started_at-based cursor (keyset) — stable under inserts.
 *
 * Visibility — for v1 we accept anything that isn't 'private' from
 * followees, plus all of self. 'followers' visibility check requires
 * the 'follows' edge to exist; the WHERE filters that.
 */

import { Hono } from 'hono';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';

export const feedRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

feedRoutes.use('*', requireSession());

interface FeedRow {
  id: string;
  athleteId: string;
  handle: string;
  displayName: string | null;
  sport: string;
  name: string | null;
  startedAt: number;
  totalSeconds: number;
  distanceM: number | null;
  np: number | null;
  tss: number | null;
  hrAvg: number | null;
}

feedRoutes.get('/feed', async (c) => {
  const session = c.get('session');
  const url = new URL(c.req.url);
  const cursor = url.searchParams.get('cursor');
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') ?? 25)));

  // Followees plus self.
  const cursorClause = cursor ? 'AND a.started_at < ?' : '';
  const sql = `
    SELECT a.id, a.athlete_id AS athleteId,
           u.handle, u.display_name AS displayName,
           a.sport, a.name, a.started_at AS startedAt, a.total_seconds AS totalSeconds,
           a.distance_m AS distanceM, a.np, a.tss, a.hr_avg AS hrAvg
      FROM activities a
      JOIN users u ON u.id = a.athlete_id
     WHERE (
       a.athlete_id = ?
       OR (
         a.athlete_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
         AND a.visibility IN ('followers','public')
       )
       OR a.visibility = 'public'
     ) ${cursorClause}
     ORDER BY a.started_at DESC
     LIMIT ?`;

  const stmt = cursor
    ? c.env.DB.prepare(sql).bind(session.userId, session.userId, Number(cursor), limit + 1)
    : c.env.DB.prepare(sql).bind(session.userId, session.userId, limit + 1);

  const result = await stmt.all<FeedRow>();
  const rows = result.results ?? [];
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  const nextCursor = more ? String(page[page.length - 1]!.startedAt) : null;
  return c.json({ items: page, nextCursor });
});
