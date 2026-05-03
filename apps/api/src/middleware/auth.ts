import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { loadSession, type SessionRecord } from '../auth/session.js';
import type { Env } from '../env.js';

export interface AuthVariables {
  session: SessionRecord;
}

/**
 * Requires a valid session cookie. On success, exposes
 * `c.get('session')` to downstream handlers.
 */
export function requireSession(): MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthVariables;
}> {
  return async (c, next) => {
    const session = await loadSession(c.env, c.req.header('Cookie') ?? null);
    if (!session) throw new HTTPException(401, { message: 'authentication required' });
    c.set('session', session);
    await next();
  };
}
