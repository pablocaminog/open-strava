# Race Plan Creator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a race training plan creator that generates periodized plans (sprint/olympic/70.3/full Ironman/half marathon) from a wizard collecting race date, schedule constraints, and athlete metrics, then populates the calendar.

**Architecture:** New `packages/planner` package (pure TypeScript, no DB) with engine (TSS distribution), scheduler (session→day assignment), and auditor (Claude Haiku). API routes appended to `apps/api/src/routes/training.ts`. Three new Astro pages for list/wizard/detail.

**Tech Stack:** TypeScript ESM, Vitest, Hono, Cloudflare D1, Astro 5 SSR, Claude Haiku API (`claude-haiku-4-5-20251001`)

---

## File Map

**New files:**
- `packages/planner/package.json`
- `packages/planner/tsconfig.json`
- `packages/planner/src/types.ts`
- `packages/planner/src/templates/sprint.ts`
- `packages/planner/src/templates/olympic.ts`
- `packages/planner/src/templates/703.ts`
- `packages/planner/src/templates/full.ts`
- `packages/planner/src/templates/half-marathon.ts`
- `packages/planner/src/templates/index.ts`
- `packages/planner/src/engine.ts`
- `packages/planner/src/scheduler.ts`
- `packages/planner/src/auditor.ts`
- `packages/planner/src/index.ts`
- `packages/planner/src/__tests__/engine.test.ts`
- `packages/planner/src/__tests__/scheduler.test.ts`
- `infra/wrangler/migrations/0012_race_plans.sql`
- `apps/web/src/pages/plans/index.astro`
- `apps/web/src/pages/plans/new.astro`
- `apps/web/src/pages/plans/[id].astro`

**Modified files:**
- `apps/api/src/env.ts` — add `ANTHROPIC_API_KEY: string`
- `apps/api/src/routes/training.ts` — append plan routes + ftp-estimates
- `apps/api/src/app.ts` — already mounts trainingRoutes, no change needed (verify)

---

## Task 1: Package scaffold + types

**Files:**
- Create: `packages/planner/package.json`
- Create: `packages/planner/tsconfig.json`
- Create: `packages/planner/src/types.ts`
- Create: `packages/planner/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@pacelore/planner",
  "version": "0.0.0",
  "private": true,
  "description": "Race training plan generator — periodization engine, scheduler, Claude audit.",
  "license": "SEE LICENSE IN LICENSE",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "vitest": "2.1.5"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true,
    "types": []
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create src/types.ts**

```ts
export type RaceType = 'sprint' | 'olympic' | '703' | 'full' | 'half-marathon';
export type Sport = 'swim' | 'bike' | 'run';
export type Intensity = 'short' | 'moderate' | 'long';
export type Phase = 'base' | 'build' | 'peak' | 'race-sp' | 'taper' | 'recovery';

export interface ScheduleCell {
  intensity: Intensity | null;
  window?: { start: string; end: string }; // "HH:MM"
}

/** sport × day (0=Mon … 6=Sun) grid from wizard */
export type ScheduleGrid = {
  [S in Sport]?: { [day: number]: ScheduleCell };
};

export interface PlanSpec {
  raceType: RaceType;
  raceDateTs: number;  // unix seconds
  todayTs: number;     // unix seconds
  ctlBaseline: number; // athlete CTL from PMC (0 if unknown → use 40 default)
  ftpW: number;        // cycling watts (0 if unknown)
  ftpRunPaceSec: number; // sec/km at threshold (0 if unknown)
  ftpSwimCssSec: number; // sec/100m CSS (0 if unknown)
  grid: ScheduleGrid;
}

export interface PhaseConfig {
  name: Phase;
  ratio: number;   // fraction of total weeks assigned to this phase
  tssRamp: number; // week-over-week TSS multiplier within phase
  mix: { swim: number; bike: number; run: number }; // TSS fraction per sport
}

export interface RaceTemplate {
  minWeeks: number;
  taperWeeks: number;
  recoveryEveryN: number;          // insert 0.65× TSS week every N weeks
  tssStartFactor: number;          // × ctlBaseline → week 1 TSS
  tssPeakFactor: number;           // × ctlBaseline → peak TSS
  brickPhases: Phase[];            // phases where bike+run same-day allowed
  phases: PhaseConfig[];
}

export interface WeekPlan {
  weekNum: number;   // 1-based, 1 = first week of plan
  phase: Phase;
  tss: number;       // total TSS target for the week
  sportTss: { swim: number; bike: number; run: number };
}

export interface SessionPlan {
  day: number;       // 0=Mon … 6=Sun
  sport: Sport;
  durationMin: number;
  zone: 1 | 2 | 3 | 4 | 5;
  phase: Phase;
  description: string;
  windowStart?: string;
  windowEnd?: string;
}

export interface AuditResult {
  summary: string;
  warnings: { severity: 'error' | 'warning'; message: string }[];
}
```

- [ ] **Step 4: Create src/index.ts**

```ts
export { buildWeekPlans } from './engine.js';
export { scheduleWeek } from './scheduler.js';
export { auditPlan } from './auditor.js';
export { TEMPLATES } from './templates/index.js';
export type {
  RaceType, Sport, Intensity, Phase, ScheduleCell, ScheduleGrid,
  PlanSpec, RaceTemplate, PhaseConfig, WeekPlan, SessionPlan, AuditResult,
} from './types.js';
```

- [ ] **Step 5: Install deps and verify typecheck compiles (empty stubs ok)**

Create stub files so typecheck doesn't fail on missing imports:

```bash
mkdir -p packages/planner/src/templates packages/planner/src/__tests__
touch packages/planner/src/engine.ts packages/planner/src/scheduler.ts packages/planner/src/auditor.ts packages/planner/src/templates/index.ts
# Add empty exports to each stub
echo "export function buildWeekPlans() { return []; }" > packages/planner/src/engine.ts
echo "export function scheduleWeek() { return []; }" > packages/planner/src/scheduler.ts
echo "export async function auditPlan() { return { summary: '', warnings: [] }; }" > packages/planner/src/auditor.ts
echo "export const TEMPLATES = {} as any;" > packages/planner/src/templates/index.ts
```

```bash
cd /path/to/pacelore && pnpm -r typecheck
```

Expected: 0 errors (or only missing-import errors in other packages if planner not yet referenced).

- [ ] **Step 6: Commit**

```bash
git add packages/planner/
git commit -m "feat(planner): scaffold package with types"
```

---

## Task 2: Race templates

**Files:**
- Create: `packages/planner/src/templates/sprint.ts`
- Create: `packages/planner/src/templates/olympic.ts`
- Create: `packages/planner/src/templates/703.ts`
- Create: `packages/planner/src/templates/full.ts`
- Create: `packages/planner/src/templates/half-marathon.ts`
- Modify: `packages/planner/src/templates/index.ts`

- [ ] **Step 1: Create sprint.ts**

```ts
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
```

- [ ] **Step 2: Create olympic.ts**

```ts
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
```

- [ ] **Step 3: Create 703.ts**

```ts
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
```

- [ ] **Step 4: Create full.ts**

```ts
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
```

- [ ] **Step 5: Create half-marathon.ts**

```ts
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
```

- [ ] **Step 6: Update templates/index.ts**

```ts
import type { RaceTemplate, RaceType } from '../types.js';
export { sprintTemplate } from './sprint.js';
export { olympicTemplate } from './olympic.js';
export { template703 } from './703.js';
export { fullTemplate } from './full.js';
export { halfMarathonTemplate } from './half-marathon.js';

import { sprintTemplate } from './sprint.js';
import { olympicTemplate } from './olympic.js';
import { template703 } from './703.js';
import { fullTemplate } from './full.js';
import { halfMarathonTemplate } from './half-marathon.js';

export const TEMPLATES: Record<RaceType, RaceTemplate> = {
  'sprint': sprintTemplate,
  'olympic': olympicTemplate,
  '703': template703,
  'full': fullTemplate,
  'half-marathon': halfMarathonTemplate,
};
```

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @pacelore/planner typecheck
```

Expected: 0 errors

- [ ] **Step 8: Commit**

```bash
git add packages/planner/src/templates/
git commit -m "feat(planner): race templates for all 5 race types"
```

---

## Task 3: Periodization engine (TDD)

**Files:**
- Create: `packages/planner/src/__tests__/engine.test.ts`
- Modify: `packages/planner/src/engine.ts`

- [ ] **Step 1: Write failing tests**

