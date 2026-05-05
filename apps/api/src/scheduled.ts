/**
 * Cron handler (configured via wrangler.toml [triggers]).
 *
 *   `* * * * *`  every-minute tick: advance up to N running import_jobs
 *                                   (Strava/Garmin backfill workers).
 *   `0 5 * * *`  nightly: recompute pmc_daily for active athletes.
 *
 * Cloudflare invokes this once per cron expression. We branch on
 * `event.cron` so a single handler covers both.
 */

import { pmcDaily } from '@pacelore/metrics';
import type { Env } from './env.js';
import { stravaTickOnce } from './routes/strava.js';
import { garminTickOnce } from './routes/garmin.js';

// How many import_jobs to advance per minute-tick. Each Strava tick costs
// ~26 requests against the 100/15min quota — keep this low.
const IMPORTS_PER_TICK = 4;

export async function scheduledHandler(
  event: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  if (event.cron === '0 5 * * *') {
    await recomputePmcForActiveAthletes(env);
    return;
  }
  // Default branch covers `* * * * *` (and any future fine-grained cron).
  await advanceImportJobs(env);
}

async function advanceImportJobs(env: Env): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT id, provider FROM import_jobs
      WHERE status = 'running'
      ORDER BY updated_at ASC
      LIMIT ?`,
  )
    .bind(IMPORTS_PER_TICK)
    .all<{ id: string; provider: 'strava' | 'garmin' }>();

  for (const row of rows.results ?? []) {
    try {
      if (row.provider === 'strava') await stravaTickOnce(env, row.id);
      else if (row.provider === 'garmin') await garminTickOnce(env, row.id);
    } catch (err) {
      console.error('import tick failed', row.id, err);
    }
  }
}

async function recomputePmcForActiveAthletes(env: Env): Promise<void> {
  const result = await env.DB.prepare(
    `SELECT DISTINCT athlete_id FROM pmc_daily WHERE date >= date('now', '-90 days')`,
  ).all<{ athlete_id: string }>();
  const ids = (result.results ?? []).map((r) => r.athlete_id);
  for (const id of ids) {
    const tssRows = await env.DB.prepare(
      `SELECT date, tss FROM pmc_daily
        WHERE athlete_id = ? AND date >= date('now', '-180 days')
        ORDER BY date`,
    )
      .bind(id)
      .all<{ date: string; tss: number }>();
    const series = pmcDaily(tssRows.results ?? [], { endDate: today() });
    const stmts = series.map((d) =>
      env.DB.prepare(
        `INSERT INTO pmc_daily (athlete_id, date, tss, ctl, atl, tsb)
           VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(athlete_id, date) DO UPDATE
           SET ctl = excluded.ctl, atl = excluded.atl, tsb = excluded.tsb`,
      ).bind(id, d.date, d.tss, d.ctl, d.atl, d.tsb),
    );
    if (stmts.length > 0) await env.DB.batch(stmts);
  }
}

function today(): string {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
