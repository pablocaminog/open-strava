/**
 * pacelore API worker.
 *
 * Hono router. Domain routes attach in `buildApp`.
 */

import { Hono } from 'hono';
import { errorMiddleware } from './middleware/error.js';
import { corsMiddleware } from './middleware/cors.js';
import { requestIdMiddleware } from './middleware/requestId.js';
import { demoGuard } from './middleware/demoGuard.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { activityRoutes } from './routes/activities.js';
import { athleteRoutes } from './routes/athletes.js';
import { followRoutes } from './routes/follows.js';
import { feedRoutes } from './routes/feed.js';
import { segmentRoutes } from './routes/segments.js';
import { clubRoutes } from './routes/clubs.js';
import { eventRoutes } from './routes/events.js';
import { challengeRoutes } from './routes/challenges.js';
import { trainingRoutes } from './routes/training.js';
import { exportRoutes } from './routes/exports.js';
import { settingsRoutes } from './routes/settings.js';
import { mcpRoutes } from './routes/mcp.js';
import { stravaRoutes } from './routes/strava.js';
import { garminRoutes } from './routes/garmin.js';
import { permanenceRoutes } from './routes/permanence.js';
import { atprotoRoutes } from './routes/atproto.js';
import { roadmapRoutes } from './routes/roadmap.js';
import { queueHandler } from './pipeline/index.js';
import { scheduledHandler } from './scheduled.js';
import type { Env, IngestJob } from './env.js';

export function buildApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>({ strict: false });
  app.use('*', requestIdMiddleware());
  app.use('*', errorMiddleware());
  app.use('*', corsMiddleware());
  // demoGuard short-circuits writes when DEMO_MODE=true; no-op otherwise.
  app.use('*', demoGuard());

  app.get('/', (c) =>
    c.json({
      name: 'pacelore-api',
      env: c.env.ENV,
      docs: 'https://github.com/pablocaminog/pacelore',
    }),
  );

  app.route('/', healthRoutes);
  app.route('/api/v1', authRoutes);
  app.route('/api/v1', activityRoutes);
  app.route('/api/v1', athleteRoutes);
  app.route('/api/v1', followRoutes);
  app.route('/api/v1', feedRoutes);
  app.route('/api/v1', segmentRoutes);
  app.route('/api/v1', clubRoutes);
  app.route('/api/v1', eventRoutes);
  app.route('/api/v1', challengeRoutes);
  app.route('/api/v1', trainingRoutes);
  app.route('/api/v1', exportRoutes);
  app.route('/api/v1', settingsRoutes);
  app.route('/api/v1', stravaRoutes);
  app.route('/api/v1', garminRoutes);
  app.route('/api/v1', permanenceRoutes);
  app.route('/api/v1', atprotoRoutes);
  app.route('/api/v1', roadmapRoutes);
  app.route('/mcp', mcpRoutes);

  // Root-level OAuth discovery (Claude tries origin-level before path-level).
  app.get('/.well-known/oauth-protected-resource', (c) => {
    const origin = new URL(c.req.url).origin;
    const base = `${origin}/mcp`;
    return c.json({
      resource: base,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: ['read:activities', 'read:social', 'write:social'],
    });
  });
  const mcpAuthServerMeta = (origin: string) => {
    const base = `${origin}/mcp`;
    return {
      issuer: origin,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['read:activities', 'read:social', 'write:social'],
    };
  };
  app.get('/.well-known/oauth-authorization-server', (c) =>
    c.json(mcpAuthServerMeta(new URL(c.req.url).origin)),
  );
  // RFC 8414 §3: when issuer has path /mcp, discovery URL is /.well-known/oauth-authorization-server/mcp
  app.get('/.well-known/oauth-authorization-server/mcp', (c) =>
    c.json(mcpAuthServerMeta(new URL(c.req.url).origin)),
  );

  app.notFound((c) => c.json({ error: 'not_found', status: 404 }, 404));
  return app;
}

const app = buildApp();

export default {
  fetch: app.fetch,
  queue: (batch: MessageBatch<IngestJob>, env: Env) => queueHandler(batch, env),
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) =>
    scheduledHandler(event, env, ctx),
} satisfies ExportedHandler<Env, IngestJob>;
