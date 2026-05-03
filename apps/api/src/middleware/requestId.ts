import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env.js';

/**
 * Stamps a per-request id on the response — useful for log
 * correlation when something goes wrong.
 */
export function requestIdMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const incoming = c.req.header('X-Request-Id');
    const id = incoming ?? crypto.randomUUID();
    c.set('requestId' as never, id as never);
    await next();
    c.header('X-Request-Id', id);
  };
}
