/**
 * Model Context Protocol (MCP) server — JSON-RPC 2.0 over HTTP.
 *
 * Exposes a curated tool surface so an agentic AI can read + act on
 * the user's pacelore data. Authentication is via the same
 * X-Api-Key header used by the public REST API, or via OAuth 2.1
 * Bearer tokens (for Claude custom connector support).
 *
 * OAuth 2.1 endpoints (public, no auth required):
 *   GET  /.well-known/oauth-authorization-server  (discovery)
 *   GET  /authorize                                (HTML form → code)
 *   POST /authorize                                (form submit → redirect)
 *   POST /token                                    (code → access_token)
 *
 * MCP JSON-RPC 2.0 (requires auth):
 *   POST /
 *
 * Methods implemented:
 *   - initialize
 *   - tools/list
 *   - tools/call
 *   - resources/list
 *   - resources/read
 */

import { Hono, type Context } from 'hono';
import type { Env } from '../env.js';
import { requireApiKey, type ApiKeyVariables } from '../auth/apiKey.js';
import { uuidv7 } from '../util/uuid.js';
import { parseWorkoutCsv, WorkoutCsvError } from '@pacelore/workout-csv';

type Ctx = Context<{ Bindings: Env; Variables: ApiKeyVariables }>;

export const mcpRoutes = new Hono<{ Bindings: Env; Variables: ApiKeyVariables }>({ strict: false });

// ── OAuth helpers ────────────────────────────────────────────────────────────

