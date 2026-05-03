import { describe, expect, it } from 'vitest';
import {
  gradeAdjustedSpeed,
  minettiCost,
  normalizedGradedPace,
  paceMetrics,
  type PaceSample,
} from '../src/pace.js';

describe('minettiCost', () => {
  it('returns flat cost (3.6) at zero grade', () => {
    expect(minettiCost(0)).toBeCloseTo(3.6, 6);
  });

  it('rises monotonically up to a steep grade', () => {
    expect(minettiCost(0.1)).toBeGreaterThan(minettiCost(0));
    expect(minettiCost(0.2)).toBeGreaterThan(minettiCost(0.1));
  });

  it('clamps absurd grades to ±45%', () => {
    expect(minettiCost(0.9)).toBe(minettiCost(0.45));
    expect(minettiCost(-0.9)).toBe(minettiCost(-0.45));
  });
});

describe('gradeAdjustedSpeed', () => {
  it('equals raw speed on flat ground', () => {
    expect(gradeAdjustedSpeed(3.0, 0)).toBeCloseTo(3.0, 6);
  });

  it('reports flat-equivalent faster on uphill (you ran harder than the speed shows)', () => {
    const adj = gradeAdjustedSpeed(3.0, 0.1);
    expect(adj).toBeGreaterThan(3.0);
  });

  it('reports flat-equivalent slower on downhill', () => {
    const adj = gradeAdjustedSpeed(3.0, -0.05);
    expect(adj).toBeLessThan(3.0);
  });

  it('returns 0 for non-positive speed', () => {
    expect(gradeAdjustedSpeed(0, 0.1)).toBe(0);
    expect(gradeAdjustedSpeed(-1, 0.1)).toBe(0);
  });
});

describe('normalizedGradedPace', () => {
  it('returns 0 when stream shorter than window', () => {
    expect(normalizedGradedPace([3, 3, 3])).toBe(0);
  });

  it('matches the constant value for a flat stream', () => {
    const stream = new Array(120).fill(3.0);
    expect(normalizedGradedPace(stream)).toBeCloseTo(3.0, 6);
  });

  it('exceeds avg for a variable stream', () => {
    const stream = [...new Array(60).fill(2.0), ...new Array(60).fill(4.0)];
    const ngp = normalizedGradedPace(stream);
    const avg = stream.reduce((a, b) => a + b, 0) / stream.length;
    expect(ngp).toBeGreaterThan(avg);
  });
});

describe('paceMetrics', () => {
  it('computes IF and rTSS for a flat constant run', () => {
    const samples: PaceSample[] = [];
    for (let i = 0; i < 3600; i++) samples.push({ t: i, speed: 3.0, grade: 0 });
    // Threshold pace = 4 m/s → IF = 0.75, rTSS for 1h ≈ 56.25
    const m = paceMetrics(samples, 4.0);
    expect(m.durationSeconds).toBe(3600);
    expect(m.avgSpeedMs).toBeCloseTo(3.0, 6);
    expect(m.ngpSpeedMs).toBeCloseTo(3.0, 5);
    expect(m.intensityFactor).toBeCloseTo(0.75, 5);
    expect(m.rTSS).toBeCloseTo(56.25, 4);
  });

  it('rejects bad threshold', () => {
    expect(() => paceMetrics([], 0)).toThrow();
    expect(() => paceMetrics([], -1)).toThrow();
  });

  it('handles empty input', () => {
    const m = paceMetrics([], 4.0);
    expect(m.rTSS).toBe(0);
  });
});
