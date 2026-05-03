/**
 * GPX 1.1 parser.
 *
 * Reads <trk><trkseg><trkpt> nodes. Picks up extension fields from
 * Garmin TrackPointExtension v1/v2 (heart rate, cadence) and the
 * pwx-style <power> tag.
 *
 * Sport is not part of the GPX 1.1 spec proper, so we look for
 * <type> on the track element. Falls back to 'other'.
 */

import { XMLParser } from 'fast-xml-parser';
import type { ActivityRecord, Sample, Sport } from '../types.js';

interface RawTrkpt {
  '@_lat': string;
  '@_lon': string;
  ele?: string;
  time?: string;
  extensions?: unknown;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: false,
  trimValues: true,
});

export function parseGpx(xml: string): ActivityRecord {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const gpx = (doc.gpx ?? doc.GPX) as Record<string, unknown> | undefined;
  if (!gpx) throw new Error('not a GPX document');

  const tracks = arrayify(gpx.trk);
  const samples: Sample[] = [];
  let firstTime: number | undefined;
  let lastTime = 0;
  let sport: Sport = 'other';

  for (const trk of tracks) {
    const trkRec = trk as Record<string, unknown>;
    if (typeof trkRec.type === 'string') sport = mapSport(trkRec.type);

    for (const seg of arrayify(trkRec.trkseg)) {
      const segRec = seg as Record<string, unknown>;
      for (const pt of arrayify(segRec.trkpt) as RawTrkpt[]) {
        const lat = parseFloat(pt['@_lat']);
        const lng = parseFloat(pt['@_lon']);
        const timeStr = pt.time;
        if (!timeStr) continue;
        const tEpoch = Date.parse(timeStr);
        if (Number.isNaN(tEpoch)) continue;
        firstTime ??= tEpoch;
        lastTime = tEpoch;

        const sample: Sample = { t: (tEpoch - firstTime) / 1000 };
        if (Number.isFinite(lat)) sample.lat = lat;
        if (Number.isFinite(lng)) sample.lng = lng;
        if (pt.ele !== undefined) {
          const e = parseFloat(pt.ele);
          if (Number.isFinite(e)) sample.altitude = e;
        }

        const ext = collectExtensions(pt.extensions);
        if (ext.hr !== undefined) sample.hr = ext.hr;
        if (ext.cad !== undefined) sample.cadence = ext.cad;
        if (ext.power !== undefined) sample.power = ext.power;
        if (ext.temp !== undefined) sample.temperature = ext.temp;

        samples.push(sample);
      }
    }
  }

  if (samples.length === 0) throw new Error('GPX has no track points');

  const startedAt = new Date(firstTime ?? lastTime);
  const totalSeconds = (lastTime - (firstTime ?? lastTime)) / 1000;
  return {
    source: 'gpx',
    session: { sport, startedAt, totalSeconds },
    laps: [],
    samples,
  };
}

function arrayify(v: unknown): unknown[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function collectExtensions(ext: unknown): {
  hr?: number;
  cad?: number;
  power?: number;
  temp?: number;
} {
  if (!ext || typeof ext !== 'object') return {};
  const out: { hr?: number; cad?: number; power?: number; temp?: number } = {};
  // Recursive flatten — Garmin nests TrackPointExtension under namespace prefix.
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const lk = k.toLowerCase();
      if (typeof v === 'string' || typeof v === 'number') {
        const num = typeof v === 'number' ? v : parseFloat(v);
        if (!Number.isFinite(num)) continue;
        if (lk === 'hr') out.hr = num;
        else if (lk === 'cad') out.cad = num;
        else if (lk === 'power') out.power = num;
        else if (lk === 'atemp' || lk === 'temp') out.temp = num;
      } else if (typeof v === 'object') {
        visit(v);
      }
    }
  };
  visit(ext);
  return out;
}

function mapSport(raw: string): Sport {
  const v = raw.toLowerCase();
  if (v.includes('run')) return 'running';
  if (v.includes('cycl') || v.includes('bik') || v.includes('ride')) return 'cycling';
  if (v.includes('walk')) return 'walking';
  if (v.includes('hik')) return 'hiking';
  if (v.includes('swim')) return 'swimming';
  if (v.includes('row')) return 'rowing';
  if (v.includes('ski')) return 'skiing';
  return 'other';
}