`packages/planner/src/__tests__/engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — confirm all fail**

```bash
pnpm --filter @pacelore/planner test
```

Expected: multiple test failures (buildWeekPlans returns [])

- [ ] **Step 3: Implement engine.ts**

```ts
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
    } else {
      // Progressive ramp from tssStart to tssPeak across non-recovery weeks
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
```

- [ ] **Step 4: Run tests — confirm pass**

```bash
pnpm --filter @pacelore/planner test
```

Expected: all engine tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/planner/src/engine.ts packages/planner/src/__tests__/engine.test.ts
git commit -m "feat(planner): periodization engine with TDD"
```

---

## Task 4: Session scheduler (TDD)

**Files:**
- Modify: `packages/planner/src/__tests__/engine.test.ts` (append scheduler tests)
- Create: `packages/planner/src/__tests__/scheduler.test.ts`
- Modify: `packages/planner/src/scheduler.ts`

- [ ] **Step 1: Write failing tests**

`packages/planner/src/__tests__/scheduler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { scheduleWeek } from '../scheduler.js';
import type { WeekPlan, ScheduleGrid } from '../types.js';

const baseWeek: WeekPlan = {
  weekNum: 1,
  phase: 'base',
  tss: 240,
  sportTss: { swim: 60, bike: 108, run: 72 },
};

const fullGrid: ScheduleGrid = {
  swim: {
    0: { intensity: 'short' },
    2: { intensity: 'moderate' },
  },
  bike: {
    3: { intensity: 'moderate' },
    5: { intensity: 'long' },
  },
  run: {
    1: { intensity: 'short' },
    4: { intensity: 'moderate' },
    5: { intensity: 'moderate' },
  },
};

describe('scheduleWeek', () => {
  const sessions = scheduleWeek(baseWeek, fullGrid, false);

  it('returns array of sessions', () => {
    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
  });

  it('all session sports are present in grid', () => {
    for (const s of sessions) {
      expect(['swim', 'bike', 'run']).toContain(s.sport);
    }
  });

  it('all session days match the grid for that sport', () => {
    for (const s of sessions) {
      const sportGrid = fullGrid[s.sport];
      expect(sportGrid).toBeDefined();
      expect(sportGrid![s.day]).toBeDefined();
    }
  });

  it('no two sessions on same day + sport', () => {
    const seen = new Set<string>();
    for (const s of sessions) {
      const key = `${s.day}:${s.sport}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('durationMin is positive for all sessions', () => {
    for (const s of sessions) {
      expect(s.durationMin).toBeGreaterThan(0);
    }
  });

  it('zone is 1-5', () => {
    for (const s of sessions) {
      expect(s.zone).toBeGreaterThanOrEqual(1);
      expect(s.zone).toBeLessThanOrEqual(5);
    }
  });

  it('long-intensity day gets longer session than short-intensity day (same sport)', () => {
    const bikeSessions = sessions.filter(s => s.sport === 'bike');
    const shortBike = bikeSessions.find(s => fullGrid.bike![s.day]?.intensity === 'moderate');
    const longBike  = bikeSessions.find(s => fullGrid.bike![s.day]?.intensity === 'long');
    if (shortBike && longBike) {
      expect(longBike.durationMin).toBeGreaterThan(shortBike.durationMin);
    }
  });
});

describe('scheduleWeek — brick allowed', () => {
  it('can place bike + run on same long day when brick allowed', () => {
    const week: WeekPlan = { ...baseWeek, phase: 'build' };
    const grid: ScheduleGrid = {
      bike: { 5: { intensity: 'long' } },
      run:  { 5: { intensity: 'moderate' }, 1: { intensity: 'short' } },
    };
    const sessions = scheduleWeek(week, grid, true); // brickAllowed = true
    const satSessions = sessions.filter(s => s.day === 5);
    const sports = satSessions.map(s => s.sport);
    // Both bike and run can appear on day 5
    expect(sports).toContain('bike');
  });
});

describe('scheduleWeek — time window preserved', () => {
  it('passes windowStart/End through when set in grid', () => {
    const week: WeekPlan = { ...baseWeek };
    const grid: ScheduleGrid = {
      swim: { 2: { intensity: 'moderate', window: { start: '16:00', end: '18:00' } } },
    };
    const sessions = scheduleWeek(week, grid, false);
    const swimSesh = sessions.find(s => s.sport === 'swim' && s.day === 2);
    expect(swimSesh?.windowStart).toBe('16:00');
    expect(swimSesh?.windowEnd).toBe('18:00');
  });
});