const OAUTH_CODE_TTL = 300; // 5 minutes

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function sha256Base64Url(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── OAuth 2.1 endpoints (no auth required) ───────────────────────────────────

// origin = root domain (e.g. https://api.pacelore.com)
// Clients strip the /mcp path when doing RFC 8414 issuer lookup, so issuer must be root.
function authServerMeta(origin: string) {
  const base = `${origin}/mcp`;
  return {
    issuer: origin,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['read:activities', 'read:social', 'write:social', 'write:training'],
  };
}

// RFC 9728 — Claude fetches this first, before oauth-authorization-server.
mcpRoutes.get('/.well-known/oauth-protected-resource', (c) => {
  const { origin } = new URL(c.req.url);
  return c.json({
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    bearer_methods_supported: ['header'],
    scopes_supported: ['read:activities', 'read:social', 'write:social', 'write:training'],
  });
});

mcpRoutes.get('/.well-known/oauth-authorization-server', (c) => {
  const { origin } = new URL(c.req.url);
  return c.json(authServerMeta(origin));
});

mcpRoutes.get('/authorize', (c) => {
  const q = c.req.query();
  const { redirect_uri = '', state = '', code_challenge = '', code_challenge_method = 'S256' } = q;
  // Bare GET with no params = health probe. Return 200 so Claude doesn't fail at start_error.
  if (!redirect_uri || !code_challenge) {
    return c.html('<html><body><h2>pacelore MCP authorization</h2><p>This endpoint requires an OAuth 2.1 authorization request from a compatible client.</p></body></html>');
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connect Claude to pacelore</title>
<style>
*{box-sizing:border-box}
body{font-family:system-ui;max-width:420px;margin:80px auto;padding:0 20px;color:#e0e0e0;background:#0E1012}
h1{font-size:20px;margin-bottom:4px}
p{color:#888;font-size:14px;margin-bottom:24px}
label{display:block;font-size:13px;margin-bottom:6px;color:#aaa}
input[type=password]{width:100%;padding:10px 12px;border:1px solid #333;border-radius:8px;background:#1a1d20;color:#fff;font-family:monospace;font-size:14px;margin-bottom:16px;outline:none}
input[type=password]:focus{border-color:#C8FA1F}
button{width:100%;padding:12px;background:#C8FA1F;color:#0E1012;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
.hint{font-size:12px;color:#666;margin-top:16px}a{color:#C8FA1F}
</style>
</head>
<body>
<h1>Connect Claude to pacelore</h1>
<p>Enter your API key to let Claude read your training data.</p>
<form method="POST" action="/mcp/authorize">
<input type="hidden" name="redirect_uri" value="${escapeHtml(redirect_uri)}">
<input type="hidden" name="state" value="${escapeHtml(state)}">
<input type="hidden" name="code_challenge" value="${escapeHtml(code_challenge)}">
<input type="hidden" name="code_challenge_method" value="${escapeHtml(code_challenge_method)}">
<label for="k">API Key</label>
<input id="k" name="apikey" type="password" placeholder="osk_..." autocomplete="off" required>
<button type="submit">Authorize</button>
</form>
<p class="hint">Find your key at <a href="https://pacelore.com/settings" target="_blank">pacelore.com/settings</a>.</p>
</body>
</html>`;
  return c.html(html);
});

mcpRoutes.post('/authorize', async (c) => {
  const body = await c.req.parseBody() as Record<string, string>;
  const { redirect_uri, state, code_challenge, code_challenge_method = 'S256', apikey } = body;
  if (!redirect_uri || !code_challenge || !apikey) return c.text('Missing required fields', 400);
  if (!apikey.includes('.')) return c.html('<p>Invalid API key format. <a href="javascript:history.back()">Go back</a></p>', 400);

  const code = crypto.randomUUID();
  await c.env.KV_SESSIONS.put(
    `mcp_oauth:${code}`,
    JSON.stringify({ apiKey: apikey, codeChallenge: code_challenge, codeChallengeMethod: code_challenge_method }),
    { expirationTtl: OAUTH_CODE_TTL },
  );

  const dest = new URL(redirect_uri);
  dest.searchParams.set('code', code);
  if (state) dest.searchParams.set('state', state);
  return c.redirect(dest.toString(), 302);
});

mcpRoutes.post('/token', async (c) => {
  const body = await c.req.parseBody() as Record<string, string>;
  const { grant_type, code, code_verifier } = body;
  if (grant_type !== 'authorization_code' || !code || !code_verifier) {
    return c.json({ error: 'invalid_request' }, 400);
  }

  const raw = await c.env.KV_SESSIONS.get(`mcp_oauth:${code}`);
  if (!raw) return c.json({ error: 'invalid_grant' }, 400);

  const { apiKey, codeChallenge, codeChallengeMethod } = JSON.parse(raw) as {
    apiKey: string; codeChallenge: string; codeChallengeMethod: string;
  };

  if (codeChallengeMethod === 'S256') {
    const hash = await sha256Base64Url(code_verifier);
    if (hash !== codeChallenge) return c.json({ error: 'invalid_grant' }, 400);
  }

  await c.env.KV_SESSIONS.delete(`mcp_oauth:${code}`);

  return c.json({ access_token: apiKey, token_type: 'bearer', expires_in: 315_360_000 });
});

const SERVER_INFO = {
  name: 'pacelore',
  version: '0.1.0',
};

const TOOLS = [
  {
    name: 'list_activities',
    description: "List the authenticated athlete's activities, newest first.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
        cursor: { type: 'string' },
      },
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'get_activity',
    description: 'Fetch one activity, with summary metrics.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'get_pmc',
    description: 'CTL / ATL / TSB time series for the athlete over a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'list_segments_in_bbox',
    description: 'List segments whose bbox intersects the supplied area.',
    inputSchema: {
      type: 'object',
      properties: {
        minLat: { type: 'number' },
        minLng: { type: 'number' },
        maxLat: { type: 'number' },
        maxLng: { type: 'number' },
        sport: { type: 'string' },
      },
      required: ['minLat', 'minLng', 'maxLat', 'maxLng'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'segment_leaderboard',
    description: 'Top efforts on a segment.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        window: { type: 'string', enum: ['all', '90d', 'year'] },
      },
      required: ['id'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'kudos_activity',
    description: 'Give kudos to an activity (must be visible to the caller).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'comment_on_activity',
    description: 'Post a comment on a visible activity (≤2000 chars).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, body: { type: 'string' } },
      required: ['id', 'body'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'follow',
    description: 'Follow an athlete by id.',
    inputSchema: {
      type: 'object',
      properties: { athleteId: { type: 'string' } },
      required: ['athleteId'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'unfollow',
    description: 'Unfollow an athlete by id.',
    inputSchema: {
      type: 'object',
      properties: { athleteId: { type: 'string' } },
      required: ['athleteId'],
    },
    requiredScope: 'write:social',
  },
  {
    name: 'get_feed',
    description: 'Return the recent feed (self + followees).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 25 },
        cursor: { type: 'string' },
      },
    },
    requiredScope: 'read:social',
  },
  {
    name: 'list_planned_workouts',
    description: 'List planned workouts between two dates (inclusive).',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        to: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
      },
      required: ['from', 'to'],
    },
    requiredScope: 'read:activities',
  },
  {
    name: 'schedule_workout',
    description: 'Schedule a planned workout on a specific date.',
    inputSchema: {
      type: 'object',
      properties: {
        scheduledDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
        sport: { type: 'string', enum: ['cycling', 'running', 'swimming', 'other'] },
        durationMin: { type: 'integer', minimum: 1 },
        targetZone: { type: 'string' },
        description: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['scheduledDate', 'sport', 'durationMin'],
    },
    requiredScope: 'write:training',
  },
  {
    name: 'delete_planned_workout',
    description: 'Remove a planned workout by id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    requiredScope: 'write:training',
  },
  {
    name: 'create_workout_from_csv',
    description:
      'Create a structured workout from CSV text. First row: name, sport[, description]. Subsequent rows: block_name, duration_secs[, target]. Target formats: 170W, 80-150W, 75%, 80-90%, 140bpm, 4:30/km. Optionally schedule on a date.',
    inputSchema: {
      type: 'object',
      properties: {
        csvText: { type: 'string' },
        scheduledDate: {
          type: 'string',
          pattern: '^\\d{4}-\\d{2}-\\d{2}$',
          description: 'Optional YYYY-MM-DD to schedule immediately after creating.',
        },
      },
      required: ['csvText'],
    },
    requiredScope: 'write:training',
  },
] as const;

// ── MCP JSON-RPC endpoint (auth required) ───────────────────────────────────

function wwwAuthenticate(origin: string) {
  // Must point to oauth-protected-resource (RFC 9728), not oauth-authorization-server.
  return `Bearer realm="${origin}/mcp", resource_metadata="${origin}/mcp/.well-known/oauth-protected-resource"`;
}

// Accept X-Api-Key OR Authorization: Bearer <key> (issued by OAuth flow above).
// On 401, add WWW-Authenticate so Claude can discover and initiate OAuth.
mcpRoutes.use('/', async (c, next) => {
  const origin = new URL(c.req.url).origin;
  const bearer = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const headers = new Headers(c.req.raw.headers);
    headers.set('x-api-key', bearer);
    c.req.raw = new Request(c.req.raw, { headers });
  }
  try {
    return await requireApiKey()(c, next);
  } catch (err: unknown) {
    const { HTTPException } = await import('hono/http-exception');
    if (err instanceof HTTPException && err.status === 401) {
      return new Response(err.message, {
        status: 401,
        headers: {
          'WWW-Authenticate': wwwAuthenticate(origin),
          'Content-Type': 'text/plain',
        },
      });
    }
    throw err;
  }
});

mcpRoutes.post('/', async (c) => {
  const req = (await c.req.raw.json().catch(() => null)) as {
    jsonrpc?: string;
    id?: number | string;
    method?: string;
    params?: Record<string, unknown>;
  } | null;
  if (!req || req.jsonrpc !== '2.0' || !req.method) {
    return c.json(
      { jsonrpc: '2.0', id: req?.id ?? null, error: { code: -32600, message: 'invalid request' } },
      400,
    );
  }

  const { method, id = null } = req;
  const params = req.params ?? {};
  const apiKey = c.get('apiKey');

  try {
    if (method === 'initialize') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
        },
      });
    }
    if (method === 'tools/list') {
      return c.json({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS.map(({ requiredScope: _s, ...t }) => t) },
      });
    }
    if (method === 'resources/list') {
      const activities = await c.env.DB.prepare(
        'SELECT id, name, sport, started_at FROM activities WHERE athlete_id = ? ORDER BY started_at DESC LIMIT 100',
      )
        .bind(apiKey.userId)
        .all<{ id: string; name: string | null; sport: string; started_at: number }>();
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          resources: (activities.results ?? []).map((a) => ({
            uri: `pacelore://activities/${a.id}`,
            name:
              a.name ?? `${a.sport} ${new Date(a.started_at * 1000).toISOString().slice(0, 10)}`,
            mimeType: 'application/json',
          })),
        },
      });
    }
    if (method === 'resources/read') {
      const uri = String(params.uri ?? '');
      const m = uri.match(/^pacelore:\/\/activities\/([^/]+)$/);
      if (!m) return jsonRpcError(c, id, -32602, 'unsupported uri');
      return runTool(c, id, 'get_activity', { id: m[1]! });
    }
    if (method === 'tools/call') {
      const name = String(params.name ?? '');
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const tool = TOOLS.find((t) => t.name === name);
      if (!tool) return jsonRpcError(c, id, -32601, `unknown tool: ${name}`);
      if (!apiKey.scopes.includes(tool.requiredScope)) {
        return jsonRpcError(c, id, -32004, `missing scope: ${tool.requiredScope}`);
      }
      return runTool(c, id, name, args);
    }
    return jsonRpcError(c, id, -32601, `unknown method: ${method}`);
  } catch (err) {
    return jsonRpcError(c, id, -32603, (err as Error).message);
  }
});

function jsonRpcError(c: Ctx, id: unknown, code: number, message: string) {
  return c.json({ jsonrpc: '2.0', id, error: { code, message } });
}

async function runTool(c: Ctx, id: unknown, name: string, args: Record<string, unknown>) {
  const env: Env = c.env;
  const userId = c.get('apiKey').userId as string;
  const ok = (data: unknown) =>
    c.json({
      jsonrpc: '2.0',
      id,
      result: { content: [{ type: 'text', text: JSON.stringify(data) }] },
    });

  switch (name) {
    case 'list_activities': {
      const limit = Math.min(100, Math.max(1, Number(args.limit ?? 25)));
      const cursor = args.cursor ? Number(args.cursor) : null;
      const stmt = cursor
        ? env.DB.prepare(
            `SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
                    distance_m AS distanceM, np, tss
               FROM activities WHERE athlete_id = ? AND started_at < ?
               ORDER BY started_at DESC LIMIT ?`,
          ).bind(userId, cursor, limit + 1)
        : env.DB.prepare(
            `SELECT id, sport, name, started_at AS startedAt, total_seconds AS totalSeconds,
                    distance_m AS distanceM, np, tss
               FROM activities WHERE athlete_id = ?
               ORDER BY started_at DESC LIMIT ?`,
          ).bind(userId, limit + 1);
      const rows = await stmt.all<{ id: string; startedAt: number }>();
      const results = rows.results ?? [];
      const more = results.length > limit;
      const page = results.slice(0, limit);
      return ok({
        items: page,
        nextCursor: more ? String(page[page.length - 1]!.startedAt) : null,
      });
    }
    case 'get_activity': {
      const aid = String(args.id ?? '');
      const row = await env.DB.prepare(
        `SELECT id, athlete_id AS athleteId, sport, name, started_at AS startedAt,
                total_seconds AS totalSeconds, distance_m AS distanceM,
                np, tss, hr_avg AS hrAvg, power_avg AS powerAvg, visibility
           FROM activities WHERE id = ?`,
      )
        .bind(aid)
        .first<{ athleteId: string; visibility: string }>();
      if (!row) return jsonRpcError(c, id, -32004, 'not found');
      if (row.athleteId !== userId && row.visibility !== 'public') {
        return jsonRpcError(c, id, -32004, 'not allowed');
      }
      const m = await env.DB.prepare(
        'SELECT key, value FROM activity_metrics WHERE activity_id = ?',
      )
        .bind(aid)
        .all();
      return ok({ activity: row, metrics: m.results ?? [] });
    }
    case 'get_pmc': {
      const from = typeof args.from === 'string' ? args.from : null;
      const to = typeof args.to === 'string' ? args.to : todayIso();
      const stmt = from
        ? env.DB.prepare(
            'SELECT date, tss, ctl, atl, tsb FROM pmc_daily WHERE athlete_id = ? AND date >= ? AND date <= ? ORDER BY date',
          ).bind(userId, from, to)
        : env.DB.prepare(
            'SELECT date, tss, ctl, atl, tsb FROM pmc_daily WHERE athlete_id = ? AND date <= ? ORDER BY date',
          ).bind(userId, to);
      const rows = await stmt.all();
      return ok({ days: rows.results ?? [] });
    }
    case 'list_segments_in_bbox': {
      const { minLat, minLng, maxLat, maxLng, sport } = args as Record<string, number | string>;
      const baseSql = `SELECT id, name, sport, distance_m AS distanceM
        FROM segments WHERE bbox_min_lat <= ? AND bbox_max_lat >= ? AND bbox_min_lng <= ? AND bbox_max_lng >= ?`;
      const stmt = sport
        ? env.DB.prepare(`${baseSql} AND sport = ? LIMIT 100`).bind(
            maxLat,
            minLat,
            maxLng,
            minLng,
            sport,
          )
        : env.DB.prepare(`${baseSql} LIMIT 100`).bind(maxLat, minLat, maxLng, minLng);
      const rows = await stmt.all();
      return ok({ items: rows.results ?? [] });
    }
    case 'segment_leaderboard': {
      const sid = String(args.id ?? '');
      const window = String(args.window ?? 'all');
      let cutoff: number | null = null;
      if (window === '90d') cutoff = Math.floor(Date.now() / 1000) - 90 * 86_400;
      const sql = `SELECT e.athlete_id AS athleteId, u.handle, e.time_seconds AS timeSeconds
                     FROM segment_efforts e JOIN users u ON u.id = e.athlete_id
                    WHERE e.segment_id = ? ${cutoff ? 'AND e.started_at >= ?' : ''}
                    ORDER BY e.time_seconds ASC LIMIT 50`;
      const stmt = cutoff ? env.DB.prepare(sql).bind(sid, cutoff) : env.DB.prepare(sql).bind(sid);
      const rows = await stmt.all();
      return ok({ items: rows.results ?? [] });
    }
    case 'kudos_activity': {
      const aid = String(args.id ?? '');
      const v = await env.DB.prepare(
        'SELECT athlete_id AS athleteId, visibility FROM activities WHERE id = ?',
      )
        .bind(aid)
        .first<{ athleteId: string; visibility: string }>();
      if (!v) return jsonRpcError(c, id, -32004, 'not found');
      if (v.athleteId !== userId && v.visibility === 'private') {
        return jsonRpcError(c, id, -32004, 'not allowed');
      }
      await env.DB.prepare(
        'INSERT INTO kudos (activity_id, athlete_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(aid, userId)
        .run();
      return ok({ ok: true });
    }
    case 'comment_on_activity': {
      const aid = String(args.id ?? '');
      const body = String(args.body ?? '').trim();
      if (!body || body.length > 2000) {
        return jsonRpcError(c, id, -32602, 'body 1–2000 chars');
      }
      const cid = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO comments (id, activity_id, athlete_id, body) VALUES (?, ?, ?, ?)',
      )
        .bind(cid, aid, userId, body)
        .run();
      return ok({ id: cid });
    }
    case 'follow': {
      const target = String(args.athleteId ?? '');
      if (target === userId) return jsonRpcError(c, id, -32602, 'cannot follow self');
      await env.DB.prepare(
        'INSERT INTO follows (follower_id, followee_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
      )
        .bind(userId, target)
        .run();
      return ok({ ok: true });
    }
    case 'unfollow': {
      const target = String(args.athleteId ?? '');
      await env.DB.prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
        .bind(userId, target)
        .run();
      return ok({ ok: true });
    }
    case 'get_feed': {
      const limit = Math.min(50, Math.max(1, Number(args.limit ?? 25)));
      const cursor = args.cursor ? Number(args.cursor) : null;
      const sql = `SELECT a.id, a.athlete_id AS athleteId, u.handle, a.sport, a.name,
                          a.started_at AS startedAt, a.total_seconds AS totalSeconds,
                          a.distance_m AS distanceM, a.np, a.tss
                     FROM activities a JOIN users u ON u.id = a.athlete_id
                    WHERE (a.athlete_id = ?
                       OR (a.athlete_id IN (SELECT followee_id FROM follows WHERE follower_id = ?)
                           AND a.visibility IN ('followers','public'))
                       OR a.visibility = 'public')
                       ${cursor ? 'AND a.started_at < ?' : ''}
                    ORDER BY a.started_at DESC LIMIT ?`;
      const stmt = cursor
        ? env.DB.prepare(sql).bind(userId, userId, cursor, limit + 1)
        : env.DB.prepare(sql).bind(userId, userId, limit + 1);
      const rows = await stmt.all<{ startedAt: number }>();
      const results = rows.results ?? [];
      const more = results.length > limit;
      const page = results.slice(0, limit);
      return ok({
        items: page,
        nextCursor: more ? String(page[page.length - 1]!.startedAt) : null,
      });
    }
    case 'list_planned_workouts': {
      const from = typeof args.from === 'string' ? args.from : '';
      const to = typeof args.to === 'string' ? args.to : '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return jsonRpcError(c, id, -32602, 'from and to must be YYYY-MM-DD');
      }
      const rows = await env.DB.prepare(
        `SELECT pw.id, pw.scheduled_date AS scheduledDate, pw.notes,
                pw.workout_id AS workoutId, pw.completed_activity_id AS completedActivityId,
                pw.compliance_score AS complianceScore, pw.session_json AS sessionJson,
                w.name AS workoutName, w.sport AS workoutSport,
                w.estimated_tss AS estimatedTss, w.estimated_duration_sec AS estimatedDurationSec
           FROM planned_workouts pw
           LEFT JOIN workouts w ON w.id = pw.workout_id
          WHERE pw.athlete_id = ?
            AND pw.scheduled_date BETWEEN ? AND ?
          ORDER BY pw.scheduled_date ASC`,
      )
        .bind(userId, from, to)
        .all();
      const items = (rows.results ?? []).map((r: Record<string, unknown>) => {
        const { sessionJson, ...rest } = r;
        const parsed = typeof sessionJson === 'string' ? JSON.parse(sessionJson) : {};
        return { ...parsed, ...rest };
      });
      return ok({ items });
    }
    case 'schedule_workout': {
      const scheduledDate = typeof args.scheduledDate === 'string' ? args.scheduledDate : '';
      const sport = typeof args.sport === 'string' ? args.sport : '';
      const durationMin = Number(args.durationMin ?? 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate)) {
        return jsonRpcError(c, id, -32602, 'scheduledDate must be YYYY-MM-DD');
      }
      if (!['cycling', 'running', 'swimming', 'other'].includes(sport)) {
        return jsonRpcError(c, id, -32602, 'invalid sport');
      }
      if (!Number.isFinite(durationMin) || !Number.isInteger(durationMin) || durationMin < 1) {
        return jsonRpcError(c, id, -32602, 'durationMin must be a positive integer');
      }
      const pwId = uuidv7();
      const sessionJson = JSON.stringify({
        sport,
        durationMin,
        ...(args.targetZone != null ? { targetZone: String(args.targetZone) } : {}),
        ...(args.description != null ? { description: String(args.description) } : {}),
      });
      await env.DB.prepare(
        `INSERT INTO planned_workouts (id, athlete_id, scheduled_date, notes, session_json, assigned_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, unixepoch())`,
      )
        .bind(
          pwId,
          userId,
          scheduledDate,
          args.notes != null ? String(args.notes) : null,
          sessionJson,
          userId,
        )
        .run();
      return ok({ id: pwId });
    }
    case 'delete_planned_workout': {
      const pwId = typeof args.id === 'string' ? args.id : '';
      await env.DB.prepare(
        `DELETE FROM planned_workouts WHERE id = ? AND athlete_id = ?`,
      )
        .bind(pwId, userId)
        .run();
      return ok({ ok: true });
    }
    case 'create_workout_from_csv': {
      const csvText = typeof args.csvText === 'string' ? args.csvText : '';
      if (!csvText) return jsonRpcError(c, id, -32602, 'csvText is required');

      let parsed;
      try {
        parsed = parseWorkoutCsv(csvText);
      } catch (e) {
        if (e instanceof WorkoutCsvError) {
          return jsonRpcError(c, id, -32602, e.message);
        }
        throw e;
      }

      const totalSec = parsed.steps.reduce((s, st) => s + st.durationSec, 0);
      const workoutId = uuidv7();
      await env.DB.prepare(
        `INSERT INTO workouts (id, athlete_id, name, description, sport, estimated_duration_sec, steps_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          workoutId,
          userId,
          parsed.name,
          parsed.description ?? null,
          parsed.sport,
          totalSec,
          JSON.stringify({ steps: parsed.steps }),
        )
        .run();

      let plannedId: string | null = null;
      const scheduledDate =
        typeof args.scheduledDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.scheduledDate)
          ? args.scheduledDate
          : null;
      if (scheduledDate) {
        plannedId = uuidv7();
        await env.DB.prepare(
          `INSERT INTO planned_workouts (id, athlete_id, workout_id, scheduled_date, assigned_by, created_at)
           VALUES (?, ?, ?, ?, ?, unixepoch())`,
        )
          .bind(plannedId, userId, workoutId, scheduledDate, userId)
          .run();
      }

      return ok({ workoutId, ...(plannedId ? { plannedId, scheduledDate } : {}) });
    }
    default:
      return jsonRpcError(c, id, -32601, `unknown tool: ${name}`);
  }
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
