import { describe, expect, it } from 'vitest';
import { decoupling, timeInZones, trimp, type DecouplingSample, type HrSample } from '../src/hr.js';

const cfg = { hrMax: 200, hrRest: 50 }; // HRR = 150

describe('timeInZones', () => {
  it('classifies HR samples into Z1..Z5', () => {
    const samples: HrSample[] = [
      // HRR fractions: 50→0, 110→0.4 (Z1 since 0.4 < 0.5 we map to Z1 boundary), wait
      // HRR target = 50 + frac*150. frac=0.55 → hr=132.5, in Z1.
      { t: 0, hr: 132 }, // ~0.547 → Z1
      { t: 1, hr: 145 }, // ~0.633 → Z2
      { t: 2, hr: 160 }, // ~0.733 → Z3
      { t: 3, hr: 175 }, // ~0.833 → Z4
      { t: 4, hr: 190 }, // ~0.933 → Z5
      { t: 5, hr: 200 }, // 1.0 → Z5
    ];
    const out = timeInZones(samples, cfg);
    expect(out.seconds).toEqual([1, 1, 1, 1, 2]);
    expect(out.totalSeconds).toBe(6);
  });

  it('skips samples without HR', () => {
    const samples: HrSample[] = [
      { t: 0, hr: 132 },
      { t: 1, hr: null },
      { t: 2, hr: 132 },
    ];
    const out = timeInZones(samples, cfg);
    expect(out.totalSeconds).toBe(2);
  });

  it('rejects bad config', () => {
    expect(() => timeInZones([], { hrMax: 100, hrRest: 100 })).toThrow();
  });
});

describe('trimp', () => {
  it('grows monotonically with intensity for fixed duration', () => {
    const easy: HrSample[] = [];
    const hard: HrSample[] = [];
    for (let i = 0; i < 600; i++) {
      easy.push({ t: i, hr: 120 });
      hard.push({ t: i, hr: 180 });
    }
    expect(trimp(hard, cfg)).toBeGreaterThan(trimp(easy, cfg));
  });

  it('grows with duration at fixed intensity', () => {
    const short: HrSample[] = [];
    const long: HrSample[] = [];
    for (let i = 0; i < 600; i++) short.push({ t: i, hr: 150 });
    for (let i = 0; i < 1200; i++) long.push({ t: i, hr: 150 });
    expect(trimp(long, cfg)).toBeGreaterThan(trimp(short, cfg));
  });

  it('returns 0 for empty input', () => {
    expect(trimp([], cfg)).toBe(0);
  });

  it('female coefficients differ from male', () => {
    const samples: HrSample[] = [];
    for (let i = 0; i < 600; i++) samples.push({ t: i, hr: 160 });
    expect(trimp(samples, cfg, 'female')).not.toBe(trimp(samples, cfg, 'male'));
  });
});

describe('decoupling', () => {
  it('reports zero drift for a flat stream', () => {
    const samples: DecouplingSample[] = [];
    for (let i = 0; i < 100; i++) samples.push({ t: i, num: 200, hr: 150 });
    const r = decoupling(samples);
    expect(r.decouplingPercent).toBeCloseTo(0, 6);
  });

  it('detects positive drift when HR rises and num falls in second half', () => {
    const samples: DecouplingSample[] = [];
    for (let i = 0; i < 100; i++) samples.push({ t: i, num: 200, hr: 150 });
    for (let i = 100; i < 200; i++) samples.push({ t: i, num: 180, hr: 165 });
    const r = decoupling(samples);
    expect(r.decouplingPercent).toBeGreaterThan(0);
  });

  it('handles short input safely', () => {
    expect(decoupling([]).decouplingPercent).toBe(0);
    expect(decoupling([{ t: 0, num: 100, hr: 150 }]).decouplingPercent).toBe(0);
  });
});
