import type { RaceTemplate } from '../types.js';

export const template703: RaceTemplate = {
  minWeeks: 12,
  taperWeeks: 2,
  recoveryEveryN: 4,
  tssStartFactor: 0.85,
  tssPeakFactor: 1.40,
  brickPhases: ['build', 'peak', 'race-sp'],
  phases: [
    { name: 'base',    ratio: 0.33, tssRamp: 1.05, mix: { swim: 0.25, bike: 0.45, run: 0.30 } },
    { name: 'build',   ratio: 0.28, tssRamp: 1.08, mix: { swim: 0.20, bike: 0.50, run: 0.30 } },
    { name: 'peak',    ratio: 0.22, tssRamp: 1.10, mix: { swim: 0.20, bike: 0.50, run: 0.30 } },
    { name: 'race-sp', ratio: 0.06, tssRamp: 0.95, mix: { swim: 0.20, bike: 0.50, run: 0.30 } },
    { name: 'taper',   ratio: 0.11, tssRamp: 0.60, mix: { swim: 0.25, bike: 0.45, run: 0.30 } },
  ],
};
