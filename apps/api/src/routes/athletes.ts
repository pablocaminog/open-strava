/**
 * Athlete-scoped read endpoints.
 *
 *   GET /api/v1/athletes/:id/pmc?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Returns the daily CTL/ATL/TSB series, computed on the fly from
 * pmc_daily.tss so the table only needs to track raw stress.
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { pmcDaily } from '@open-strava/metrics';
import type { Env } from '../env.js';
import { requireSession, type AuthVariables } from '../middleware/auth.js';

export const athleteRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

athleteRoutes.use('*', requireSession());

athleteRoutes.get('/athletes/:id/pmc', async (c) => {
  const id = c.req.param('id');
  const session = c.get('session');
  if (id !== session.userId) {
    throw new HTTPException(403, { message: 'PMC access limited to self' });
  }

  const url = new URL(c.req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to') ?? today();
  if (!isValidDate(to) || (from && !isValidDate(from))) {
    throw new HTTPException(400, { message: 'from/to must be YYYY-MM-DD' });
  }

  const stmt = from
    ? c.env.DB.prepare(
        'SELECT date, tss FROM pmc_daily WHERE athlete_id = ? AND date >= ? AND date <= ? ORDER BY date',
      ).bind(id, from, to)
    : c.env.DB.prepare(
        'SELECT date, tss FROM pmc_daily WHERE athlete_id = ? AND date <= ? ORDER BY date',
      ).bind(id, to);

  const rows = await stmt.all<{ date: string; tss: number }>();
  const entries = (rows.results ?? []).map((r) => ({ date: r.date, tss: r.tss }));
  const series = pmcDaily(entries, { endDate: to });
  return c.json({ athleteId: id, from: series[0]?.date ?? from ?? to, to, days: series });
});

function today(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}
