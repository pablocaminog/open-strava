import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env.js';

/**
 * Allow the configured Pages origin to reach the API with credentials.
 * MCP and OAuth discovery endpoints use wildcard CORS — auth is via
 * Bearer token, not cookies, so credentials: false is safe there.
 */
export function corsMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const isMcp = path.startsWith('/mcp') || path.startsWith('/.well-known/oauth-');

    return cors({
      origin: isMcp
        ? '*'
        : (origin, c2) => {
            const allow = (c2 as typeof c).env.APP_ORIGIN;
            return origin === allow ? origin : null;
          },
      credentials: !isMcp,
      allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
      exposeHeaders: ['X-Request-Id'],
      maxAge: 86_400,
    })(c, next);
  };
}
