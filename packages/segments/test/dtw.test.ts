import { describe, expect, it } from 'vitest';
import { dtw } from '../src/dtw.js';

describe('dtw', () => {
  it('returns 0 for identical polylines', () => {
    const p = [
      { lat: 40, lng: -74 },
      { lat: 40.001, lng: -74 },
      { lat: 40.002, lng: -74 },
    ];
    const r = dtw(p, p);
    expect(r.cost).toBeCloseTo(0, 6);
  });

  it('returns small cost for an offset-by-1 alignment', () => {
    const a = [
      { lat: 40, lng: -74 },
      { lat: 40.001, lng: -74 },
      { lat: 40.002, lng: -74 },
      { lat: 40.003, lng: -74 },
    ];
    const b = [
      { lat: 40.001, lng: -74 },
      { lat: 40.002, lng: -74 },
      { lat: 40.003, lng: -74 },
    ];
    const r = dtw(a, b);
    expect(r.cost).toBeLessThan(150);
  });

  it('handles empty polylines safely', () => {
    expect(dtw([], []).cost).toBe(0);
    expect(dtw([{ lat: 0, lng: 0 }], []).cost).toBe(0);
  });
});
