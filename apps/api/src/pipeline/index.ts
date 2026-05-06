/**
 * Queue consumer entry point — runs `parse → metrics → persist` for
 * each IngestJob. Idempotent on activityId.
 *
 * Per-message failures are surfaced via msg.retry()/ack() so Cloudflare
 * Queues handles retries + DLQ. Throwing from the handler also retries
 * the entire batch, which is acceptable for our small batches.
 */

import type { Env, IngestJob, QueueJob, ActivityIngestJob, ArchiveProcessJob } from '../env.js';
import { parseRaw } from './parse.js';
import { computeMetrics, type AthleteThresholds } from './metrics.js';
import { persistActivity } from './persist.js';
import { processArchiveJob } from './archive.js';

export async function processIngestJob(env: Env, job: IngestJob): Promise<void> {
  const obj = await env.RAW_BUCKET.get(job.rawR2Path);
  if (!obj) throw new Error(`raw object missing: ${job.rawR2Path}`);
  const raw = (await obj.arrayBuffer()) as ArrayBuffer;

  const activity = await parseRaw(job, raw);
  const thr = await loadAthleteThresholds(env, job.athleteId);
  const { summary, metrics } = computeMetrics(activity, thr);

  await persistActivity(env, { job, activity, summary, metrics });
}

async function loadAthleteThresholds(env: Env, userId: string): Promise<AthleteThresholds> {
  const row = await env.DB.prepare(
    'SELECT ftp, hr_max AS hrMax, hr_rest AS hrRest, threshold_pace_ms_x100 AS thrPace100 FROM users WHERE id = ?',
  )
    .bind(userId)
    .first<{
      ftp: number | null;
      hrMax: number | null;
      hrRest: number | null;
      thrPace100: number | null;
    }>();
  if (!row) return {};
  const out: AthleteThresholds = {};
  if (row.ftp != null) out.ftp = row.ftp;
  if (row.hrMax != null) out.hrMax = row.hrMax;
  if (row.hrRest != null) out.hrRest = row.hrRest;
  if (row.thrPace100 != null) out.thresholdPaceMs = row.thrPace100 / 100;
  return out;
}

export async function queueHandler(batch: MessageBatch<QueueJob>, env: Env): Promise<void> {
  for (const msg of batch.messages) {
    try {
      const body = msg.body;
      if (isArchiveJob(body)) {
        await processArchiveJob(env, body);
      } else {
        await processIngestJob(env, body as ActivityIngestJob);
      }
      msg.ack();
    } catch (err) {
      console.error('queue job failed', err);
      msg.retry();
    }
  }
}

function isArchiveJob(body: QueueJob): body is ArchiveProcessJob {
  return (body as { kind?: string }).kind === 'archive';
}
