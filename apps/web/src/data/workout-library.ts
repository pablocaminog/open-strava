/**
 * Starter workout library — 60 sessions across cycling, running, swimming.
 *
 * Coverage: 20 per sport, mix of zones 1–5, mix of <30 min / 30–60 min / >60 min.
 * Sources are the well-known canon: Coggan power-zone sessions, Norwegian
 * threshold intervals, classic running staples (Yasso 800s, Mona fartlek,
 * cruise intervals), Swim Smooth CSS sets, USA Swimming aerobic ladders.
 *
 * Targets:
 *   cycling = ftp_pct (% of FTP)
 *   running, swimming = hr_pct (% of HRmax) — keeps the library portable
 *   even when the athlete hasn't set a threshold pace.
 */

export interface WorkoutStepDef {
  kind: 'warmup' | 'work' | 'recover' | 'cooldown' | 'rest';
  durationSec?: number;
  distM?: number;
  target?: { type: 'ftp_pct' | 'hr_pct' | 'pace'; low: number; high: number };
  repeat?: number;
  children?: WorkoutStepDef[];
}

export interface WorkoutDef {
  name: string;
  description: string;
  sport: 'cycling' | 'running' | 'swimming';
  steps: WorkoutStepDef[];
}

const Z1_HR = { type: 'hr_pct', low: 60, high: 72 } as const;
const Z2_HR = { type: 'hr_pct', low: 73, high: 82 } as const;
const Z3_HR = { type: 'hr_pct', low: 83, high: 87 } as const;
const Z4_HR = { type: 'hr_pct', low: 88, high: 92 } as const;
const Z5_HR = { type: 'hr_pct', low: 93, high: 100 } as const;

const Z1_FTP = { type: 'ftp_pct', low: 50, high: 65 } as const;
const Z2_FTP = { type: 'ftp_pct', low: 66, high: 80 } as const;
const Z3_FTP = { type: 'ftp_pct', low: 81, high: 90 } as const;
const Z4_FTP = { type: 'ftp_pct', low: 91, high: 105 } as const;
const Z5_FTP = { type: 'ftp_pct', low: 106, high: 120 } as const;

