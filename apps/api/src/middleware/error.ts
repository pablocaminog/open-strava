import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../env.js';

/**
 * Translates HTTPException → JSON error envelope; logs unexpected throws
 * and returns a generic 500 so client gets a stable shape.
 */
export function errorMiddleware(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    try {
      await next();
    } catch (err) {
      if (err instanceof HTTPException) {
        return c.json({ error: err.message || 'request failed', status: err.status }, err.status);
      }
      console.error('unhandled', err);
      return c.json({ error: 'internal_error', status: 500 }, 500);
    }
  };
}
