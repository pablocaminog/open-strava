/**
 * Astro middleware — proxies /api/* and /mcp/* to the Worker so the
 * browser sees a single origin (no CORS, no SameSite=None cookie woes).
 *
 * The target is read from the PACELORE_API_ORIGIN env var (set in the
 * Pages dashboard or wrangler.toml). Falls back to the local dev
 * worker for `astro dev`.
 */

import type { MiddlewareHandler } from 'astro';

export const onRequest: MiddlewareHandler = async (context, next) => {
  const url = new URL(context.request.url);

  // Canonicalize on the apex — keep cookies bound to a single host. The
  // session cookie has no Domain attribute, so a visitor who registers
  // on www.pacelore.com and later navigates to pacelore.com would
  // otherwise look unauthenticated.
  if (url.hostname === 'www.pacelore.com') {
    const dest = new URL(url.toString());
    dest.hostname = 'pacelore.com';
    return Response.redirect(dest.toString(), 301);
  }

  // Redirect signed-in visitors away from the marketing page immediately.
  if (url.pathname === '/') {
    const apiOriginForAuth =
      (context.locals as { runtime?: { env?: { PACELORE_API_ORIGIN?: string } } }).runtime?.env
        ?.PACELORE_API_ORIGIN ??
      import.meta.env.PACELORE_API_ORIGIN ??
      (import.meta.env.PROD ? 'https://pacelore-api.typeauth.workers.dev' : 'http://127.0.0.1:8787');
    try {
      const check = await fetch(`${apiOriginForAuth.replace(/\/$/, '')}/api/v1/auth/me`, {
        headers: { cookie: context.request.headers.get('cookie') ?? '' },
      });
      if (check.ok) return Response.redirect(new URL('/home', url).toString(), 302);
    } catch {
      // network error — fall through to marketing page
    }
  }

  if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/mcp')) {
    return next();
  }

  const apiOrigin =
    (context.locals as { runtime?: { env?: { PACELORE_API_ORIGIN?: string } } }).runtime?.env
      ?.PACELORE_API_ORIGIN ??
    import.meta.env.PACELORE_API_ORIGIN ??
    (import.meta.env.PROD
      ? 'https://pacelore-api.typeauth.workers.dev'
      : 'http://127.0.0.1:8787');

  const target = `${apiOrigin.replace(/\/$/, '')}${url.pathname}${url.search}`;
  const init: RequestInit = {
    method: context.request.method,
    headers: context.request.headers,
    body:
      context.request.method === 'GET' || context.request.method === 'HEAD'
        ? undefined
        : context.request.body,
    redirect: 'manual',
  };
  return fetch(target, init);
};
