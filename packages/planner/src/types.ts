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