export const WORKOUT_LIBRARY: WorkoutDef[] = [
  // ============================================================
  // CYCLING — 20
  // ============================================================
  {
    name: 'Recovery spin',
    description: 'Easy spin to flush the legs. Light gear, smooth cadence (90+). Z1 throughout.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 300, target: Z1_FTP },
      { kind: 'work', durationSec: 1200, target: Z1_FTP },
    ],
  },
  {
    name: 'Endurance 45',
    description: 'Steady aerobic 45-minute spin. Hold Z2 — chatty pace. Conversational.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      { kind: 'work', durationSec: 1800, target: Z2_FTP },
      { kind: 'cooldown', durationSec: 300, target: Z1_FTP },
    ],
  },
  {
    name: 'Long endurance · 2h',
    description: 'Classic Z2 base ride. Pure aerobic. No surges, no shortcuts.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      { kind: 'work', durationSec: 6000, target: Z2_FTP },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Sweet spot 2×10',
    description: 'Coggan sweet-spot — high aerobic without the cost of threshold. 88–92% FTP.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 2,
        children: [
          { kind: 'work', durationSec: 600, target: { type: 'ftp_pct', low: 88, high: 92 } },
          { kind: 'recover', durationSec: 300, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 300, target: Z1_FTP },
    ],
  },
  {
    name: 'Sweet spot 3×12',
    description: 'Bigger sweet-spot block. 88–92% FTP. The bread-and-butter midweek FTP builder.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 3,
        children: [
          { kind: 'work', durationSec: 720, target: { type: 'ftp_pct', low: 88, high: 92 } },
          { kind: 'recover', durationSec: 240, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Threshold 2×20',
    description: 'The classic FTP test/build. 95–100% FTP. Steady output, controlled breathing.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 2,
        children: [
          { kind: 'work', durationSec: 1200, target: { type: 'ftp_pct', low: 95, high: 100 } },
          { kind: 'recover', durationSec: 600, target: Z2_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Threshold 4×8',
    description: 'Punchier threshold session — slightly above FTP. 99–104%. Recover fully between.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 4,
        children: [
          { kind: 'work', durationSec: 480, target: { type: 'ftp_pct', low: 99, high: 104 } },
          { kind: 'recover', durationSec: 180, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Over-unders 5×6',
    description: 'Lactate-clearance work. Alternate 1 min over (105%) / 1 min under (95%) ×3 per set.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 5,
        children: [
          {
            kind: 'work',
            repeat: 3,
            children: [
              { kind: 'work', durationSec: 60, target: { type: 'ftp_pct', low: 103, high: 108 } },
              { kind: 'work', durationSec: 60, target: { type: 'ftp_pct', low: 92, high: 96 } },
            ],
          },
          { kind: 'recover', durationSec: 180, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'VO2 max 5×5',
    description: 'Old-school VO2 — five minutes at 110–115% FTP, equal recovery. Painful but cheap.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 5,
        children: [
          { kind: 'work', durationSec: 300, target: { type: 'ftp_pct', low: 110, high: 115 } },
          { kind: 'recover', durationSec: 300, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'VO2 short 6×3',
    description: 'Short sharp VO2 reps at 115–120% FTP. Equal recovery. Big aerobic stress.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', durationSec: 180, target: { type: 'ftp_pct', low: 115, high: 120 } },
          { kind: 'recover', durationSec: 180, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 360, target: Z1_FTP },
    ],
  },
  {
    name: 'Tabata 8×20s',
    description: 'Tabata-style anaerobic capacity. 20s flat-out, 10s rest, 8 rounds. <30 min total.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 8,
        children: [
          { kind: 'work', durationSec: 20, target: { type: 'ftp_pct', low: 130, high: 170 } },
          { kind: 'rest', durationSec: 10, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 300, target: Z1_FTP },
    ],
  },
  {
    name: 'Spin-up cadence drill',
    description: 'High-cadence neuromuscular session. 110–120 rpm. Z1 power, smooth pedal stroke.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 300, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 5,
        children: [
          { kind: 'work', durationSec: 60, target: Z1_FTP },
          { kind: 'recover', durationSec: 60, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 300, target: Z1_FTP },
    ],
  },
  {
    name: 'Anaerobic 30/30',
    description: 'Billat-style 30s on / 30s off ×12. 130% FTP. Build top-end and aerobic ceiling.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 12,
        children: [
          { kind: 'work', durationSec: 30, target: { type: 'ftp_pct', low: 125, high: 140 } },
          { kind: 'recover', durationSec: 30, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Pyramid 1-2-3-4-3-2-1',
    description: 'Pyramid intervals. Z3 → Z5 → Z3 with equal recoveries. Builds repeatability.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      { kind: 'work', durationSec: 60, target: Z3_FTP },
      { kind: 'recover', durationSec: 60, target: Z1_FTP },
      { kind: 'work', durationSec: 120, target: Z4_FTP },
      { kind: 'recover', durationSec: 120, target: Z1_FTP },
      { kind: 'work', durationSec: 180, target: Z4_FTP },
      { kind: 'recover', durationSec: 180, target: Z1_FTP },
      { kind: 'work', durationSec: 240, target: Z5_FTP },
      { kind: 'recover', durationSec: 240, target: Z1_FTP },
      { kind: 'work', durationSec: 180, target: Z4_FTP },
      { kind: 'recover', durationSec: 180, target: Z1_FTP },
      { kind: 'work', durationSec: 120, target: Z4_FTP },
      { kind: 'recover', durationSec: 120, target: Z1_FTP },
      { kind: 'work', durationSec: 60, target: Z3_FTP },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Hill repeats 6×3',
    description: 'Standing/seated alternating 3-min hill efforts at 105–115% FTP. Mix posture each rep.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', durationSec: 180, target: { type: 'ftp_pct', low: 105, high: 115 } },
          { kind: 'recover', durationSec: 180, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 540, target: Z1_FTP },
    ],
  },
  {
    name: 'Sub-threshold 4×12',
    description: 'Long sub-threshold blocks. 92–96% FTP. The "second-most-bang-for-buck" session.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 4,
        children: [
          { kind: 'work', durationSec: 720, target: { type: 'ftp_pct', low: 92, high: 96 } },
          { kind: 'recover', durationSec: 240, target: Z2_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Tempo 3×15',
    description: 'Tempo blocks at 80–86% FTP. Builds muscular endurance and fat oxidation.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 3,
        children: [
          { kind: 'work', durationSec: 900, target: { type: 'ftp_pct', low: 80, high: 86 } },
          { kind: 'recover', durationSec: 300, target: Z2_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Big-gear strength',
    description: 'Low cadence (50–60 rpm) high-torque work. Builds force production. Save for off-season.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', durationSec: 240, target: Z4_FTP },
          { kind: 'recover', durationSec: 120, target: Z1_FTP },
        ],
      },
      { kind: 'cooldown', durationSec: 540, target: Z1_FTP },
    ],
  },
  {
    name: 'Z2 sandwich · 2h',
    description: '90 min Z2 sandwiching a 10-min tempo block. Long aerobic with one tempo bite.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_FTP },
      { kind: 'work', durationSec: 2700, target: Z2_FTP },
      { kind: 'work', durationSec: 600, target: { type: 'ftp_pct', low: 80, high: 86 } },
      { kind: 'work', durationSec: 2700, target: Z2_FTP },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },
  {
    name: 'Race simulation 90',
    description: 'Steady Z2 with 6 race-pace surges. Practice the pattern of a road race.',
    sport: 'cycling',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_FTP },
      { kind: 'work', durationSec: 1800, target: Z2_FTP },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', durationSec: 60, target: Z5_FTP },
          { kind: 'recover', durationSec: 60, target: Z1_FTP },
        ],
      },
      { kind: 'work', durationSec: 1800, target: Z2_FTP },
      { kind: 'cooldown', durationSec: 600, target: Z1_FTP },
    ],
  },

  // ============================================================
  // RUNNING — 20
  // ============================================================
  {
    name: 'Easy 25',
    description: 'Conversational easy run. Z1–Z2. Build aerobic base without cost.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 300, target: Z1_HR },
      { kind: 'work', durationSec: 1200, target: Z2_HR },
      { kind: 'cooldown', durationSec: 0 },
    ],
  },
  {
    name: 'Easy 45',
    description: 'Aerobic 45-min run. Mostly Z2. The default midweek effort.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 300, target: Z1_HR },
      { kind: 'work', durationSec: 2400, target: Z2_HR },
      { kind: 'cooldown', durationSec: 300, target: Z1_HR },
    ],
  },
  {
    name: 'Long run · 90 min',
    description: 'Sunday long run. Pure Z2 aerobic. No heroics — get the time on feet.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_HR },
      { kind: 'work', durationSec: 4500, target: Z2_HR },
      { kind: 'cooldown', durationSec: 300, target: Z1_HR },
    ],
  },
  {
    name: 'Recovery jog',
    description: 'Active recovery. 20 min Z1. Slower than feels right. The day after a hard session.',
    sport: 'running',
    steps: [{ kind: 'work', durationSec: 1200, target: Z1_HR }],
  },
  {
    name: 'Yasso 800s',
    description: 'Bart Yasso classic — 10×800m at goal-marathon-time-as-minutes. 400m jog recovery.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 10,
        children: [
          { kind: 'work', distM: 800, target: Z4_HR },
          { kind: 'recover', distM: 400, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Tempo 20',
    description: 'Continuous 20-min tempo at Z3. "Comfortably hard". Builds lactate threshold.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_HR },
      { kind: 'work', durationSec: 1200, target: Z3_HR },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Threshold 4×1 mile',
    description: 'Daniels-style cruise intervals. 4×1 mile at Z4 with 60s jog recovery.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 4,
        children: [
          { kind: 'work', distM: 1609, target: Z4_HR },
          { kind: 'recover', durationSec: 60, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Cruise intervals 3×2 km',
    description: '3×2 km at threshold. 3 min jog between. The ladder up to half-marathon racing.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 3,
        children: [
          { kind: 'work', distM: 2000, target: Z4_HR },
          { kind: 'recover', durationSec: 180, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'VO2 short 8×400',
    description: '8×400 m at 5k pace. 90s recovery. The classic VO2 max session.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 8,
        children: [
          { kind: 'work', distM: 400, target: Z5_HR },
          { kind: 'recover', durationSec: 90, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'VO2 long 5×1 km',
    description: '5×1 km at 3–5k pace. 3 min jog recovery. Full VO2 max stress.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 5,
        children: [
          { kind: 'work', distM: 1000, target: Z5_HR },
          { kind: 'recover', durationSec: 180, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Hill sprints 10×30s',
    description: '10×30s steep hill, walk down recovery. Strength + neuromuscular. Low injury risk.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_HR },
      {
        kind: 'work',
        repeat: 10,
        children: [
          { kind: 'work', durationSec: 30, target: Z5_HR },
          { kind: 'recover', durationSec: 90, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Strides session',
    description: 'Easy run with 6×20s strides at end. Improves form and turnover. Weekly staple.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 1200, target: Z1_HR },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', durationSec: 20, target: Z5_HR },
          { kind: 'recover', durationSec: 60, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 480, target: Z1_HR },
    ],
  },
  {
    name: 'Fartlek 30',
    description: 'Swedish "speed play". 10×(60s on / 120s off) over 30 min. Unstructured Z4–Z5.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_HR },
      {
        kind: 'work',
        repeat: 10,
        children: [
          { kind: 'work', durationSec: 60, target: Z4_HR },
          { kind: 'recover', durationSec: 120, target: Z2_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 360, target: Z1_HR },
    ],
  },
  {
    name: 'Norwegian threshold 5×6',
    description: 'Sub-threshold blocks à la Ingebrigtsen. 5×6 min at low-Z4 with 60s jog. Lactate ≤3 mmol.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 5,
        children: [
          { kind: 'work', durationSec: 360, target: { type: 'hr_pct', low: 86, high: 89 } },
          { kind: 'recover', durationSec: 60, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Marathon-pace 90',
    description: '90-min run with 75 min at marathon pace (Z3). Specific aerobic endurance.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      { kind: 'work', durationSec: 4500, target: Z3_HR },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Long run with surges',
    description: '110-min long run with 8×60s surges in the back half. Race-specific fatigue resistance.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_HR },
      { kind: 'work', durationSec: 1800, target: Z2_HR },
      {
        kind: 'work',
        repeat: 8,
        children: [
          { kind: 'work', durationSec: 60, target: Z4_HR },
          { kind: 'work', durationSec: 240, target: Z2_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Mona fartlek',
    description: 'Steve Moneghetti session. 2×6 min total: 90/90, 60/60, 30/30, 15/15. Hard/float.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 2,
        children: [
          { kind: 'work', durationSec: 90, target: Z5_HR },
          { kind: 'work', durationSec: 90, target: Z2_HR },
          { kind: 'work', durationSec: 60, target: Z5_HR },
          { kind: 'work', durationSec: 60, target: Z2_HR },
          { kind: 'work', durationSec: 30, target: Z5_HR },
          { kind: 'work', durationSec: 30, target: Z2_HR },
          { kind: 'work', durationSec: 15, target: Z5_HR },
          { kind: 'work', durationSec: 15, target: Z2_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: '1k repeats 6×',
    description: '6×1 km at 10k pace. 200m jog recovery. Rep-pace work — turnover and economy.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 900, target: Z1_HR },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', distM: 1000, target: Z4_HR },
          { kind: 'recover', distM: 200, target: Z1_HR },
        ],
      },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },
  {
    name: 'Steady state 50',
    description: '50-min run with 30 min at upper Z2 / lower Z3. The aerobic backbone of marathon prep.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 300, target: Z1_HR },
      { kind: 'work', durationSec: 1800, target: { type: 'hr_pct', low: 78, high: 84 } },
      { kind: 'cooldown', durationSec: 300, target: Z1_HR },
    ],
  },
  {
    name: 'Half-marathon-pace 80',
    description: '80-min run with 60 min at half-marathon pace (Z3–Z4). Sharpening for race day.',
    sport: 'running',
    steps: [
      { kind: 'warmup', durationSec: 600, target: Z1_HR },
      { kind: 'work', durationSec: 3600, target: { type: 'hr_pct', low: 84, high: 89 } },
      { kind: 'cooldown', durationSec: 600, target: Z1_HR },
    ],
  },

  // ============================================================
  // SWIMMING — 20
  // ============================================================
  {
    name: 'Easy 1k',
    description: 'Easy aerobic swim. 200 wu / 600 swim Z2 / 200 cd. Form-focused, smooth catch.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 200, target: Z1_HR },
      { kind: 'work', distM: 600, target: Z2_HR },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Aerobic 1500',
    description: 'Steady aerobic 1500 m. 300 wu / 900 Z2 / 300 cd. Build base without high stress.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 300, target: Z1_HR },
      { kind: 'work', distM: 900, target: Z2_HR },
      { kind: 'cooldown', distM: 300, target: Z1_HR },
    ],
  },
  {
    name: 'Long aerobic 3000',
    description: 'Long aerobic — 3000 m at Z2. Triathlon-distance steady swim.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      { kind: 'work', distM: 2200, target: Z2_HR },
      { kind: 'cooldown', distM: 400, target: Z1_HR },
    ],
  },
  {
    name: 'Recovery 800',
    description: 'Active recovery swim. 800 m easy. Loose stroke, no clock.',
    sport: 'swimming',
    steps: [{ kind: 'work', distM: 800, target: Z1_HR }],
  },
  {
    name: 'CSS 8×100',
    description: 'Critical Swim Speed set. 8×100 at CSS pace (~Z4 HR). 15s rest. The benchmark threshold workout.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      {
        kind: 'work',
        repeat: 8,
        children: [
          { kind: 'work', distM: 100, target: Z4_HR },
          { kind: 'rest', durationSec: 15 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'CSS 6×200',
    description: '6×200 at CSS. 20s rest. Longer reps test pacing discipline at threshold.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', distM: 200, target: Z4_HR },
          { kind: 'rest', durationSec: 20 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Threshold 4×400',
    description: '4×400 at threshold pace. 30s rest. Open-water race-specific.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      {
        kind: 'work',
        repeat: 4,
        children: [
          { kind: 'work', distM: 400, target: Z4_HR },
          { kind: 'rest', durationSec: 30 },
        ],
      },
      { kind: 'cooldown', distM: 400, target: Z1_HR },
    ],
  },
  {
    name: 'Pyramid 50-100-200-100-50',
    description: 'Pyramid build. 50 fast / 100 / 200 / 100 / 50, all at Z3–Z5 with 15s rest.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 300, target: Z1_HR },
      { kind: 'work', distM: 50, target: Z5_HR },
      { kind: 'rest', durationSec: 15 },
      { kind: 'work', distM: 100, target: Z4_HR },
      { kind: 'rest', durationSec: 15 },
      { kind: 'work', distM: 200, target: Z3_HR },
      { kind: 'rest', durationSec: 20 },
      { kind: 'work', distM: 100, target: Z4_HR },
      { kind: 'rest', durationSec: 15 },
      { kind: 'work', distM: 50, target: Z5_HR },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Sprint 10×50',
    description: '10×50 sprint with 30s rest. Anaerobic top-end. Form holds at speed.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 300, target: Z1_HR },
      {
        kind: 'work',
        repeat: 10,
        children: [
          { kind: 'work', distM: 50, target: Z5_HR },
          { kind: 'rest', durationSec: 30 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Drill ladder 1600',
    description: 'Technique session — 4×(100 catch-up drill / 100 swim Z2). Stroke length focus.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 200, target: Z1_HR },
      {
        kind: 'work',
        repeat: 4,
        children: [
          { kind: 'work', distM: 100, target: Z1_HR },
          { kind: 'work', distM: 100, target: Z2_HR },
          { kind: 'rest', durationSec: 15 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Long swim 4000',
    description: 'Long aerobic swim — 4000 m total. Pacing test for open-water events.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      { kind: 'work', distM: 3200, target: Z2_HR },
      { kind: 'cooldown', distM: 400, target: Z1_HR },
    ],
  },
  {
    name: 'IM 5×200',
    description: 'Mixed strokes — 5×(50 fly / 50 back / 50 breast / 50 free) at Z2–Z3. Builds versatility.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 200, target: Z1_HR },
      {
        kind: 'work',
        repeat: 5,
        children: [
          { kind: 'work', distM: 200, target: Z3_HR },
          { kind: 'rest', durationSec: 20 },
        ],
      },
      { kind: 'cooldown', distM: 100, target: Z1_HR },
    ],
  },
  {
    name: 'Negative-split 6×200',
    description: '6×200 with first 100 at Z3, second 100 at Z4. 20s rest. Pacing discipline.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      {
        kind: 'work',
        repeat: 6,
        children: [
          { kind: 'work', distM: 100, target: Z3_HR },
          { kind: 'work', distM: 100, target: Z4_HR },
          { kind: 'rest', durationSec: 20 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Race-pace 10×100',
    description: '10×100 at race pace (Z4). 10s rest. Open-water 1500/Olympic-tri prep.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      {
        kind: 'work',
        repeat: 10,
        children: [
          { kind: 'work', distM: 100, target: Z4_HR },
          { kind: 'rest', durationSec: 10 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Aerobic 2×800',
    description: '2×800 at Z2 with 60s rest. Solid aerobic block, low stress.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 200, target: Z1_HR },
      {
        kind: 'work',
        repeat: 2,
        children: [
          { kind: 'work', distM: 800, target: Z2_HR },
          { kind: 'rest', durationSec: 60 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Easy recovery 1200',
    description: '1200 m easy — Z1 throughout. Day-after-hard recovery swim.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 200, target: Z1_HR },
      { kind: 'work', distM: 800, target: Z1_HR },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Lactate 16×25',
    description: '16×25 sprint with 30s rest. Pure top-end. Hold form even when burning.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 300, target: Z1_HR },
      {
        kind: 'work',
        repeat: 16,
        children: [
          { kind: 'work', distM: 25, target: Z5_HR },
          { kind: 'rest', durationSec: 30 },
        ],
      },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Build 5×400',
    description: '5×400 building each 100 from Z2 to Z4. 30s rest. Pacing + aerobic capacity.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      {
        kind: 'work',
        repeat: 5,
        children: [
          { kind: 'work', distM: 100, target: Z2_HR },
          { kind: 'work', distM: 100, target: Z3_HR },
          { kind: 'work', distM: 100, target: Z3_HR },
          { kind: 'work', distM: 100, target: Z4_HR },
          { kind: 'rest', durationSec: 30 },
        ],
      },
      { kind: 'cooldown', distM: 400, target: Z1_HR },
    ],
  },
  {
    name: 'Race sim 1500',
    description: 'Open-water race sim. 1500 continuous at Z3–Z4. Sight every 6 strokes.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 300, target: Z1_HR },
      { kind: 'work', distM: 1500, target: Z4_HR },
      { kind: 'cooldown', distM: 200, target: Z1_HR },
    ],
  },
  {
    name: 'Marathon swim base 5000',
    description: '5000 m aerobic. The marathon-swim weekly anchor. Z2 throughout.',
    sport: 'swimming',
    steps: [
      { kind: 'warmup', distM: 400, target: Z1_HR },
      { kind: 'work', distM: 4200, target: Z2_HR },
      { kind: 'cooldown', distM: 400, target: Z1_HR },
    ],
  },
];
