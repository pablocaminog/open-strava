import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env.js';

/**
 * Allow the configured Pages origin to reach the API with credentials.
 * The API key path stays open for third-party tools (per arch doc:
 * "Open API — third parties welcome, attribution-only").
 */
export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return cors({
    origin: (origin, c) => {
      const allow = c.env.APP_ORIGIN;
      if (origin === allow) return origin;
      // Permit unauthenticated tooling without credentials.
      return null;
    },
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 86_400,
  });
}
