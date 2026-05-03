import { describe, expect, it } from 'vitest';
import { normalizedPower, powerMetrics, type PowerSample } from '../src/power.js';

describe('normalizedPower', () => {
  it('returns 0 for streams shorter than the rolling window', () => {
    expect(normalizedPower([100, 100, 100])).toBe(0);
  });

  it('equals avg power for a constant stream (long enough)', () => {
    const stream = new Array(120).fill(200);
    expect(normalizedPower(stream)).toBeCloseTo(200, 6);
  });

  it('exceeds avg power when the stream is variable (4th-power weighting)', () => {
    const half = new Array(60).fill(100);
    const otherHalf = new Array(60).fill(300);
    const stream = [...half, ...otherHalf];
    const np = normalizedPower(stream);
    const avg = stream.reduce((a, b) => a + b, 0) / stream.length;
    expect(np).toBeGreaterThan(avg);
  });
});

describe('powerMetrics', () => {
  function build1Hz(power: number[]): PowerSample[] {
    return power.map((p, i) => ({ t: i, p }));
  }

  it('computes IF/TSS/VI for a constant stream', () => {
    const samples = build1Hz(new Array(3600).fill(200));
    const m = powerMetrics(samples, 250);
    expect(m.durationSeconds).toBe(3600);
    expect(m.avgPower).toBe(200);
    expect(m.maxPower).toBe(200);
    // NP ≈ avg for constant stream
    expect(m.normalizedPower).toBeCloseTo(200, 5);
    expect(m.intensityFactor).toBeCloseTo(0.8, 5);
    // TSS for 1h at IF 0.8 = 64
    expect(m.trainingStressScore).toBeCloseTo(64, 4);
    expect(m.variabilityIndex).toBeCloseTo(1, 5);
    // 200W * 3600s = 720,000 J = 720 kJ
    expect(m.workKilojoules).toBeCloseTo(720, 5);
  });

  it('rejects non-positive FTP', () => {
    expect(() => powerMetrics([], 0)).toThrow();
    expect(() => powerMetrics([], -1)).toThrow();
  });

  it('returns zeros for an empty stream', () => {
    const m = powerMetrics([], 250);
    expect(m.durationSeconds).toBe(0);
    expect(m.normalizedPower).toBe(0);
    expect(m.trainingStressScore).toBe(0);
  });

  it('clamps negative power and treats null as zero', () => {
    const samples: PowerSample[] = [];
    for (let i = 0; i < 60; i++) samples.push({ t: i, p: 100 });
    samples.push({ t: 60, p: null }, { t: 61, p: -50 }, { t: 62, p: 100 });
    const m = powerMetrics(samples, 250);
    expect(m.maxPower).toBe(100);
  });
});