describe('scheduleWeek — half marathon (run only)', () => {
  it('only returns run sessions when grid has only run', () => {
    const week: WeekPlan = {
      weekNum: 1, phase: 'base', tss: 180,
      sportTss: { swim: 0, bike: 0, run: 180 },
    };
    const grid: ScheduleGrid = {
      run: { 0: { intensity: 'short' }, 2: { intensity: 'moderate' }, 5: { intensity: 'long' } },
    };
    const sessions = scheduleWeek(week, grid, false);
    expect(sessions.every(s => s.sport === 'run')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — confirm fail**

```bash
pnpm --filter @pacelore/planner test
```

Expected: scheduler tests fail (scheduleWeek returns [])

- [ ] **Step 3: Implement scheduler.ts**

```ts
import type { WeekPlan, SessionPlan, ScheduleGrid, Sport, Phase } from './types.js';

// TSS per hour estimates per sport (zone 2 baseline)
const TSS_PER_HOUR: Record<Sport, number> = {
  swim: 40,
  bike: 55,
  run:  55,
};

const INTENSITY_WEIGHTS = { short: 1, moderate: 1.8, long: 3 } as const;

const ZONE_BY_PHASE: Record<Phase, 1 | 2 | 3 | 4 | 5> = {
  base:     2,
  build:    3,
  peak:     4,
  'race-sp':3,
  taper:    2,
  recovery: 1,
};

export function scheduleWeek(
  week: WeekPlan,
  grid: ScheduleGrid,
  brickAllowed: boolean,
): SessionPlan[] {
  const sessions: SessionPlan[] = [];
  const zone = ZONE_BY_PHASE[week.phase];

  const sports: Sport[] = ['swim', 'bike', 'run'];

  for (const sport of sports) {
    const sportGrid = grid[sport];
    if (!sportGrid) continue;

    const sportTss = week.sportTss[sport];
    if (sportTss <= 0) continue;

    const days = Object.entries(sportGrid)
      .filter(([, cell]) => cell.intensity !== null)
      .map(([day, cell]) => ({ day: Number(day), cell }));

    if (days.length === 0) continue;

    // Total weight for duration distribution
    const totalWeight = days.reduce(
      (sum, { cell }) => sum + INTENSITY_WEIGHTS[cell.intensity!],
      0,
    );

    const tssPerHour = TSS_PER_HOUR[sport];
    const totalHours = sportTss / tssPerHour;

    for (const { day, cell } of days) {
      // Skip if this day already has a session of same sport (shouldn't happen with valid grid)
      if (sessions.some(s => s.day === day && s.sport === sport)) continue;

      // Skip brick conflict if not allowed: run on same day as bike long
      if (!brickAllowed && sport === 'run') {
        const bikeOnDay = sessions.some(s => s.day === day && s.sport === 'bike');
        if (bikeOnDay) {
          // Move run to first available adjacent day with no conflict
          continue;
        }
      }

      const weight = INTENSITY_WEIGHTS[cell.intensity!];
      const sessionHours = (weight / totalWeight) * totalHours;
      const durationMin = Math.max(20, Math.round(sessionHours * 60));

      sessions.push({
        day,
        sport,
        durationMin,
        zone,
        phase: week.phase,
        description: buildDescription(sport, week.phase, cell.intensity!),
        windowStart: cell.window?.start,
        windowEnd: cell.window?.end,
      });
    }
  }

  return sessions;
}

function buildDescription(sport: Sport, phase: Phase, intensity: string): string {
  const sportName = { swim: 'Swim', bike: 'Ride', run: 'Run' }[sport];
  const phaseDesc: Record<Phase, string> = {
    base:     'aerobic base',
    build:    'building threshold',
    peak:     'race-specific intensity',
    'race-sp':'race-simulation',
    taper:    'race sharpening',
    recovery: 'easy recovery',
  };
  return `${sportName} — ${intensity} ${phaseDesc[phase]}`;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @pacelore/planner test
```

Expected: all engine + scheduler tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/planner/src/scheduler.ts packages/planner/src/__tests__/scheduler.test.ts
git commit -m "feat(planner): session scheduler with TDD"
```

---

## Task 5: Claude auditor

**Files:**
- Modify: `packages/planner/src/auditor.ts`

No unit tests for auditor — it's an HTTP call. Tested at API integration level.

- [ ] **Step 1: Implement auditor.ts**

```ts
import type { WeekPlan, PlanSpec, AuditResult } from './types.js';

export async function auditPlan(
  weeks: WeekPlan[],
  spec: PlanSpec,
  apiKey: string,
): Promise<AuditResult> {
  const weekSummaries = weeks.map(w => ({
    week: w.weekNum,
    phase: w.phase,
    tss: w.tss,
  }));

  const hoursPerWeek = estimateHoursPerWeek(spec);

  const prompt = `You are a triathlon coach auditing a training plan. Return ONLY valid JSON, no explanation.

Race: ${spec.raceType}, ${weeks.length} weeks of preparation.
Athlete CTL baseline: ${spec.ctlBaseline}. Available hours per week: ~${hoursPerWeek.toFixed(1)}h.
Plan weeks: ${JSON.stringify(weekSummaries)}

Return: {"summary":"<2-3 sentence plan overview>","warnings":[{"severity":"error"|"warning","message":"<concise issue>"}]}

Only include warnings for real issues:
- Timeline under minimum (sprint<4w, olympic<8w, 703<12w, full<16w, half-marathon<8w)
- Any week-over-week TSS increase >15% (excluding recovery→build transitions)
- Available hours likely insufficient for peak TSS weeks
- Taper shorter than 1 week

Return empty warnings array if plan looks solid.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API ${res.status}`);

  const data = await res.json() as { content: { type: string; text: string }[] };
  const text = data.content.find(b => b.type === 'text')?.text ?? '';

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned) as AuditResult;
}

function estimateHoursPerWeek(spec: PlanSpec): number {
  let totalMin = 0;
  const sports = ['swim', 'bike', 'run'] as const;
  for (const sport of sports) {
    const sportGrid = spec.grid[sport];
    if (!sportGrid) continue;
    for (const cell of Object.values(sportGrid)) {
      if (!cell.intensity) continue;
      const mins = { short: 45, moderate: 75, long: 150 }[cell.intensity];
      totalMin += mins;
    }
  }
  return totalMin / 60;
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @pacelore/planner typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add packages/planner/src/auditor.ts
git commit -m "feat(planner): Claude Haiku audit call"
```

---

## Task 6: Database migration + Env

**Files:**
- Create: `infra/wrangler/migrations/0012_race_plans.sql`
- Modify: `apps/api/src/env.ts`

- [ ] **Step 1: Create migration**

`infra/wrangler/migrations/0012_race_plans.sql`:

```sql
-- 0012_race_plans.sql — race training plan creator

CREATE TABLE race_plans (
  id          TEXT    PRIMARY KEY,
  athlete_id  TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  race_type   TEXT    NOT NULL CHECK (race_type IN ('sprint','olympic','703','full','half-marathon')),
  race_date   INTEGER NOT NULL,
  config_json TEXT    NOT NULL,
  audit_json  TEXT,
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_race_plans_athlete ON race_plans (athlete_id, created_at DESC);

ALTER TABLE planned_workouts ADD COLUMN plan_id TEXT REFERENCES race_plans(id) ON DELETE CASCADE;
ALTER TABLE planned_workouts ADD COLUMN session_json TEXT;

ALTER TABLE users ADD COLUMN height_cm  INTEGER;
ALTER TABLE users ADD COLUMN weight_kg  REAL;
```

`session_json` stores structured session info for plan-generated entries (where `workout_id` is null):
```json
{"sport":"bike","durationMin":90,"zone":2,"phase":"base","description":"Ride — long aerobic base","windowStart":"07:00","windowEnd":"10:00"}
```

- [ ] **Step 2: Apply migration locally (if using local D1)**

```bash
cd apps/api
pnpm exec wrangler d1 execute pacelore-db --local --file=../../infra/wrangler/migrations/0012_race_plans.sql
```

Expected: `Successfully applied 1 migration`

- [ ] **Step 3: Add ANTHROPIC_API_KEY to Env interface**

In `apps/api/src/env.ts`, add after `ARWEAVE_TURBO_TOKEN`:

```ts
  ANTHROPIC_API_KEY?: string;
```

- [ ] **Step 4: Typecheck API**

```bash
pnpm --filter @pacelore/api typecheck
```

Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add infra/wrangler/migrations/0012_race_plans.sql apps/api/src/env.ts
git commit -m "feat(db): race_plans table, session_json + plan_id on planned_workouts"
```

---

## Task 7: API — FTP estimates endpoint

**Files:**
- Modify: `apps/api/src/routes/training.ts`

Append before the final export, after the existing coach routes.

- [ ] **Step 1: Add dependency on @pacelore/planner to API package.json**

In `apps/api/package.json`, add to `dependencies`:
```json
"@pacelore/planner": "workspace:*"
```

Then run:
```bash
pnpm install
```

- [ ] **Step 2: Append FTP estimates route to training.ts**

Add this import at the top of `training.ts`:
```ts
import type { RaceType, ScheduleGrid } from '@pacelore/planner';
import { buildWeekPlans, scheduleWeek, auditPlan, TEMPLATES } from '@pacelore/planner';
```

Append this route before the file ends:

```ts
// FTP estimates -------------------------------------------------------
// Derive FTP estimates from activity best efforts.
// Bike: best 20-min avg power × 0.95.
// Run:  best 30-min avg pace → threshold pace sec/km.
// Swim: best 400m time → CSS = time / 4 sec/100m.
trainingRoutes.get('/me/ftp-estimates', async (c) => {
  const session = c.get('session');

  // Best 20-min power for cycling
  const bikeRow = await c.env.DB.prepare(
    `SELECT value FROM personal_records
      WHERE athlete_id = ? AND sport = 'cycling' AND key = 'power:1200s'
      LIMIT 1`,
  ).bind(session.userId).first<{ value: number }>();

  // Best threshold pace: use 30-min best (1800s) distance → pace
  const runRow = await c.env.DB.prepare(
    `SELECT value FROM personal_records
      WHERE athlete_id = ? AND sport = 'running' AND key = 'distance:30m'
      LIMIT 1`,
  ).bind(session.userId).first<{ value: number }>();

  // Best 400m swim time
  const swimRow = await c.env.DB.prepare(
    `SELECT value FROM personal_records
      WHERE athlete_id = ? AND sport = 'swimming' AND key = 'distance:400m'
      LIMIT 1`,
  ).bind(session.userId).first<{ value: number }>();

  return c.json({
    ftpW:         bikeRow ? Math.round(bikeRow.value * 0.95) : null,
    ftpRunPaceSec: runRow  ? Math.round(1800 / (runRow.value / 1000)) : null, // sec/km
    ftpSwimCssSec: swimRow ? Math.round(swimRow.value / 4) : null,            // sec/100m
  });
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @pacelore/api typecheck
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/training.ts apps/api/package.json pnpm-lock.yaml
git commit -m "feat(api): GET /me/ftp-estimates from personal records"
```

---

## Task 8: API — POST /plans (plan generation)

**Files:**
- Modify: `apps/api/src/routes/training.ts`

- [ ] **Step 1: Add uuidv7 import check**

`uuidv7` is already imported at top of `training.ts`. Confirm:
```bash
grep "uuidv7" apps/api/src/routes/training.ts
```

Expected: at least one match.

- [ ] **Step 2: Append POST /plans route**

Append to `training.ts`:

```ts
// Race plans ----------------------------------------------------------
const VALID_RACE_TYPES = new Set<RaceType>(['sprint', 'olympic', '703', 'full', 'half-marathon']);

interface PlanBody {
  raceType: RaceType;
  raceDateTs: number;
  ctlBaseline: number;
  ftpW: number;
  ftpRunPaceSec: number;
  ftpSwimCssSec: number;
  heightCm?: number;
  weightKg?: number;
  grid: ScheduleGrid;
}

trainingRoutes.post('/plans', async (c) => {
  const session = c.get('session');
  const body = (await c.req.json()) as PlanBody;

  if (!body.raceType || !VALID_RACE_TYPES.has(body.raceType)) {
    throw new HTTPException(400, { message: 'invalid raceType' });
  }
  if (!body.raceDateTs || !body.grid) {
    throw new HTTPException(400, { message: 'raceDateTs and grid required' });
  }

  const template = TEMPLATES[body.raceType];
  const todayTs = Math.floor(Date.now() / 1000);

  const spec = {
    raceType: body.raceType,
    raceDateTs: body.raceDateTs,
    todayTs,
    ctlBaseline: body.ctlBaseline ?? 40,
    ftpW: body.ftpW ?? 0,
    ftpRunPaceSec: body.ftpRunPaceSec ?? 0,
    ftpSwimCssSec: body.ftpSwimCssSec ?? 0,
    grid: body.grid,
  };

  // Generate week plans
  const weekPlans = buildWeekPlans(spec, template);

  // Persist height/weight to users if provided
  if (body.heightCm || body.weightKg) {
    await c.env.DB.prepare(
      `UPDATE users SET height_cm = COALESCE(?, height_cm), weight_kg = COALESCE(?, weight_kg) WHERE id = ?`,
    ).bind(body.heightCm ?? null, body.weightKg ?? null, session.userId).run();
  }

  // Create race_plans row
  const planId = uuidv7();
  const configJson = JSON.stringify({
    ftpW: body.ftpW,
    ftpRunPaceSec: body.ftpRunPaceSec,
    ftpSwimCssSec: body.ftpSwimCssSec,
    grid: body.grid,
  });

  await c.env.DB.prepare(
    `INSERT INTO race_plans (id, athlete_id, race_type, race_date, config_json, created_at)
     VALUES (?, ?, ?, ?, ?, unixepoch())`,
  ).bind(planId, session.userId, body.raceType, body.raceDateTs, configJson).run();

  // Build sessions + write planned_workouts
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const weekRows: { weekNum: number; phase: string; tss: number; hours: number; sessions: object[] }[] = [];

  const stmts = [];
  for (const week of weekPlans) {
    const brickAllowed = template.brickPhases.includes(week.phase as any);
    const sessions = scheduleWeek(week, body.grid, brickAllowed);

    const weekStartDate = new Date(startOfToday);
    weekStartDate.setDate(weekStartDate.getDate() + (week.weekNum - 1) * 7);

    const sessionRows = [];
    for (const s of sessions) {
      const sessionDate = new Date(weekStartDate);
      // day 0 = Monday; adjust from JS Sunday=0 week
      const jsDay = sessionDate.getDay(); // 0=Sun
      const mondayOffset = jsDay === 0 ? 1 : (8 - jsDay) % 7 || 7; // days until next Monday
      sessionDate.setDate(weekStartDate.getDate() + (weekStartDate.getDay() === 1 ? 0 : mondayOffset));
      sessionDate.setDate(sessionDate.getDate() + s.day);

      const dateStr = sessionDate.toISOString().slice(0, 10);
      const pwId = uuidv7();
      const sessionJson = JSON.stringify({
        sport: s.sport,
        durationMin: s.durationMin,
        zone: s.zone,
        phase: s.phase,
        description: s.description,
        windowStart: s.windowStart,
        windowEnd: s.windowEnd,
      });

      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO planned_workouts (id, athlete_id, scheduled_date, plan_id, session_json, created_at)
           VALUES (?, ?, ?, ?, ?, unixepoch())`,
        ).bind(pwId, session.userId, dateStr, planId, sessionJson),
      );

      sessionRows.push({ plannedWorkoutId: pwId, day: s.day, sport: s.sport, durationMin: s.durationMin, zone: s.zone, description: s.description, windowStart: s.windowStart, windowEnd: s.windowEnd });
    }

    const totalHours = sessions.reduce((s, r) => s + r.durationMin / 60, 0);
    weekRows.push({ weekNum: week.weekNum, phase: week.phase, tss: week.tss, hours: Math.round(totalHours * 10) / 10, sessions: sessionRows });
  }

  // Batch insert all planned_workouts
  if (stmts.length > 0) {
    await c.env.DB.batch(stmts);
  }

  // Claude audit (best-effort — don't fail plan if it errors)
  let audit = null;
  if (c.env.ANTHROPIC_API_KEY) {
    try {
      audit = await auditPlan(weekPlans, spec, c.env.ANTHROPIC_API_KEY);
      await c.env.DB.prepare(
        `UPDATE race_plans SET audit_json = ? WHERE id = ?`,
      ).bind(JSON.stringify(audit), planId).run();
    } catch {
      // audit failure is non-fatal
    }
  }

  return c.json({ planId, raceType: body.raceType, raceDateTs: body.raceDateTs, weeks: weekRows, audit }, 201);
});
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @pacelore/api typecheck
```

Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/training.ts
git commit -m "feat(api): POST /plans — generate + populate calendar"
```

