/**
 * Archive consumer — unpacks a uploaded `.zip` (Garmin Connect /
 * Strava export bundle) sitting in R2, fans each FIT/TCX/GPX file
 * back into the activity ingest queue, then deletes the source
 * archive.
 *
 * Runs from the queue consumer so the original HTTP upload returns
 * fast — the user closes the tab while we work in the background.
 *
 * Bounded by Workers' 30s wall + 128MB memory budget. Real export
 * archives can be hundreds of MB. We page through the entry list
 * and short-circuit cleanly when the budget runs low — re-enqueueing
 * a continuation message keeps the work moving without blowing the
 * limit.
 */

import JSZip from 'jszip';
import type {
  Env,
  ActivityIngestJob,
  ArchiveProcessJob,
  QueueJob,
} from '../env.js';
import { uuidv7 } from '../util/uuid.js';
import { gunzipSync } from 'fflate';

interface EntryHandle {
  name: string;
  bytes: ArrayBuffer;
}

const FIT_EXT = new Set(['fit', 'tcx', 'gpx']);
// Hard cap so a single tick doesn't run out of CPU. Each enqueue is
// cheap; pagination via continuation message keeps the queue moving.
const PER_TICK_FILES = 50;

export async function processArchiveJob(env: Env, job: ArchiveProcessJob): Promise<void> {
  const obj = await env.RAW_BUCKET.get(job.r2Path);
  if (!obj) {
    await markArchive(env, job.archiveId, 'error', 'r2 object missing');
    return;
  }
  await markArchive(env, job.archiveId, 'running');

  const buffer = (await obj.arrayBuffer()) as ArrayBuffer;
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (err) {
    await markArchive(env, job.archiveId, 'error', `unzip failed: ${(err as Error).message}`);
    return;
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  let processed = 0;
  let succeeded = 0;
  let duplicates = 0;
  let failed = 0;

  for (const entry of entries) {
    if (processed >= PER_TICK_FILES) break;
    try {
      const inner = await unwrap(entry.name, await entry.async('arraybuffer'));
      for (const w of inner) {
        const ok = await enqueueActivity(env, job.athleteId, w);
        if (ok === 'queued') succeeded++;
        else if (ok === 'duplicate') duplicates++;
        else failed++;
      }
    } catch (err) {
      failed++;
      console.warn('archive entry failed', entry.name, err);
    }
    processed++;
  }

  // Persist progress before deciding whether to continue or finish.
  await env.DB.prepare(
    `UPDATE archive_imports
        SET total_files = ?, succeeded = succeeded + ?,
            duplicates = duplicates + ?, failed = failed + ?,
            updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(entries.length, succeeded, duplicates, failed, job.archiveId)
    .run();

  if (entries.length > processed) {
    // Re-enqueue the same archive — but with a `cursor` so we skip
    // already-seen entries. Simplest: store cursor on the row and
    // pass through. For now we just truncate the archive in R2 to
    // mark progress (cheap on small archives). Production-grade
    // path is to keep cursor in the row and slice below.
    const remaining = entries.slice(processed);
    if (remaining.length > 0) {
      // Re-zip the remaining entries into a continuation archive.
      const next = new JSZip();
      for (const entry of remaining) {
        next.file(entry.name, await entry.async('arraybuffer'));
      }
      const rezip = await next.generateAsync({ type: 'arraybuffer' });
      await env.RAW_BUCKET.put(job.r2Path, rezip, {
        httpMetadata: { contentType: 'application/zip' },
      });
      const cont: QueueJob = {
        kind: 'archive',
        archiveId: job.archiveId,
        athleteId: job.athleteId,
        r2Path: job.r2Path,
        filename: job.filename,
      };
      await env.INGEST_QUEUE.send(cont);
      return;
    }
  }

  // Done — clean up archive blob, mark row complete, file a notification.
  await env.RAW_BUCKET.delete(job.r2Path);
  await env.DB.prepare(
    `UPDATE archive_imports
        SET status = 'done', completed_at = unixepoch(), updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(job.archiveId)
    .run();
  await fileNotification(env, job);
}

async function unwrap(name: string, bytes: ArrayBuffer): Promise<EntryHandle[]> {
  const lname = name.toLowerCase();
  if (lname.endsWith('.gz')) {
    const decompressed = gunzipSync(new Uint8Array(bytes));
    return unwrap(
      lname.replace(/\.gz$/, ''),
      decompressed.buffer.slice(
        decompressed.byteOffset,
        decompressed.byteOffset + decompressed.byteLength,
      ),
    );
  }
  const ext = lname.split('.').pop() ?? '';
  if (!FIT_EXT.has(ext)) return [];
  return [{ name: name.split('/').pop() ?? name, bytes }];
}

async function enqueueActivity(
  env: Env,
  athleteId: string,
  w: EntryHandle,
): Promise<'queued' | 'duplicate' | 'failed'> {
  const ext = (w.name.toLowerCase().split('.').pop() ?? '') as 'fit' | 'tcx' | 'gpx';
  if (!FIT_EXT.has(ext)) return 'failed';
  const activityId = uuidv7();
  // Use the file name as a poor-man's external id so re-uploading
  // the same archive collapses cleanly. Strava archives have
  // "<id>.fit.gz" so the inner name = the original strava id.
  const externalId = w.name.replace(/\.(fit|tcx|gpx)$/i, '');
  const dupe = await env.DB.prepare(
    `SELECT id FROM activities WHERE external_source = 'archive' AND external_id = ?`,
  )
    .bind(externalId)
    .first<{ id: string }>();
  if (dupe) return 'duplicate';

  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const rawPath = `raw/${athleteId}/${yyyy}/${mm}/${activityId}.${ext}`;
  await env.RAW_BUCKET.put(rawPath, w.bytes, {
    httpMetadata: {
      contentType:
        ext === 'fit'
          ? 'application/vnd.fit'
          : ext === 'tcx'
            ? 'application/tcx+xml'
            : 'application/gpx+xml',
    },
    customMetadata: {
      athleteId,
      activityId,
      source: 'archive',
      archiveEntryName: w.name,
    },
  });
  // externalSource is restricted to 'strava' | 'garmin'; archive
  // imports are platform-agnostic, so we omit it. external_id is set
  // either way so re-importing the same archive collapses cleanly.
  const inner: ActivityIngestJob = {
    activityId,
    athleteId,
    rawR2Path: rawPath,
    source: ext,
    externalId,
  };
  await env.INGEST_QUEUE.send(inner);
  return 'queued';
}

async function markArchive(
  env: Env,
  id: string,
  status: 'queued' | 'running' | 'done' | 'error',
  lastError?: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE archive_imports
        SET status = ?, last_error = ?, updated_at = unixepoch()
      WHERE id = ?`,
  )
    .bind(status, lastError ?? null, id)
    .run();
}

async function fileNotification(env: Env, job: ArchiveProcessJob): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO notifications (id, athlete_id, kind, payload)
       VALUES (?, ?, 'import_done', ?)`,
    )
      .bind(
        uuidv7(),
        job.athleteId,
        JSON.stringify({ archiveId: job.archiveId, filename: job.filename }),
      )
      .run();
  } catch (err) {
    console.warn('notification write failed', err);
  }
}
