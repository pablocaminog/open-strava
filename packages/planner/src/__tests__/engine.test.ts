import { describe, it, expect } from 'vitest';
import { buildWeekPlans } from '../engine.js';
import { TEMPLATES } from '../templates/index.js';
import type { PlanSpec } from '../types.js';

const TODAY = 1_700_000_000; // arbitrary fixed unix ts
const WEEK = 7 * 24 * 3600;

function makeSpec(raceType: PlanSpec['raceType'], weeksOut: number): PlanSpec {
  return {
    raceType,
    raceDateTs: TODAY + weeksOut * WEEK,
    todayTs: TODAY,
    ctlBaseline: 50,
    ftpW: 250,
    ftpRunPaceSec: 300,
    ftpSwimCssSec: 95,
    grid: {
      swim: { 0: { intensity: 'short' }, 2: { intensity: 'moderate' } },
      bike: { 3: { intensity: 'moderate' }, 5: { intensity: 'long' } },
      run:  { 1: { intensity: 'short' }, 4: { intensity: 'moderate' }, 5: { intensity: 'moderate' } },
    },
  };
}

describe('buildWeekPlans — 703, 16 weeks', () => {
  const spec = makeSpec('703', 16);
  const weeks = buildWeekPlans(spec, TEMPLATES['703']);

  it('returns exactly 16 week plans', () => {
    expect(weeks).toHaveLength(16);
  });

  it('week numbers are 1-based sequential', () => {
    expect(weeks.map(w => w.weekNum)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
  });

  it('week 1 TSS is near tssStartFactor × CTL', () => {
    // tssStartFactor=0.85, CTL=50 → ~42.5
    expect(weeks[0].tss).toBeGreaterThan(35);
    expect(weeks[0].tss).toBeLessThan(55);
  });

  it('last week (taper) TSS is below week 1', () => {
    expect(weeks[15].tss).toBeLessThan(weeks[0].tss);
  });

  it('last week phase is taper', () => {
    expect(weeks[15].phase).toBe('taper');
  });

  it('first week phase is base', () => {
    expect(weeks[0].phase).toBe('base');
  });

  it('sport TSS fractions sum to week TSS (within 1 TSS rounding)', () => {
    for (const w of weeks) {
      const sum = w.sportTss.swim + w.sportTss.bike + w.sportTss.run;
      expect(Math.abs(sum - w.tss)).toBeLessThan(2);
    }
  });

  it('inserts recovery week every 4 weeks', () => {
    const recoveryWeeks = weeks.filter(w => w.phase === 'recovery');
    // 16 weeks → recovery at week 4, 8, 12 (not at taper boundary)
    expect(recoveryWeeks.length).toBeGreaterThanOrEqual(2);
  });

  it('recovery week TSS is less than preceding week', () => {
    const recIdx = weeks.findIndex(w => w.phase === 'recovery');
    if (recIdx > 0) {
      expect(weeks[recIdx].tss).toBeLessThan(weeks[recIdx - 1].tss);
    }
  });
});

describe('buildWeekPlans — half-marathon, 10 weeks', () => {
  const spec = makeSpec('half-marathon', 10);
  const weeks = buildWeekPlans(spec, TEMPLATES['half-marathon']);

  it('returns 10 weeks', () => {
    expect(weeks).toHaveLength(10);
  });

  it('swim and bike TSS are always 0 for half-marathon', () => {
    for (const w of weeks) {
      expect(w.sportTss.swim).toBe(0);
      expect(w.sportTss.bike).toBe(0);
    }
  });
});

describe('buildWeekPlans — sprint, 4 weeks (minimum)', () => {
  const spec = makeSpec('sprint', 4);
  const weeks = buildWeekPlans(spec, TEMPLATES['sprint']);

  it('returns 4 weeks', () => {
    expect(weeks).toHaveLength(4);
  });

  it('last week is taper', () => {
    expect(weeks[3].phase).toBe('taper');
  });
});
