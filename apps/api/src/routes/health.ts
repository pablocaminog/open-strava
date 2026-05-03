import { Hono } from 'hono';
import type { Env } from '../env.js';

export const healthRoutes = new Hono<{ Bindings: Env }>();

healthRoutes.get('/healthz', (c) => c.json({ ok: true, env: c.env.ENV }));

healthRoutes.get('/readyz', async (c) => {
  // Lightweight readiness: D1 round-trip.
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, db: true });
  } catch {
    return c.json({ ok: false, db: false }, 503);
  }
});