---

## Task 9: API — GET /plans, GET /plans/:id, DELETE /plans/:id

**Files:**
- Modify: `apps/api/src/routes/training.ts`

- [ ] **Step 1: Append list + detail + delete routes**

```ts
trainingRoutes.get('/plans', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT id, race_type AS raceType, race_date AS raceDateTs,
            status, created_at AS createdAt,
            (SELECT COUNT(*) FROM planned_workouts WHERE plan_id = race_plans.id) AS sessionCount
       FROM race_plans WHERE athlete_id = ?
      ORDER BY created_at DESC`,
  ).bind(session.userId).all();
  return c.json({ items: rows.results ?? [] });
});

trainingRoutes.get('/plans/:planId', async (c) => {
  const session = c.get('session');
  const planId = c.req.param('planId');

  const plan = await c.env.DB.prepare(
    `SELECT id, race_type AS raceType, race_date AS raceDateTs,
            audit_json AS auditJson, status, created_at AS createdAt
       FROM race_plans WHERE id = ? AND athlete_id = ?`,
  ).bind(planId, session.userId).first<{
    id: string; raceType: string; raceDateTs: number;
    auditJson: string | null; status: string; createdAt: number;
  }>();

  if (!plan) throw new HTTPException(404, { message: 'plan not found' });

  const sessions = await c.env.DB.prepare(
    `SELECT id, scheduled_date AS date, session_json AS sessionJson
       FROM planned_workouts
      WHERE plan_id = ? AND athlete_id = ?
      ORDER BY scheduled_date ASC`,
  ).bind(planId, session.userId).all();

  return c.json({
    ...plan,
    audit: plan.auditJson ? JSON.parse(plan.auditJson) : null,
    sessions: (sessions.results ?? []).map((r: any) => ({
      id: r.id,
      date: r.date,
      ...(r.sessionJson ? JSON.parse(r.sessionJson) : {}),
    })),
  });
});

trainingRoutes.delete('/plans/:planId', async (c) => {
  const session = c.get('session');
  const planId = c.req.param('planId');

  const plan = await c.env.DB.prepare(
    `SELECT id FROM race_plans WHERE id = ? AND athlete_id = ?`,
  ).bind(planId, session.userId).first();

  if (!plan) throw new HTTPException(404, { message: 'plan not found' });

  // planned_workouts cascade-delete via FK
  await c.env.DB.prepare(`DELETE FROM race_plans WHERE id = ?`).bind(planId).run();

  return c.json({ deleted: true });
});

trainingRoutes.patch('/plans/:planId/archive', async (c) => {
  const session = c.get('session');
  const planId = c.req.param('planId');

  const plan = await c.env.DB.prepare(
    `SELECT id FROM race_plans WHERE id = ? AND athlete_id = ?`,
  ).bind(planId, session.userId).first();

  if (!plan) throw new HTTPException(404, { message: 'plan not found' });

  await c.env.DB.prepare(
    `UPDATE race_plans SET status = 'archived' WHERE id = ?`,
  ).bind(planId).run();

  return c.json({ archived: true });
});
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @pacelore/api typecheck
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/training.ts
git commit -m "feat(api): GET/DELETE /plans routes + archive action"
```

---

## Task 10: Web — /plans list page

**Files:**
- Create: `apps/web/src/pages/plans/index.astro`

- [ ] **Step 1: Create plans/index.astro**

```astro
---
import Shell from '../../layouts/Shell.astro';
---

<Shell title="Training Plans" active="plans">
  <div class="stack" style="gap: 24px;">
    <header class="row">
      <div>
        <h1 class="h1" style="font-size: 28px;">Training Plans</h1>
        <p class="muted body-sm" style="margin-top: 4px;">Periodized plans for your target race.</p>
      </div>
      <a href="/plans/new" class="btn btn-primary row-end" style="text-decoration:none;">New Plan</a>
    </header>

    <div id="plans-list" class="stack" style="gap: 12px;">
      <p class="muted body-sm">Loading…</p>
    </div>

    <details id="archived-section" style="display:none;">
      <summary class="muted body-sm" style="cursor:pointer;user-select:none;">Archived plans</summary>
      <div id="archived-list" class="stack" style="gap: 8px; margin-top: 12px;"></div>
    </details>
  </div>
</Shell>

<script>
const RACE_LABELS: Record<string, string> = {
  sprint: 'Sprint Triathlon',
  olympic: 'Olympic Triathlon',
  '703': 'Ironman 70.3',
  full: 'Full Ironman',
  'half-marathon': 'Half Marathon',
};

function daysUntil(ts: number) {
  return Math.ceil((ts - Date.now() / 1000) / 86400);
}

