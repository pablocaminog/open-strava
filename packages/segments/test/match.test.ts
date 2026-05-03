import { describe, expect, it } from 'vitest';
import { findSegmentEfforts, type ActivityPoint, type Segment } from '../src/match.js';

/** Build a straight-line activity from start (lat0,lng0) heading east at ~5 m/s. */
function lineActivity(start: { lat: number; lng: number }, lengthMeters: number): ActivityPoint[] {
  // ~111,320 m per degree of latitude; cosLat at start
  const cosLat = Math.cos((start.lat * Math.PI) / 180);
  const points: ActivityPoint[] = [];
  for (let m = 0; m <= lengthMeters; m += 5) {
    const dLng = m / (111_320 * cosLat);
    points.push({ t: m / 5, lat: start.lat, lng: start.lng + dLng });
  }
  return points;
}

describe('findSegmentEfforts', () => {
  it('finds an effort when the segment overlaps a portion of the activity', () => {
    const activity = lineActivity({ lat: 40, lng: -74 }, 1000);
    const segStart = activity[40]!; // 200 m in
    const segEnd = activity[100]!; // 500 m in
    const seg: Segment = {
      id: 'seg1',
      polyline: activity.slice(40, 101).map((p) => ({ lat: p.lat, lng: p.lng })),
    };

    const efforts = findSegmentEfforts(activity, [seg]);
    expect(efforts).toHaveLength(1);
    const e = efforts[0]!;
    expect(e.segmentId).toBe('seg1');
    expect(e.startSeconds).toBeCloseTo(segStart.t, 1);
    expect(e.endSeconds).toBeCloseTo(segEnd.t, 1);
    expect(e.errorMeters).toBeLessThan(5);
  });

  it('rejects a segment whose bbox is far away', () => {
    const activity = lineActivity({ lat: 40, lng: -74 }, 500);
    const farSeg: Segment = {
      id: 'far',
      polyline: [
        { lat: 50, lng: 10 },
        { lat: 50.001, lng: 10.001 },
      ],
    };
    expect(findSegmentEfforts(activity, [farSeg])).toHaveLength(0);
  });

  it('rejects a segment that overlaps only at the start gate', () => {
    const activity = lineActivity({ lat: 40, lng: -74 }, 500);
    // Segment shares the start point but heads north (perpendicular)
    const seg: Segment = {
      id: 'wrongDir',
      polyline: [
        { lat: 40, lng: -74 },
        { lat: 40.001, lng: -74 },
        { lat: 40.002, lng: -74 },
      ],
    };
    expect(findSegmentEfforts(activity, [seg])).toHaveLength(0);
  });

  it('returns no effort when activity has too few points', () => {
    expect(findSegmentEfforts([], [])).toEqual([]);
  });
});
