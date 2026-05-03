import { describe, expect, it } from 'vitest';
import { bboxOf, bboxesOverlap, haversine } from '../src/geo.js';

describe('haversine', () => {
  it('returns 0 for identical points', () => {
    expect(haversine({ lat: 40, lng: -74 }, { lat: 40, lng: -74 })).toBe(0);
  });

  it('approx 111.32 km per degree of latitude', () => {
    const d = haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });

  it('matches a known value (NYC ↔ LA, ~3936 km)', () => {
    const d = haversine({ lat: 40.7128, lng: -74.006 }, { lat: 34.0522, lng: -118.2437 });
    expect(d / 1000).toBeGreaterThan(3900);
    expect(d / 1000).toBeLessThan(4000);
  });
});

describe('bboxOf / bboxesOverlap', () => {
  it('builds a tight bbox', () => {
    const b = bboxOf([
      { lat: 40, lng: -74 },
      { lat: 41, lng: -73 },
      { lat: 40.5, lng: -73.5 },
    ]);
    expect(b).toEqual({ minLat: 40, minLng: -74, maxLat: 41, maxLng: -73 });
  });

  it('detects disjoint bboxes', () => {
    const a = { minLat: 40, minLng: -74, maxLat: 41, maxLng: -73 };
    const b = { minLat: 50, minLng: -10, maxLat: 51, maxLng: -9 };
    expect(bboxesOverlap(a, b)).toBe(false);
  });

  it('returns true for overlapping bboxes', () => {
    const a = { minLat: 40, minLng: -74, maxLat: 41, maxLng: -73 };
    const b = { minLat: 40.5, minLng: -73.5, maxLat: 42, maxLng: -72 };
    expect(bboxesOverlap(a, b)).toBe(true);
  });

  it('pads correctly so near-misses count', () => {
    const a = { minLat: 40, minLng: -74, maxLat: 40.001, maxLng: -73.999 };
    const b = { minLat: 40.002, minLng: -73.999, maxLat: 40.003, maxLng: -73.998 };
    expect(bboxesOverlap(a, b, 0)).toBe(false);
    expect(bboxesOverlap(a, b, 500)).toBe(true);
  });
});