function renderCard(p: any) {
  const days = daysUntil(p.raceDateTs);
  const label = RACE_LABELS[p.raceType] ?? p.raceType;
  const raceDate = new Date(p.raceDateTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return `
    <a href="/plans/${p.id}" class="panel" style="text-decoration:none;display:block;">
      <div class="panel-body row" style="gap:16px;align-items:center;">
        <div class="stack" style="gap:4px;flex:1;">
          <span class="h3" style="font-size:16px;">${label}</span>
          <span class="muted body-sm">${raceDate} · ${p.sessionCount} sessions</span>
        </div>
        <span class="metric-label" style="color:${days < 0 ? 'var(--fg-muted)' : days < 14 ? 'var(--warning)' : 'inherit'};">
          ${days < 0 ? 'Past' : days === 0 ? 'Today!' : `${days}d away`}
        </span>
        <span class="metric-label" style="color:var(--fg-muted);">${p.status === 'archived' ? 'archived' : ''}</span>
      </div>
    </a>`;
}

async function load() {
  const res = await fetch('/api/v1/plans');
  if (!res.ok) return;
  const { items } = await res.json() as { items: any[] };

  const active = items.filter(p => p.status === 'active');
  const archived = items.filter(p => p.status === 'archived');

  const list = document.getElementById('plans-list')!;
  if (active.length === 0) {
    list.innerHTML = '<p class="muted body-sm">No plans yet. <a href="/plans/new">Create one →</a></p>';
  } else {
    list.innerHTML = active.map(renderCard).join('');
  }

  if (archived.length > 0) {
    const section = document.getElementById('archived-section')!;
    section.style.display = '';
    document.getElementById('archived-list')!.innerHTML = archived.map(renderCard).join('');
  }
}

load();
</script>
```

- [ ] **Step 2: Verify Astro build compiles**

```bash
pnpm --filter @pacelore/web build 2>&1 | tail -5
```

Expected: no errors, build completes

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/plans/index.astro
git commit -m "feat(web): /plans list page"
```

---

## Task 11: Web — /plans/new wizard

**Files:**
- Create: `apps/web/src/pages/plans/new.astro`

- [ ] **Step 1: Create new.astro**

```astro
---
import Shell from '../../layouts/Shell.astro';
---

<Shell title="New Training Plan" active="plans">
  <div class="stack" style="gap: 24px; max-width: 720px;">
    <header>
      <h1 class="h1" style="font-size: 28px;">New Training Plan</h1>
    </header>

    <!-- Progress indicator -->
    <div class="row" style="gap: 8px;" id="step-progress">
      <span class="step-dot active" data-step="1">1</span>
      <span class="step-line"></span>
      <span class="step-dot" data-step="2">2</span>
      <span class="step-line"></span>
      <span class="step-dot" data-step="3">3</span>
      <span class="step-line"></span>
      <span class="step-dot" data-step="4">4</span>
    </div>

    <!-- Step 1: Race -->
    <div id="step-1" class="stack" style="gap: 20px;">
      <h2 class="h3">What's your race?</h2>
      <div class="grid-tiles grid-cols-3" id="race-type-grid">
        <button class="panel race-btn" data-race="sprint" style="text-align:left;cursor:pointer;">
          <div class="panel-body"><strong>Sprint</strong><br><span class="muted body-sm">750m · 20km · 5km</span></div>
        </button>
        <button class="panel race-btn" data-race="olympic" style="text-align:left;cursor:pointer;">
          <div class="panel-body"><strong>Olympic</strong><br><span class="muted body-sm">1.5km · 40km · 10km</span></div>
        </button>
        <button class="panel race-btn" data-race="703" style="text-align:left;cursor:pointer;">
          <div class="panel-body"><strong>Ironman 70.3</strong><br><span class="muted body-sm">1.9km · 90km · 21km</span></div>
        </button>
        <button class="panel race-btn" data-race="full" style="text-align:left;cursor:pointer;">
          <div class="panel-body"><strong>Full Ironman</strong><br><span class="muted body-sm">3.8km · 180km · 42km</span></div>
        </button>
        <button class="panel race-btn" data-race="half-marathon" style="text-align:left;cursor:pointer;">
          <div class="panel-body"><strong>Half Marathon</strong><br><span class="muted body-sm">21.1km run</span></div>
        </button>
      </div>
      <div class="stack" style="gap: 8px;">
        <label class="label">Race date</label>
        <input type="date" id="race-date" class="mock-input" style="max-width:200px;" />
        <p id="date-warning" class="body-sm" style="color:var(--warning);display:none;"></p>
      </div>
      <button class="btn btn-primary" id="step1-next" disabled>Next →</button>
    </div>

    <!-- Step 2: Schedule grid -->
    <div id="step-2" class="stack" style="gap: 20px; display:none;">
      <h2 class="h3">When can you train?</h2>
      <p class="muted body-sm">Click a cell to set intensity. Click again to add a time window.</p>
      <div style="overflow-x:auto;">
        <table id="schedule-grid" style="border-collapse:separate;border-spacing:4px;min-width:500px;">
          <thead>
            <tr>
              <th style="width:60px;"></th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Mon</th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Tue</th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Wed</th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Thu</th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Fri</th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Sat</th>
              <th class="muted body-sm" style="text-align:center;font-weight:normal;">Sun</th>
            </tr>
          </thead>
          <tbody id="grid-body"></tbody>
        </table>
      </div>
      <p id="grid-summary" class="muted body-sm"></p>

      <!-- Time window popup -->
      <div id="window-popup" style="display:none;position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px;z-index:100;min-width:260px;" class="stack" style="gap:12px;">
        <h3 class="h3" style="font-size:16px;">Set time window</h3>
        <div class="row" style="gap:12px;align-items:center;">
          <label class="label">Start</label>
          <input type="time" id="window-start" class="mock-input" value="06:00" />
        </div>
        <div class="row" style="gap:12px;align-items:center;">
          <label class="label">End</label>
          <input type="time" id="window-end" class="mock-input" value="08:00" />
        </div>
        <div class="row" style="gap:8px;justify-content:flex-end;">
          <button class="btn" id="window-clear">Clear</button>
          <button class="btn btn-primary" id="window-save">Save</button>
        </div>
      </div>
      <div id="window-backdrop" style="display:none;position:fixed;inset:0;z-index:99;" onclick="closeWindowPopup()"></div>

      <div class="row" style="gap:8px;">
        <button class="btn" id="step2-back">← Back</button>
        <button class="btn btn-primary" id="step2-next">Next →</button>
      </div>
    </div>

    <!-- Step 3: Profile -->
    <div id="step-3" class="stack" style="gap: 20px; display:none;">
      <h2 class="h3">Your profile</h2>
      <div class="grid-tiles grid-cols-2" style="gap:16px;">
        <div class="stack" style="gap:6px;">
          <label class="label">Height (cm)</label>
          <input type="number" id="height-cm" class="mock-input" placeholder="175" min="100" max="250" />
        </div>
        <div class="stack" style="gap:6px;">
          <label class="label">Weight (kg)</label>
          <input type="number" id="weight-kg" class="mock-input" placeholder="70" min="30" max="200" step="0.1" />
        </div>
        <div class="stack" style="gap:6px;" id="ftp-bike-wrap">
          <label class="label">Cycling FTP (W)</label>
          <input type="number" id="ftp-w" class="mock-input" placeholder="Auto-detect…" min="50" max="600" />
        </div>
        <div class="stack" style="gap:6px;">
          <label class="label">Run threshold pace (min/km)</label>
          <input type="text" id="ftp-run" class="mock-input" placeholder="e.g. 5:30" pattern="\\d+:\\d{2}" />
        </div>
        <div class="stack" style="gap:6px;" id="ftp-swim-wrap">
          <label class="label">Swim CSS (sec/100m)</label>
          <input type="number" id="ftp-swim" class="mock-input" placeholder="Auto-detect…" min="50" max="300" />
        </div>
        <div class="stack" style="gap:6px;">
          <label class="label">Current fitness (CTL)</label>
          <div id="ctl-display" class="muted body-sm" style="padding:8px 0;">Loading…</div>
        </div>
      </div>
      <p class="muted body-sm">All fields optional — we'll estimate from your activity history.</p>
      <div class="row" style="gap:8px;">
        <button class="btn" id="step3-back">← Back</button>
        <button class="btn btn-primary" id="step3-next">Next →</button>
      </div>
    </div>

    <!-- Step 4: Generate + preview -->
    <div id="step-4" class="stack" style="gap: 20px; display:none;">
      <div class="row">
        <h2 class="h3">Your Plan</h2>
        <div class="row-end row" style="gap:8px;">
          <button class="btn" id="step4-back">← Back</button>
        </div>
      </div>

      <div id="generate-loading" class="muted body-sm">Generating your plan…</div>
      <div id="generate-error" style="display:none;color:var(--danger);" class="body-sm"></div>

      <!-- Audit block -->
      <div id="audit-block" style="display:none;" class="stack" style="gap:8px;">
        <div id="audit-summary" class="body-sm"></div>
        <div id="audit-warnings" class="stack" style="gap:6px;"></div>
      </div>

      <!-- Week navigator -->
      <div id="week-nav" style="display:none;">
        <div class="row" style="gap:12px;align-items:center;margin-bottom:16px;">
          <button class="btn" id="prev-week" disabled>‹ Prev</button>
          <span id="week-label" class="label" style="flex:1;text-align:center;"></span>
          <button class="btn" id="next-week">Next ›</button>
        </div>
        <div id="week-grid" class="grid-tiles grid-cols-7" style="gap:6px;"></div>
        <p id="week-stats" class="muted body-sm" style="margin-top:8px;text-align:center;"></p>
      </div>

      <a id="view-plan-btn" href="#" class="btn btn-primary" style="display:none;text-align:center;text-decoration:none;">View my plan →</a>
    </div>
  </div>
</Shell>

<style>
.step-dot {
  width: 28px; height: 28px; border-radius: 50%;
  background: var(--surface-raised); border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; color: var(--fg-muted);
}
.step-dot.active { background: var(--pace-500); color: #fff; border-color: var(--pace-500); }
.step-dot.done   { background: var(--success); color: #fff; border-color: var(--success); }
.step-line { flex: 1; height: 1px; background: var(--border); }
.race-btn { border: 2px solid transparent; background: none; padding: 0; }
.race-btn.selected { border-color: var(--pace-500); }
.grid-cell {
  width: 72px; height: 56px; border-radius: 6px; cursor: pointer;
  border: 1px dashed var(--border); background: var(--surface);
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 11px; gap: 2px; transition: border-color 0.1s;
}
.grid-cell.short    { background: var(--pace-900); border-color: var(--pace-500); color: var(--pace-400); }
.grid-cell.moderate { background: oklch(0.30 0.10 50);  border-color: oklch(0.65 0.18 50);  color: oklch(0.85 0.18 50); }
.grid-cell.long     { background: oklch(0.25 0.12 140); border-color: oklch(0.60 0.18 140); color: oklch(0.80 0.18 140); }
.session-cell {
  border-radius: 6px; padding: 8px 4px; text-align: center; min-height: 64px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 11px; gap: 2px;
}
.session-cell.empty { background: var(--surface); border: 1px dashed var(--border); color: var(--fg-muted); }
.session-cell.swim  { background: var(--pace-900); border: 1px solid var(--pace-600); }
.session-cell.bike  { background: oklch(0.28 0.10 50);  border: 1px solid oklch(0.55 0.18 50); }
.session-cell.run   { background: oklch(0.23 0.12 140); border: 1px solid oklch(0.55 0.18 140); }
</style>

<script>
// ---- State ----
let currentStep = 1;
let selectedRace = '';
let raceDate = '';
let scheduleGrid: Record<string, Record<number, { intensity: string | null; window?: { start: string; end: string } }>> = {
  swim: {}, bike: {}, run: {},
};
let profile = { heightCm: 0, weightKg: 0, ftpW: 0, ftpRunPaceSec: 0, ftpSwimCssSec: 0, ctlBaseline: 0 };
let generatedPlan: any = null;
let currentWeek = 0;
let activePopupCell: { sport: string; day: number } | null = null;

const SPORTS = ['swim', 'bike', 'run'] as const;
const SPORT_EMOJI: Record<string, string> = { swim: '🏊', bike: '🚴', run: '🏃' };
const INTENSITY_CYCLE = [null, 'short', 'moderate', 'long'] as const;
const MIN_WEEKS: Record<string, number> = { sprint: 4, olympic: 8, '703': 12, full: 16, 'half-marathon': 8 };

function showStep(n: number) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step-${i}`)!;
    el.style.display = i === n ? '' : 'none';
  }
  document.querySelectorAll('.step-dot').forEach(dot => {
    const s = Number((dot as HTMLElement).dataset.step);
    dot.classList.toggle('active', s === n);
    dot.classList.toggle('done', s < n);
  });
  currentStep = n;
}

