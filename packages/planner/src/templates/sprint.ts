import type { RaceTemplate } from '../types.js';

export const sprintTemplate: RaceTemplate = {
  minWeeks: 4,
  taperWeeks: 1,
  recoveryEveryN: 3,
  tssStartFactor: 0.70,
  tssPeakFactor: 1.10,
  brickPhases: [],
  phases: [
    { name: 'base',  ratio: 0.40, tssRamp: 1.06, mix: { swim: 0.30, bike: 0.40, run: 0.30 } },
    { name: 'build', ratio: 0.35, tssRamp: 1.08, mix: { swim: 0.25, bike: 0.45, run: 0.30 } },
    { name: 'peak',  ratio: 0.10, tssRamp: 1.05, mix: { swim: 0.25, bike: 0.45, run: 0.30 } },
    { name: 'taper', ratio: 0.15, tssRamp: 0.65, mix: { swim: 0.30, bike: 0.40, run: 0.30 } },
  ],
};
