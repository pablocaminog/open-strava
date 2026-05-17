import type { RaceTemplate } from '../types.js';

export const fullTemplate: RaceTemplate = {
  minWeeks: 16,
  taperWeeks: 2,
  recoveryEveryN: 4,
  tssStartFactor: 0.80,
  tssPeakFactor: 1.60,
  brickPhases: ['build', 'peak', 'race-sp'],
  phases: [
    { name: 'base',    ratio: 0.30, tssRamp: 1.05, mix: { swim: 0.22, bike: 0.50, run: 0.28 } },
    { name: 'build',   ratio: 0.28, tssRamp: 1.08, mix: { swim: 0.18, bike: 0.55, run: 0.27 } },
    { name: 'peak',    ratio: 0.24, tssRamp: 1.08, mix: { swim: 0.18, bike: 0.55, run: 0.27 } },
    { name: 'race-sp', ratio: 0.05, tssRamp: 0.92, mix: { swim: 0.18, bike: 0.55, run: 0.27 } },
    { name: 'taper',   ratio: 0.13, tssRamp: 0.55, mix: { swim: 0.22, bike: 0.50, run: 0.28 } },
  ],
};