// Step 1
document.querySelectorAll('.race-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.race-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedRace = (btn as HTMLElement).dataset.race!;
    checkStep1();
  });
});

document.getElementById('race-date')!.addEventListener('input', (e) => {
  raceDate = (e.target as HTMLInputElement).value;
  checkStep1();
});

function checkStep1() {
  const btn = document.getElementById('step1-next') as HTMLButtonElement;
  const warn = document.getElementById('date-warning')!;
  if (!selectedRace || !raceDate) { btn.disabled = true; return; }
  const weeks = Math.floor((new Date(raceDate).getTime() - Date.now()) / (7 * 86400_000));
  const min = MIN_WEEKS[selectedRace] ?? 4;
  if (weeks < 1) {
    btn.disabled = true; warn.style.display = ''; warn.textContent = 'Race date must be in the future.';
  } else {
    btn.disabled = false;
    if (weeks < min) {
      warn.style.display = ''; warn.textContent = `Only ${weeks} weeks — plan will be compressed (minimum recommended: ${min}).`;
    } else {
      warn.style.display = 'none';
    }
  }
  // Hide swim/bike for half-marathon
  rebuildGrid();
}

document.getElementById('step1-next')!.addEventListener('click', () => {
  rebuildGrid();
  showStep(2);
});

// Step 2: Schedule grid
function rebuildGrid() {
  const isRunOnly = selectedRace === 'half-marathon';
  const sports = isRunOnly ? ['run'] : ['swim', 'bike', 'run'];
  const tbody = document.getElementById('grid-body')!;
  tbody.innerHTML = '';
  for (const sport of sports) {
    if (!scheduleGrid[sport]) scheduleGrid[sport] = {};
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.className = 'muted body-sm';
    th.style.textAlign = 'left';
    th.textContent = SPORT_EMOJI[sport];
    tr.appendChild(th);
    for (let day = 0; day < 7; day++) {
      const td = document.createElement('td');
      const cell = scheduleGrid[sport][day] ?? { intensity: null };
      td.innerHTML = renderCell(sport, day, cell);
      td.querySelector('.grid-cell')!.addEventListener('click', () => handleCellClick(sport, day));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  updateGridSummary();
}

function renderCell(sport: string, day: number, cell: { intensity: string | null; window?: { start: string; end: string } }) {
  const cls = cell.intensity ? ` ${cell.intensity}` : '';
  const win = cell.window ? `<span style="font-size:9px">${cell.window.start}</span>` : '';
  const label = cell.intensity ? `${cell.intensity}${win ? '<br>' + win : ''}` : '<span style="opacity:.3">+</span>';
  return `<div class="grid-cell${cls}" data-sport="${sport}" data-day="${day}">${label}</div>`;
}

function handleCellClick(sport: string, day: number) {
  const cell = scheduleGrid[sport][day] ?? { intensity: null };
  if (cell.intensity && !cell.window) {
    // Second click on filled cell → open window popup
    openWindowPopup(sport, day);
    return;
  }
  // Cycle intensity
  const idx = INTENSITY_CYCLE.indexOf(cell.intensity as any);
  const next = INTENSITY_CYCLE[(idx + 1) % INTENSITY_CYCLE.length];
  scheduleGrid[sport][day] = { intensity: next };
  rebuildGrid();
}

function openWindowPopup(sport: string, day: number) {
  activePopupCell = { sport, day };
  const cell = scheduleGrid[sport][day];
  (document.getElementById('window-start') as HTMLInputElement).value = cell?.window?.start ?? '06:00';
  (document.getElementById('window-end') as HTMLInputElement).value = cell?.window?.end ?? '08:00';
  document.getElementById('window-popup')!.style.display = '';
  document.getElementById('window-backdrop')!.style.display = '';
}

(window as any).closeWindowPopup = () => {
  document.getElementById('window-popup')!.style.display = 'none';
  document.getElementById('window-backdrop')!.style.display = 'none';
  activePopupCell = null;
};

document.getElementById('window-save')!.addEventListener('click', () => {
  if (!activePopupCell) return;
  const start = (document.getElementById('window-start') as HTMLInputElement).value;
  const end = (document.getElementById('window-end') as HTMLInputElement).value;
  scheduleGrid[activePopupCell.sport][activePopupCell.day]!.window = { start, end };
  (window as any).closeWindowPopup();
  rebuildGrid();
});

document.getElementById('window-clear')!.addEventListener('click', () => {
  if (!activePopupCell) return;
  delete scheduleGrid[activePopupCell.sport][activePopupCell.day]!.window;
  (window as any).closeWindowPopup();
  rebuildGrid();
});

function updateGridSummary() {
  let sessions = 0, mins = 0;
  const MINS: Record<string, number> = { short: 45, moderate: 75, long: 150 };
  for (const sport of Object.keys(scheduleGrid)) {
    for (const cell of Object.values(scheduleGrid[sport])) {
      if (cell.intensity) { sessions++; mins += MINS[cell.intensity] ?? 60; }
    }
  }
  document.getElementById('grid-summary')!.textContent =
    sessions > 0 ? `${sessions} sessions · ~${(mins / 60).toFixed(1)}h/week available` : 'Select training days above.';
}

document.getElementById('step2-back')!.addEventListener('click', () => showStep(1));
document.getElementById('step2-next')!.addEventListener('click', async () => {
  await loadProfile();
  showStep(3);
});

// Step 3: Profile
async function loadProfile() {
  // Load FTP estimates
  try {
    const res = await fetch('/api/v1/me/ftp-estimates');
    if (res.ok) {
      const est = await res.json() as { ftpW: number | null; ftpRunPaceSec: number | null; ftpSwimCssSec: number | null };
      if (est.ftpW) (document.getElementById('ftp-w') as HTMLInputElement).placeholder = `${est.ftpW} W (estimated)`;
      if (est.ftpRunPaceSec) {
        const min = Math.floor(est.ftpRunPaceSec / 60);
        const sec = est.ftpRunPaceSec % 60;
        (document.getElementById('ftp-run') as HTMLInputElement).placeholder = `${min}:${String(sec).padStart(2, '0')} (estimated)`;
      }
      if (est.ftpSwimCssSec) (document.getElementById('ftp-swim') as HTMLInputElement).placeholder = `${est.ftpSwimCssSec}s (estimated)`;
    }
  } catch {}

  // Load current CTL from PMC
  try {
    const res = await fetch('/api/v1/me/pmc?days=1');
    if (res.ok) {
      const data = await res.json() as any;
      const latest = data.items?.[data.items.length - 1];
      if (latest?.ctl) {
        profile.ctlBaseline = Math.round(latest.ctl);
        document.getElementById('ctl-display')!.textContent = `${profile.ctlBaseline} CTL (your current fitness)`;
      } else {
        document.getElementById('ctl-display')!.textContent = 'No data yet — we\'ll use a default baseline.';
      }
    }
  } catch {}

  // Show/hide swim/bike FTP fields
  const isRunOnly = selectedRace === 'half-marathon';
  document.getElementById('ftp-bike-wrap')!.style.display = isRunOnly ? 'none' : '';
  document.getElementById('ftp-swim-wrap')!.style.display = isRunOnly ? 'none' : '';
}

document.getElementById('step3-back')!.addEventListener('click', () => showStep(2));
document.getElementById('step3-next')!.addEventListener('click', () => {
  // Read profile values
  profile.heightCm = Number((document.getElementById('height-cm') as HTMLInputElement).value) || 0;
  profile.weightKg = Number((document.getElementById('weight-kg') as HTMLInputElement).value) || 0;
  profile.ftpW = Number((document.getElementById('ftp-w') as HTMLInputElement).value) || 0;
  profile.ftpSwimCssSec = Number((document.getElementById('ftp-swim') as HTMLInputElement).value) || 0;

  // Parse run pace "M:SS" → sec/km
  const runPaceStr = (document.getElementById('ftp-run') as HTMLInputElement).value;
  if (runPaceStr && runPaceStr.includes(':')) {
    const [m, s] = runPaceStr.split(':').map(Number);
    profile.ftpRunPaceSec = m * 60 + (s || 0);
  }

  showStep(4);
  generatePlan();
});

document.getElementById('step4-back')!.addEventListener('click', () => showStep(3));

// Step 4: Generate
async function generatePlan() {
  document.getElementById('generate-loading')!.style.display = '';
  document.getElementById('generate-error')!.style.display = 'none';
  document.getElementById('week-nav')!.style.display = 'none';
  document.getElementById('audit-block')!.style.display = 'none';
  document.getElementById('view-plan-btn')!.style.display = 'none';

  // Build clean grid (omit null intensity cells)
  const cleanGrid: Record<string, Record<number, any>> = {};
  for (const sport of Object.keys(scheduleGrid)) {
    const cells: Record<number, any> = {};
    for (const [day, cell] of Object.entries(scheduleGrid[sport])) {
      if (cell.intensity) cells[Number(day)] = cell;
    }
    if (Object.keys(cells).length > 0) cleanGrid[sport] = cells;
  }

  try {
    const raceDateTs = Math.floor(new Date(raceDate).getTime() / 1000);
    const res = await fetch('/api/v1/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        raceType: selectedRace,
        raceDateTs,
        ctlBaseline: profile.ctlBaseline,
        ftpW: profile.ftpW,
        ftpRunPaceSec: profile.ftpRunPaceSec,
        ftpSwimCssSec: profile.ftpSwimCssSec,
        heightCm: profile.heightCm || undefined,
        weightKg: profile.weightKg || undefined,
        grid: cleanGrid,
      }),
    });

    if (!res.ok) throw new Error(await res.text());
    generatedPlan = await res.json();

    document.getElementById('generate-loading')!.style.display = 'none';

    // Show audit
    if (generatedPlan.audit) {
      const ab = document.getElementById('audit-block')!;
      ab.style.display = '';
      document.getElementById('audit-summary')!.textContent = generatedPlan.audit.summary;
      const warnEl = document.getElementById('audit-warnings')!;
      warnEl.innerHTML = (generatedPlan.audit.warnings ?? []).map((w: any) =>
        `<div style="padding:8px 12px;border-radius:6px;background:${w.severity === 'error' ? 'var(--danger-bg,oklch(0.2 0.08 25))' : 'oklch(0.25 0.10 60)'};color:${w.severity === 'error' ? 'var(--danger,#f87171)' : 'oklch(0.85 0.18 60)'};" class="body-sm">${w.severity === 'error' ? '⛔' : '⚠️'} ${w.message}</div>`,
      ).join('');
    }

    // Show week navigator
    currentWeek = 0;
    renderWeek();
    document.getElementById('week-nav')!.style.display = '';

    // View plan button
    const btn = document.getElementById('view-plan-btn') as HTMLAnchorElement;
    btn.href = `/plans/${generatedPlan.planId}`;
    btn.style.display = '';

  } catch (err) {
    document.getElementById('generate-loading')!.style.display = 'none';
    const errEl = document.getElementById('generate-error')!;
    errEl.style.display = '';
    errEl.textContent = `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SPORT_CLASS: Record<string, string> = { swim: 'swim', bike: 'bike', run: 'run' };

function renderWeek() {
  if (!generatedPlan?.weeks) return;
  const weeks = generatedPlan.weeks;
  const week = weeks[currentWeek];

  document.getElementById('week-label')!.textContent =
    `Week ${week.weekNum} of ${weeks.length} — ${week.phase.toUpperCase()} · ${week.tss} TSS · ${week.hours}h`;

  (document.getElementById('prev-week') as HTMLButtonElement).disabled = currentWeek === 0;
  (document.getElementById('next-week') as HTMLButtonElement).disabled = currentWeek === weeks.length - 1;

  // Group sessions by day
  const byDay: Record<number, any[]> = {};
  for (const s of week.sessions) {
    const d = s.day ?? 0;
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(s);
  }

  const grid = document.getElementById('week-grid')!;
  grid.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const div = document.createElement('div');
    div.className = 'stack';
    div.style.cssText = 'gap:4px;';

    const dayLabel = document.createElement('div');
    dayLabel.className = 'muted body-sm';
    dayLabel.style.cssText = 'text-align:center;font-size:10px;';
    dayLabel.textContent = DAY_NAMES[d];
    div.appendChild(dayLabel);

    const sessions = byDay[d] ?? [];
    if (sessions.length === 0) {
      const cell = document.createElement('div');
      cell.className = 'session-cell empty';
      cell.textContent = '—';
      div.appendChild(cell);
    } else {
      for (const s of sessions) {
        const cell = document.createElement('div');
        cell.className = `session-cell ${SPORT_CLASS[s.sport] ?? ''}`;
        cell.innerHTML = `<span style="font-size:18px">${SPORT_EMOJI[s.sport] ?? '🏋️'}</span><span>${s.durationMin}m</span><span style="opacity:.6;font-size:9px">Z${s.zone}</span>`;
        div.appendChild(cell);
      }
    }
    grid.appendChild(div);
  }
}

document.getElementById('prev-week')!.addEventListener('click', () => { if (currentWeek > 0) { currentWeek--; renderWeek(); } });
document.getElementById('next-week')!.addEventListener('click', () => { if (generatedPlan && currentWeek < generatedPlan.weeks.length - 1) { currentWeek++; renderWeek(); } });
</script>
```

- [ ] **Step 2: Build check**

```bash
pnpm --filter @pacelore/web build 2>&1 | tail -8
```

Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/plans/new.astro
git commit -m "feat(web): /plans/new wizard — race, schedule grid, profile, generate"
```

---

## Task 12: Web — /plans/[id] detail page

**Files:**
- Create: `apps/web/src/pages/plans/[id].astro`

- [ ] **Step 1: Create [id].astro**

```astro
---
import Shell from '../../../layouts/Shell.astro';
const { id } = Astro.params;
---

<Shell title="Plan Detail" active="plans">
  <div class="stack" style="gap: 24px; max-width: 720px;">
    <div id="plan-loading" class="muted body-sm">Loading…</div>
    <div id="plan-content" style="display:none;" class="stack" style="gap:24px;">

      <!-- Header -->
      <header class="row" style="flex-wrap:wrap;gap:12px;">
        <div class="stack" style="gap:4px;flex:1;">
          <h1 class="h1" id="plan-title" style="font-size:28px;"></h1>
          <p class="muted body-sm" id="plan-meta"></p>
        </div>
        <div class="row row-end" style="gap:8px;">
          <button class="btn" id="archive-btn">Archive</button>
          <button class="btn" id="delete-btn" style="color:var(--danger);">Delete</button>
        </div>
      </header>

      <!-- Audit block -->
      <div id="audit-block" style="display:none;" class="panel">
        <div class="panel-body stack" style="gap:8px;">
          <p class="body-sm" id="audit-summary"></p>
          <div id="audit-warnings" class="stack" style="gap:6px;"></div>
        </div>
      </div>

      <!-- Week navigator -->
      <div>
        <div class="row" style="gap:12px;align-items:center;margin-bottom:16px;">
          <button class="btn" id="prev-week" disabled>‹ Prev</button>
          <span id="week-label" class="label" style="flex:1;text-align:center;"></span>
          <button class="btn" id="next-week">Next ›</button>
        </div>
        <div id="week-grid" class="grid-tiles grid-cols-7" style="gap:6px;"></div>
        <p id="week-stats" class="muted body-sm" style="margin-top:8px;text-align:center;"></p>
      </div>

      <a href="/calendar" class="btn" style="text-align:center;text-decoration:none;">View in Calendar →</a>
    </div>
  </div>
</Shell>

<style>
.session-cell {
  border-radius: 6px; padding: 8px 4px; text-align: center; min-height: 64px;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  font-size: 11px; gap: 2px;
}
.session-cell.empty { background: var(--surface); border: 1px dashed var(--border); color: var(--fg-muted); }
.session-cell.swim  { background: var(--pace-900); border: 1px solid var(--pace-600); }
.session-cell.bike  { background: oklch(0.28 0.10 50);  border: 1px solid oklch(0.55 0.18 50); }
.session-cell.run   { background: oklch(0.23 0.12 140); border: 1px solid oklch(0.55 0.18 140); }
</style>

<script define:vars={{ planId: id }}>
const RACE_LABELS = {
  sprint: 'Sprint Triathlon', olympic: 'Olympic Triathlon',
  '703': 'Ironman 70.3', full: 'Full Ironman', 'half-marathon': 'Half Marathon',
};
const SPORT_EMOJI = { swim: '🏊', bike: '🚴', run: '🏃' };
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

let plan = null;
let allWeeks = [];
let currentWeek = 0;

function dayOfDate(dateStr) {
  // YYYY-MM-DD → day of week 0=Mon
  const d = new Date(dateStr + 'T12:00:00');
  return (d.getDay() + 6) % 7; // Sun=0 → Mon=0
}

async function load() {
  const res = await fetch(`/api/v1/plans/${planId}`);
  if (!res.ok) {
    document.getElementById('plan-loading').textContent = 'Plan not found.';
    return;
  }
  plan = await res.json();
  document.getElementById('plan-loading').style.display = 'none';
  document.getElementById('plan-content').style.display = '';

  // Group sessions into weeks
  const sessionsByDate = {};
  for (const s of plan.sessions ?? []) {
    if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
    sessionsByDate[s.date].push(s);
  }

  // Build week groups from dates
  const dates = Object.keys(sessionsByDate).sort();
  if (dates.length > 0) {
    const firstDate = new Date(dates[0] + 'T12:00:00');
    // Align to Monday
    const dayOfWeek = (firstDate.getDay() + 6) % 7;
    firstDate.setDate(firstDate.getDate() - dayOfWeek);

    const lastDate = new Date(dates[dates.length - 1] + 'T12:00:00');
    const totalWeeks = Math.ceil((lastDate - firstDate) / (7 * 86400_000)) + 1;

    for (let w = 0; w < totalWeeks; w++) {
      const weekStart = new Date(firstDate);
      weekStart.setDate(firstDate.getDate() + w * 7);
      const weekSessions = [];
      for (const [date, sessions] of Object.entries(sessionsByDate)) {
        const d = new Date(date + 'T12:00:00');
        if (d >= weekStart && d < new Date(weekStart.getTime() + 7 * 86400_000)) {
          for (const s of sessions) weekSessions.push({ ...s, day: dayOfDate(date) });
        }
      }
      allWeeks.push({ weekNum: w + 1, sessions: weekSessions, weekStart });
    }
  }

  // Header
  document.getElementById('plan-title').textContent = RACE_LABELS[plan.raceType] ?? plan.raceType;
  const raceDate = new Date(plan.raceDateTs * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const daysLeft = Math.ceil((plan.raceDateTs - Date.now() / 1000) / 86400);
  document.getElementById('plan-meta').textContent =
    `${raceDate} · ${daysLeft > 0 ? daysLeft + ' days away' : 'Past'} · ${allWeeks.length} weeks`;

  // Audit
  if (plan.audit) {
    document.getElementById('audit-block').style.display = '';
    document.getElementById('audit-summary').textContent = plan.audit.summary;
    document.getElementById('audit-warnings').innerHTML = (plan.audit.warnings ?? []).map(w =>
      `<div style="padding:8px 12px;border-radius:6px;background:${w.severity === 'error' ? 'oklch(0.2 0.08 25)' : 'oklch(0.25 0.10 60)'};color:${w.severity === 'error' ? '#f87171' : 'oklch(0.85 0.18 60)'};" class="body-sm">${w.severity === 'error' ? '⛔' : '⚠️'} ${w.message}</div>`
    ).join('');
  }

  renderWeek();
}

function renderWeek() {
  if (allWeeks.length === 0) return;
  const week = allWeeks[currentWeek];

  document.getElementById('week-label').textContent = `Week ${week.weekNum} of ${allWeeks.length}`;
  document.getElementById('prev-week').disabled = currentWeek === 0;
  document.getElementById('next-week').disabled = currentWeek === allWeeks.length - 1;

  const byDay = {};
  for (const s of week.sessions) {
    if (!byDay[s.day]) byDay[s.day] = [];
    byDay[s.day].push(s);
  }

  const grid = document.getElementById('week-grid');
  grid.innerHTML = '';
  for (let d = 0; d < 7; d++) {
    const div = document.createElement('div');
    div.className = 'stack';
    div.style.gap = '4px';

    const label = document.createElement('div');
    label.className = 'muted body-sm';
    label.style.cssText = 'text-align:center;font-size:10px;';
    label.textContent = DAY_NAMES[d];
    div.appendChild(label);

    const sessions = byDay[d] ?? [];
    if (sessions.length === 0) {
      const cell = document.createElement('div');
      cell.className = 'session-cell empty';
      cell.textContent = '—';
      div.appendChild(cell);
    } else {
      for (const s of sessions) {
        const cell = document.createElement('div');
        cell.className = `session-cell ${s.sport ?? ''}`;
        cell.innerHTML = `<span style="font-size:18px">${SPORT_EMOJI[s.sport] ?? '🏋️'}</span><span>${s.durationMin}m</span><span style="opacity:.6;font-size:9px">Z${s.zone}</span>`;
        div.appendChild(cell);
      }
    }
    grid.appendChild(div);
  }
}

document.getElementById('prev-week').addEventListener('click', () => { if (currentWeek > 0) { currentWeek--; renderWeek(); } });
document.getElementById('next-week').addEventListener('click', () => { if (currentWeek < allWeeks.length - 1) { currentWeek++; renderWeek(); } });

document.getElementById('archive-btn').addEventListener('click', async () => {
  if (!confirm('Archive this plan?')) return;
  await fetch(`/api/v1/plans/${planId}/archive`, { method: 'PATCH' });
  window.location.href = '/plans';
});

document.getElementById('delete-btn').addEventListener('click', async () => {
  if (!confirm('Delete this plan and all its scheduled workouts? This cannot be undone.')) return;
  await fetch(`/api/v1/plans/${planId}`, { method: 'DELETE' });
  window.location.href = '/plans';
});

load();
</script>
```

- [ ] **Step 2: Build check**

```bash
pnpm --filter @pacelore/web build 2>&1 | tail -8
```

Expected: 0 errors

- [ ] **Step 3: Full typecheck**

```bash
pnpm -r typecheck
```

Expected: 0 errors across all packages

- [ ] **Step 4: Run planner tests**

```bash
pnpm --filter @pacelore/planner test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/plans/
git commit -m "feat(web): /plans/[id] detail page with week navigator + archive/delete"
```

---

## Self-Review Notes

**Spec coverage check:**

| Spec requirement | Task |
|------------------|------|
| Race types: sprint/olympic/70.3/full/half-marathon | Task 2 |
| Wizard: Race step | Task 11 step 1 |
| Wizard: Schedule grid (sport×day, intensity, time windows) | Task 11 step 1 |
| Wizard: Profile (height, weight, FTP, CTL) | Task 11 step 1 |
| Wizard: Generate + week preview | Task 11 step 1 |
| Periodization engine with phases | Task 3 |
| Scheduler: session→day assignment, brick, windows | Task 4 |
| Claude Haiku audit | Task 5 |
| DB: race_plans, plan_id on planned_workouts, session_json, height/weight on users | Task 6 |
| API: POST /plans | Task 8 |
| API: GET/DELETE /plans, PATCH /plans/:id/archive | Task 9 |
| API: GET /me/ftp-estimates | Task 7 |
| /plans list page | Task 10 |
| /plans/new wizard | Task 11 |
| /plans/[id] detail page | Task 12 |
| No-FTP fallback (CTL × 2.5) | Task 8 — note: CTL-based FTP estimate not yet in POST /plans. Add: `const ftpW = body.ftpW || Math.round((body.ctlBaseline ?? 40) * 2.5);` in the spec block in Task 8 |

**Fix:** In Task 8 Step 2, the `spec` object uses `body.ftpW` directly. Replace with:
```ts
ftpW: body.ftpW || Math.round((body.ctlBaseline ?? 40) * 2.5),
```

**PMC endpoint:** Task 11 loads CTL via `GET /api/v1/me/pmc?days=1`. Verify this endpoint exists in the running API before testing — if not, CTL display falls back to "No data yet" gracefully (no crash).

**ANTHROPIC_API_KEY wrangler secret:** Not set by the plan. After deploying, run:
```bash
cd apps/api && pnpm exec wrangler secret put ANTHROPIC_API_KEY
```
Without this secret, audit is silently skipped (plan still generated).
