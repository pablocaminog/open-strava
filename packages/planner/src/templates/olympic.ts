import type { RaceTemplate } from '../types.js';

export const olympicTemplate: RaceTemplate = {
  minWeeks: 8,
  taperWeeks: 1,
  recoveryEveryN: 4,
  tssStartFactor: 0.75,
  tssPeakFactor: 1.20,
  brickPhases: ['build', 'peak'],
  phases: [
    { name: 'base',  ratio: 0.38, tssRamp: 1.05, mix: { swim: 0.28, bike: 0.42, run: 0.30 } },
    { name: 'build', ratio: 0.32, tssRamp: 1.08, mix: { swim: 0.22, bike: 0.48, run: 0.30 } },
    { name: 'peak',  ratio: 0.18, tssRamp: 1.08, mix: { swim: 0.22, bike: 0.48, run: 0.30 } },
    { name: 'taper', ratio: 0.12, tssRamp: 0.62, mix: { swim: 0.28, bike: 0.42, run: 0.30 } },
  ],
};
