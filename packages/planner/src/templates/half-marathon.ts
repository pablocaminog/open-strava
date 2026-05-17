import type { RaceTemplate } from '../types.js';

export const halfMarathonTemplate: RaceTemplate = {
  minWeeks: 8,
  taperWeeks: 1,
  recoveryEveryN: 4,
  tssStartFactor: 0.75,
  tssPeakFactor: 1.25,
  brickPhases: [],
  phases: [
    { name: 'base',  ratio: 0.38, tssRamp: 1.06, mix: { swim: 0, bike: 0, run: 1.0 } },
    { name: 'build', ratio: 0.32, tssRamp: 1.08, mix: { swim: 0, bike: 0, run: 1.0 } },
    { name: 'peak',  ratio: 0.18, tssRamp: 1.05, mix: { swim: 0, bike: 0, run: 1.0 } },
    { name: 'taper', ratio: 0.12, tssRamp: 0.60, mix: { swim: 0, bike: 0, run: 1.0 } },
  ],
};
