/**
 * TCX (Garmin Training Center XML) parser.
 *
 * Reads <Activity Sport="..."><Lap StartTime="..."><Track><Trackpoint>.
 * Picks up the Garmin TPX <Extensions> element for Watts and Speed.
 */

import { XMLParser } from 'fast-xml-parser';
import type { ActivityRecord, Lap, Sample, Sport } from '../types.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
});

export function parseTcx(xml: string): ActivityRecord {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const tcd = (doc.TrainingCenterDatabase ?? doc.trainingcenterdatabase) as
    | Record<string, unknown>
    | undefined;
  if (!tcd) throw new Error('not a TCX document');

  const activities = (tcd.Activities ?? tcd.activities) as Record<string, unknown> | undefined;
  if (!activities) throw new Error('TCX missing Activities');

  const activityNodes = arrayify(activities.Activity);
  if (activityNodes.length === 0) throw new Error('TCX has no Activity');

  const activity = activityNodes[0] as Record<string, unknown>;
  const sport = mapSport(typeof activity['@_Sport'] === 'string' ? activity['@_Sport'] : '');

  const laps: Lap[] = [];
  const samples: Sample[] = [];
  let firstTime: number | undefined;
  let lastTime = 0;

  for (const lapNode of arrayify(activity.Lap)) {
    const lapRec = lapNode as Record<string, unknown>;
    const startStr = typeof lapRec['@_StartTime'] === 'string' ? lapRec['@_StartTime'] : undefined;
    const lap: Lap = {
      startedAt: startStr ? new Date(startStr) : new Date(0),
      totalSeconds: numNode(lapRec.TotalTimeSeconds) ?? 0,
    };
    const dist = numNode(lapRec.DistanceMeters);
    const aHr = numNode((lapRec.AverageHeartRateBpm as Record<string, unknown> | undefined)?.Value);
    const mHr = numNode((lapRec.MaximumHeartRateBpm as Record<string, unknown> | undefined)?.Value);
    const cal = numNode(lapRec.Calories);
    const mSpd = numNode(lapRec.MaximumSpeed);
    if (dist !== undefined) lap.totalDistance = dist;
    if (aHr !== undefined) lap.avgHr = aHr;
    if (mHr !== undefined) lap.maxHr = mHr;
    if (cal !== undefined) {
      // Calories live on lap; we surface them via session totals only.
      void cal;
    }
    if (mSpd !== undefined) lap.maxSpeed = mSpd;
    laps.push(lap);

    const tracks = arrayify(lapRec.Track);
    for (const track of tracks) {
      const trackRec = track as Record<string, unknown>;
      for (const tp of arrayify(trackRec.Trackpoint)) {
        const tpRec = tp as Record<string, unknown>;
        const timeStr = typeof tpRec.Time === 'string' ? tpRec.Time : undefined;
        if (!timeStr) continue;
        const tEpoch = Date.parse(timeStr);
        if (Number.isNaN(tEpoch)) continue;
        firstTime ??= tEpoch;
        lastTime = tEpoch;

        const sample: Sample = { t: (tEpoch - firstTime) / 1000 };
        const pos = tpRec.Position as Record<string, unknown> | undefined;
        if (pos) {
          const lat = numNode(pos.LatitudeDegrees);
          const lng = numNode(pos.LongitudeDegrees);
          if (lat !== undefined) sample.lat = lat;
          if (lng !== undefined) sample.lng = lng;
        }
        const alt = numNode(tpRec.AltitudeMeters);
        if (alt !== undefined) sample.altitude = alt;
        const dist2 = numNode(tpRec.DistanceMeters);
        if (dist2 !== undefined) sample.distance = dist2;
        const hr = numNode((tpRec.HeartRateBpm as Record<string, unknown> | undefined)?.Value);
        if (hr !== undefined) sample.hr = hr;
        const cad = numNode(tpRec.Cadence);
        if (cad !== undefined) sample.cadence = cad;

        const ext = tpRec.Extensions as Record<string, unknown> | undefined;
        if (ext) {
          const tpx = (ext.TPX ?? ext.tpx) as Record<string, unknown> | undefined;
          if (tpx) {
            const watts = numNode(tpx.Watts);
            if (watts !== undefined) sample.power = watts;
            const speed = numNode(tpx.Speed);
            if (speed !== undefined) sample.speed = speed;
            const cad2 = numNode(tpx.RunCadence);
            if (cad2 !== undefined && sample.cadence === undefined) sample.cadence = cad2;
          }
        }
        samples.push(sample);
      }
    }
  }

  if (samples.length === 0) throw new Error('TCX has no Trackpoints');

  const startedAt = new Date(firstTime ?? lastTime);
  const totalSeconds = (lastTime - (firstTime ?? lastTime)) / 1000;
  return {
    source: 'tcx',
    session: { sport, startedAt, totalSeconds },
    laps,
    samples,
  };
}

function arrayify(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function numNode(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function mapSport(raw: string): Sport {
  const v = raw.toLowerCase();
  if (v === 'running') return 'running';
  if (v === 'biking') return 'cycling';
  if (v === 'swimming') return 'swimming';
  return 'other';
}
