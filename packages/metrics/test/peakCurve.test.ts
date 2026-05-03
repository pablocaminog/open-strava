import { describe, expect, it } from 'vitest';
import { DEFAULT_PEAK_WINDOWS, peakCurve } from '../src/peakCurve.js';

describe('peakCurve', () => {
  it('returns 0 for windows longer than the stream', () => {
    const out = peakCurve([100, 100, 100], [10]);
    expect(out[0]).toEqual({ duration: 10, peakValue: 0 });
  });

  it('finds the best window in a single pass', () => {
    // Stream: 60s @ 100W, then 60s @ 300W
    const stream = [...new Array(60).fill(100), ...new Array(60).fill(300)];
    const out = peakCurve(stream, [60]);
    expect(out[0]?.peakValue).toBeCloseTo(300, 6);
  });

  it('produces a monotonically non-increasing curve for the default windows on a flat stream', () => {
    const stream = new Array(7200).fill(200);
    const out = peakCurve(stream);
    for (const p of out) expect(p.peakValue).toBeCloseTo(200, 6);
    expect(out.map((p) => p.duration)).toEqual([...DEFAULT_PEAK_WINDOWS]);
  });

  it('shorter windows can have higher peak than longer windows on a spiky stream', () => {
    const stream = new Array(3600).fill(150);
    // Insert a 5-second 1000W spike
    for (let i = 100; i < 105; i++) stream[i] = 1000;
    const out = peakCurve(stream, [5, 60, 300]);
    expect(out[0]!.peakValue).toBeGreaterThan(out[1]!.peakValue);
    expect(out[1]!.peakValue).toBeGreaterThan(out[2]!.peakValue);
  });

  it('handles zero-duration entries safely', () => {
    expect(peakCurve([1, 2, 3], [0])[0]).toEqual({ duration: 0, peakValue: 0 });
  });
});
