/**
 * Segment effort detection.
 *
 * Pipeline:
 *   1. bbox prefilter — drop segments whose bbox doesn't overlap the
 *      activity bbox (padded by `bboxPadMeters`).
 *   2. start/end gate — for every activity sample within
 *      `gateRadiusMeters` of the segment's first point ("start gate"),
 *      pair with every later activity sample within range of the
 *      segment's last point ("end gate"). Each pair is a candidate effort.
 *   3. DTW validation — for each candidate, run DTW between the
 *      activity subsequence and the segment polyline. If
 *      `dtw.cost <= maxAvgErrorMeters`, accept the candidate. Among
 *      accepted candidates for the same segment, keep the one with the
 *      lowest mean error.
 *
 * Output rows are stable: same input → same effort list.
 */

import { bboxOf, bboxesOverlap, haversine, type LatLng } from './geo.js';
import { dtw } from './dtw.js';

export interface ActivityPoint extends LatLng {
  /** Seconds since activity start. */
  t: number;
}

export interface Segment {
  id: string;
  polyline: LatLng[];
}

export interface MatchOptions {
  /** Radius around segment start/end points to count as a gate hit. Default 25 m. */
  gateRadiusMeters?: number;
  /** Bbox prefilter pad. Default 50 m. */
  bboxPadMeters?: number;
  /** Maximum acceptable mean DTW per-pair distance. Default 30 m. */
  maxAvgErrorMeters?: number;
}

export interface SegmentEffort {
  segmentId: string;
  /** Indices into the activity sample array. */
  startIndex: number;
  endIndex: number;
  /** Activity time at start/end (seconds). */
  startSeconds: number;
  endSeconds: number;
  /** Mean per-pair haversine error along the DTW alignment. */
  errorMeters: number;
}

export function findSegmentEfforts(
  activity: ActivityPoint[],
  segments: Segment[],
  options: MatchOptions = {},
): SegmentEffort[] {
  const gate = options.gateRadiusMeters ?? 25;
  const bboxPad = options.bboxPadMeters ?? 50;
  const maxErr = options.maxAvgErrorMeters ?? 30;

  if (activity.length < 2) return [];
  const aBbox = bboxOf(activity);

  const out: SegmentEffort[] = [];
  for (const seg of segments) {
    if (seg.polyline.length < 2) continue;
    const segBbox = bboxOf(seg.polyline);
    if (!bboxesOverlap(aBbox, segBbox, bboxPad)) continue;

    const start = seg.polyline[0]!;
    const end = seg.polyline[seg.polyline.length - 1]!;
    const startHits: number[] = [];
    const endHits: number[] = [];
    for (let i = 0; i < activity.length; i++) {
      const p = activity[i]!;
      if (haversine(p, start) <= gate) startHits.push(i);
      if (haversine(p, end) <= gate) endHits.push(i);
    }

    let best: SegmentEffort | undefined;
    for (const sIdx of startHits) {
      for (const eIdx of endHits) {
        if (eIdx <= sIdx + 1) continue;
        const sub = activity.slice(sIdx, eIdx + 1);
        const m = dtw(sub, seg.polyline);
        if (!Number.isFinite(m.cost) || m.cost > maxErr) continue;
        if (!best || m.cost < best.errorMeters) {
          best = {
            segmentId: seg.id,
            startIndex: sIdx,
            endIndex: eIdx,
            startSeconds: activity[sIdx]!.t,
            endSeconds: activity[eIdx]!.t,
            errorMeters: m.cost,
          };
        }
      }
    }
    if (best) out.push(best);
  }
  return out;
}
