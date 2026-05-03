/**
 * Worker bindings declared in wrangler.toml.
 * Centralized so route handlers can import the canonical type.
 */

export interface Env {
  // Vars
  ENV: 'dev' | 'staging' | 'production';
  APP_ORIGIN: string;

  // Secrets
  SESSION_SIGNING_KEY: string;

  // Storage
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  PARSED_BUCKET: R2Bucket;
  EXPORTS_BUCKET: R2Bucket;

  // KV
  KV_SESSIONS: KVNamespace;
  KV_LEADERBOARDS: KVNamespace;
  KV_FEED: KVNamespace;

  // Queues
  INGEST_QUEUE: Queue<IngestJob>;
}

export interface IngestJob {
  activityId: string;
  athleteId: string;
  rawR2Path: string;
  source: 'fit' | 'tcx' | 'gpx';
}
