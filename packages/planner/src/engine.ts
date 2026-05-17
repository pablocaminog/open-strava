import type { PlanSpec, RaceTemplate, WeekPlan, Phase } from './types.js';

const WEEK_SEC = 7 * 24 * 3600;

export function buildWeekPlans(spec: PlanSpec, template: RaceTemplate): WeekPlan[] {
  const totalWeeks = Math.max(
    template.minWeeks,
    Math.round((spec.raceDateTs - spec.todayTs) / WEEK_SEC),
  );

  // Assign phase to each week slot
  const phaseSequence = assignPhases(template, totalWeeks);

  // Compute TSS per week
  const ctlBase = spec.ctlBaseline > 0 ? spec.ctlBaseline : 40;
  const tssStart = ctlBase * template.tssStartFactor;
  const tssPeak  = ctlBase * template.tssPeakFactor;
  const buildWeeks = phaseSequence.filter(p => p !== 'recovery' && p !== 'taper').length;

  const weeks: WeekPlan[] = [];
  let buildIdx = 0;

  for (let i = 0; i < totalWeeks; i++) {
    const phase = phaseSequence[i];
    let tss: number;

    if (phase === 'recovery') {
      // Use 65% of previous week's TSS
      tss = weeks.length > 0 ? weeks[weeks.length - 1].tss * 0.65 : tssStart * 0.65;
    } else if (phase === 'taper') {
      // Linear ramp down from 70% to 40% of peak over taper weeks
      const taperIdx = i - (totalWeeks - template.taperWeeks);
      const fraction = 0.70 - taperIdx * (0.30 / Math.max(template.taperWeeks - 1, 1));
      tss = tssPeak * Math.max(fraction, 0.35);
      // NOTE: do NOT increment buildIdx here — taper TSS is based on tssPeak, not the ramp
    } else {
      // Progressive ramp from tssStart to tssPeak across non-recovery, non-taper weeks
      const t = buildWeeks > 1 ? buildIdx / (buildWeeks - 1) : 0;
      tss = tssStart + (tssPeak - tssStart) * t;
      buildIdx++;
    }

    tss = Math.round(tss);
    const mix = getCurrentMix(template, phase);

    weeks.push({
      weekNum: i + 1,
      phase,
      tss,
      sportTss: {
        swim: Math.round(tss * mix.swim),
        bike: Math.round(tss * mix.bike),
        run:  tss - Math.round(tss * mix.swim) - Math.round(tss * mix.bike),
      },
    });
  }

  return weeks;
}

function assignPhases(template: RaceTemplate, totalWeeks: number): Phase[] {
  const result: Phase[] = [];
  // Taper always occupies the last taperWeeks
  const buildableWeeks = totalWeeks - template.taperWeeks;

  // Expand non-taper phases proportionally
  const nonTaper = template.phases.filter(p => p.name !== 'taper');
  const nonTaperTotal = nonTaper.reduce((s, p) => s + p.ratio, 0);

  let slot = 0;
  for (const phaseConfig of nonTaper) {
    const weeks = Math.round((phaseConfig.ratio / nonTaperTotal) * buildableWeeks);
    for (let w = 0; w < weeks && slot < buildableWeeks; w++, slot++) {
      // Insert recovery week every recoveryEveryN weeks
      if (slot > 0 && slot % template.recoveryEveryN === (template.recoveryEveryN - 1)) {
        result.push('recovery');
      } else {
        result.push(phaseConfig.name as Phase);
      }
    }
  }

  // Fill any rounding remainder with last non-taper phase
  while (result.length < buildableWeeks) {
    result.push(nonTaper[nonTaper.length - 1].name as Phase);
  }

  // Append taper weeks
  for (let t = 0; t < template.taperWeeks; t++) {
    result.push('taper');
  }

  return result.slice(0, totalWeeks);
}

function getCurrentMix(template: RaceTemplate, phase: Phase) {
  const p = template.phases.find(ph => ph.name === phase);
  if (p) return p.mix;
  // recovery/taper fall back to first phase mix
  return template.phases[0].mix;
}
