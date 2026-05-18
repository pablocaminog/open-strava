import { describe, expect, it } from 'vitest';
import { processIngestJob } from '../src/pipeline/index.js';
import { computeComplianceScore } from '../src/pipeline/persist.js';
import { fakeEnv, type FakeD1, type FakeR2 } from './helpers.js';
import type { IngestJob } from '../src/env.js';

const GPX = `<?xml version="1.0"?>
<gpx version="1.1"><trk><type>cycling</type><trkseg>
<trkpt lat="40.0" lon="-74.0"><ele>10</ele><time>2026-05-03T07:00:00Z</time>
  <extensions><power>200</power><gpxtpx:TrackPointExtension xmlns:gpxtpx="x"><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>
</trkpt>
<trkpt lat="40.0001" lon="-74.0001"><ele>11</ele><time>2026-05-03T07:00:01Z</time>
  <extensions><power>210</power></extensions>
</trkpt>
</trkseg></trk></gpx>`;

async function withRawObject(env: ReturnType<typeof fakeEnv>, key: string, contents: string) {
  await env.RAW_BUCKET.put(key, new TextEncoder().encode(contents));
}

function seedUser(env: ReturnType<typeof fakeEnv>, id: string, ftp: number) {
  const db = env.DB as unknown as FakeD1;
  db.users.push({ id, handle: 'a', email: 'a@b', displayName: null, ftp, hrMax: 200, hrRest: 50 });
}

describe('processIngestJob', () => {
  it('parses, computes metrics, and persists an activity row', async () => {
    const env = fakeEnv();
    seedUser(env, 'u1', 250);
    const job: IngestJob = {
      activityId: 'a1',
      athleteId: 'u1',
      rawR2Path: 'raw/u1/2026/05/a1.gpx',
      source: 'gpx',
    };
    await withRawObject(env, job.rawR2Path, GPX);

    await processIngestJob(env, job);

    const db = env.DB as unknown as FakeD1;
    expect(db.activities).toHaveLength(1);
    const row = db.activities[0]!;
    expect(row.id).toBe('a1');
    expect(row.athlete_id).toBe('u1');
    expect(row.sport).toBe('cycling');
    expect(typeof row.power_avg).toBe('number');

    const parsed = (env.PARSED_BUCKET as unknown as FakeR2).store.get('parsed/u1/a1.json');
    expect(parsed).toBeDefined();
  });

  it('is idempotent — replaying does not duplicate rows', async () => {
    const env = fakeEnv();
    seedUser(env, 'u1', 250);
    const job: IngestJob = {
      activityId: 'a2',
      athleteId: 'u1',
      rawR2Path: 'raw/u1/2026/05/a2.gpx',
      source: 'gpx',
    };
    await withRawObject(env, job.rawR2Path, GPX);
    await processIngestJob(env, job);
    await processIngestJob(env, job);
    const db = env.DB as unknown as FakeD1;
    expect(db.activities).toHaveLength(1);
  });

  it('throws when the raw object is missing', async () => {
    const env = fakeEnv();
    seedUser(env, 'u1', 250);
    const job: IngestJob = {
      activityId: 'a3',
      athleteId: 'u1',
      rawR2Path: 'raw/u1/missing.gpx',
      source: 'gpx',
    };
    await expect(processIngestJob(env, job)).rejects.toThrow(/raw object missing/);
  });

  it('still persists when the athlete has no FTP — power metrics skipped, hrTSS may estimate', async () => {
    const env = fakeEnv();
    (env.DB as unknown as FakeD1).users.push({
      id: 'u2',
      handle: 'b',
      email: 'b@b',
      displayName: null,
    });
    const job: IngestJob = {
      activityId: 'a4',
      athleteId: 'u2',
      rawR2Path: 'raw/u2/2026/05/a4.gpx',
      source: 'gpx',
    };
    await withRawObject(env, job.rawR2Path, GPX);
    await processIngestJob(env, job);
    const db = env.DB as unknown as FakeD1;
    expect(db.activities).toHaveLength(1);
    // np stays null (no power stream), but tss may be a non-zero
    // hrTSS estimate when HR is present in the fixture and the
    // population-default HRmax/HRrest fallback fires.
    expect(db.activities[0]!.np).toBeNull();
  });
});

describe('computeComplianceScore', () => {
  it('returns green (≥0.95) when actual power is within 5% of target', () => {
    const stepsJson = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'watts', low: 170, high: 170 } }],
    });
    // 165W vs 170W target = 165/170 ≈ 0.97, with dur matching 1.0 → 0.5*1.0 + 0.5*0.97 ≈ 0.985
    const score = computeComplianceScore(1800, 1800, stepsJson, 165, null);
    expect(score).toBeGreaterThanOrEqual(0.95);
  });

  it('returns yellow (0.85-0.95) when actual power is ~10% below target', () => {
    const stepsJson = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'watts', low: 200, high: 200 } }],
    });
    // 180W vs 200W = 0.9, dur matches → 0.5*1.0 + 0.5*0.9 = 0.95 → border; use more gap
    const score = computeComplianceScore(1800, 1800, stepsJson, 178, null); // ~11% below
    expect(score).toBeGreaterThanOrEqual(0.85);
    expect(score).toBeLessThan(0.95);
  });

  it('returns red (<0.85) when actual power is ~30% below target', () => {
    const stepsJson = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'watts', low: 200, high: 200 } }],
    });
    // 140W vs 200W = 0.70 intensity score → 0.5*1.0 + 0.5*0.70 = 0.85, need strictly below
    // use 138W: 138/200 = 0.69 → 0.5 + 0.5*0.69 = 0.845
    const score = computeComplianceScore(1800, 1800, stepsJson, 138, null); // ~31% below
    expect(score).toBeLessThan(0.85);
  });

  it('falls back to duration-only when no watts targets and no TSS', () => {
    const stepsJson = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800 }],
    });
    const score = computeComplianceScore(1800, 1800, stepsJson, null, null);
    expect(score).toBeCloseTo(1.0, 2);
  });

  it('uses TSS fallback when ftp_pct targets but no powerAvg', () => {
    const stepsJson = JSON.stringify({
      steps: [{ kind: 'work', durationSec: 1800, target: { type: 'ftp_pct', low: 90, high: 100 } }],
    });
    // TSS estimate will be computable; actual TSS near it = high score
    const score = computeComplianceScore(1800, 1800, stepsJson, null, 50);
    // 0.5 * 1.0 (dur) + 0.5 * tssRatio (close to 1 if TSS matches estimate)
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});
