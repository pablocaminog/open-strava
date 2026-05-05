/**
 * Challenges — Strava-style goals over a date range.
 *
 *   POST   /api/v1/challenges              — create
 *   GET    /api/v1/challenges              — list active/upcoming
 *   GET    /api/v1/challenges/:id          — detail
 *   POST   /api/v1/challenges/:id/join     — join
 *   DELETE /api/v1/challenges/:id/join     — leave
 *   GET    /api/v1/challenges/:id/leaderboard — sum aggregate of participants
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';
import { uuidv7 } from '../util/uuid.js';

export const challengeRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();
challengeRoutes.use('*', requireSession());

const METRICS = ['distance_m', 'ascent_m', 'total_seconds', 'tss'] as const;
type Metric = (typeof METRICS)[number];

interface CreateBody {
  name?: string;
  description?: string;
  metric?: Metric;
  goal?: number;
  sport?: string;
  startsAt?: string | number;
  endsAt?: string | number;
  visibility?: 'public' | 'private';
}

challengeRoutes.post('/challenges', async (c) => {
  const body = (await c.req.json()) as CreateBody;
  const session = c.get('session');
  if (!body.name || !body.metric || !METRICS.includes(body.metric)) {
    throw new HTTPException(400, { message: 'name + metric required' });
  }
  if (typeof body.goal !== 'number' || body.goal <= 0) {
    throw new HTTPException(400, { message: 'goal must be > 0' });
  }
  const startsAt = parseTs(body.startsAt);
  const endsAt = parseTs(body.endsAt);
  if (!startsAt || !endsAt || endsAt <= startsAt) {
    throw new HTTPException(400, { message: 'invalid startsAt/endsAt' });
  }
  const id = uuidv7();
  await c.env.DB.prepare(
    `INSERT INTO challenges (id, name, description, metric, goal, sport, starts_at, ends_at, visibility, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      body.name,
      body.description ?? null,
      body.metric,
      body.goal,
      body.sport ?? null,
      startsAt,
      endsAt,
      body.visibility ?? 'public',
      session.userId,
    )
    .run();
  return c.json({ id }, 201);
});

challengeRoutes.get('/challenges', async (c) => {
  const now = Math.floor(Date.now() / 1000);
  const rows = await c.env.DB.prepare(
    `SELECT id, name, metric, goal, sport, starts_at AS startsAt, ends_at AS endsAt, visibility
       FROM challenges
      WHERE visibility = 'public' AND ends_at >= ?
      ORDER BY starts_at ASC
      LIMIT 100`,
  )
    .bind(now)
    .all();
  return c.json({ items: rows.results ?? [] });
});

challengeRoutes.get('/challenges/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, name, description, metric, goal, sport, starts_at AS startsAt,
            ends_at AS endsAt, visibility, created_by AS createdBy, created_at AS createdAt
       FROM challenges WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!row) throw new HTTPException(404, { message: 'challenge not found' });
  return c.json(row);
});

challengeRoutes.post('/challenges/:id/join', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare(
    `INSERT INTO challenge_participants (challenge_id, athlete_id) VALUES (?, ?)
     ON CONFLICT (challenge_id, athlete_id) DO NOTHING`,
  )
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

challengeRoutes.delete('/challenges/:id/join', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  await c.env.DB.prepare(
    `DELETE FROM challenge_participants WHERE challenge_id = ? AND athlete_id = ?`,
  )
    .bind(id, session.userId)
    .run();
  return c.json({ ok: true });
});

challengeRoutes.get('/challenges/:id/leaderboard', async (c) => {
  const id = c.req.param('id');
  const ch = await c.env.DB.prepare(
    `SELECT metric, sport, starts_at AS startsAt, ends_at AS endsAt
       FROM challenges WHERE id = ?`,
  )
    .bind(id)
    .first<{ metric: Metric; sport: string | null; startsAt: number; endsAt: number }>();
  if (!ch) throw new HTTPException(404, { message: 'challenge not found' });

  const col = ch.metric;
  const sportClause = ch.sport ? 'AND a.sport = ?' : '';
  const params: unknown[] = [id, ch.startsAt, ch.endsAt];
  if (ch.sport) params.push(ch.sport);

  const rows = await c.env.DB.prepare(
    `SELECT u.id AS athleteId, u.handle, u.display_name AS displayName,
            COALESCE(SUM(a.${col}), 0) AS total
       FROM challenge_participants p
       JOIN users u ON u.id = p.athlete_id
       LEFT JOIN activities a ON a.athlete_id = p.athlete_id
              AND a.started_at BETWEEN ? AND ?
              ${sportClause}
      WHERE p.challenge_id = ?
      GROUP BY u.id
      ORDER BY total DESC
      LIMIT 200`,
  )
    .bind(ch.startsAt, ch.endsAt, ...(ch.sport ? [ch.sport] : []), id)
    .all();
  return c.json({ items: rows.results ?? [] });
});

function parseTs(input: string | number | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') return Math.floor(input);
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}
