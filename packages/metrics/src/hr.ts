/**
 * Heart-rate metrics.
 *
 * Zones — Karvonen / HRR (Heart Rate Reserve):
 *   HRR              = hrMax - hrRest
 *   target(percent)  = hrRest + (percent / 100) * HRR
 *
 *   Z1 50–60%   recovery
 *   Z2 60–70%   endurance
 *   Z3 70–80%   tempo
 *   Z4 80–90%   threshold
 *   Z5 90–100%  VO2max
 *
 * TRIMP (Banister):
 *   TRIMP = Σ dt_minutes * hrr_frac * 0.64 * e^(1.92 * hrr_frac)   (male)
 *           Σ dt_minutes * hrr_frac * 0.86 * e^(1.67 * hrr_frac)   (female)
 *
 * Pw:HR decoupling — first half vs second half ratio drift,
 * expressed as a percentage. Positive = HR drift relative to power.
 */

export interface HrZoneConfig {
  hrMax: number;
  hrRest: number;
}

export interface HrSample {
  /** Seconds since activity start. */
  t: number;
  /** Heart rate in bpm. null/undefined = gap. */
  hr: number | null | undefined;
}

export interface HrZoneTimes {
  /** Seconds spent in each zone, indexed Z1..Z5 = [0..4]. */
  seconds: [number, number, number, number, number];
  totalSeconds: number;
}

const ZONE_BOUNDS = [
  [0.5, 0.6],
  [0.6, 0.7],
  [0.7, 0.8],
  [0.8, 0.9],
  [0.9, 1.0],
] as const;

function zoneIndex(hr: number, hrMax: number, hrRest: number): number {
  if (hrMax <= hrRest) return -1;
  const frac = (hr - hrRest) / (hrMax - hrRest);
  for (let i = 0; i < ZONE_BOUNDS.length; i++) {
    const [lo, hi] = ZONE_BOUNDS[i]!;
    // Final zone uses inclusive upper bound to capture HR == HRmax.
    const inclusive = i === ZONE_BOUNDS.length - 1;
    if (frac >= lo && (inclusive ? frac <= hi : frac < hi)) return i;
  }
  return frac < ZONE_BOUNDS[0]![0] ? 0 : ZONE_BOUNDS.length - 1;
}

export function timeInZones(samples: HrSample[], cfg: HrZoneConfig): HrZoneTimes {
  if (cfg.hrMax <= cfg.hrRest) throw new Error('hrMax must exceed hrRest');
  const out: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i]!;
    if (typeof cur.hr !== 'number' || !Number.isFinite(cur.hr)) continue;
    const next = samples[i + 1];
    const dt = next ? Math.max(0, next.t - cur.t) : 1;
    const z = zoneIndex(cur.hr, cfg.hrMax, cfg.hrRest);
    if (z >= 0 && z < out.length) {
      out[z] = (out[z] ?? 0) + dt;
      total += dt;
    }
  }
  return { seconds: out, totalSeconds: total };
}

export type Sex = 'male' | 'female';

export function trimp(samples: HrSample[], cfg: HrZoneConfig, sex: Sex = 'male'): number {
  if (cfg.hrMax <= cfg.hrRest) throw new Error('hrMax must exceed hrRest');
  const a = sex === 'male' ? 0.64 : 0.86;
  const b = sex === 'male' ? 1.92 : 1.67;
  let acc = 0;
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i]!;
    if (typeof cur.hr !== 'number' || !Number.isFinite(cur.hr)) continue;
    const next = samples[i + 1];
    const dtMin = (next ? Math.max(0, next.t - cur.t) : 1) / 60;
    if (dtMin === 0) continue;
    const frac = Math.min(1, Math.max(0, (cur.hr - cfg.hrRest) / (cfg.hrMax - cfg.hrRest)));
    acc += dtMin * frac * a * Math.exp(b * frac);
  }
  return acc;
}

export interface DecouplingSample {
  t: number;
  /** Numerator stream (e.g. power for cycling, pace for running). */
  num: number | null | undefined;
  /** Denominator stream (heart rate). */
  hr: number | null | undefined;
}

export interface DecouplingResult {
  firstHalfRatio: number;
  secondHalfRatio: number;
  /** Positive = drift, expressed as a percentage of the first-half ratio. */
  decouplingPercent: number;
}

/**
 * Pw:HR (or Pa:HR) decoupling. Split the activity at its temporal
 * midpoint, compute mean(num)/mean(hr) per half, return the percentage
 * change relative to the first half.
 */
export function decoupling(samples: DecouplingSample[]): DecouplingResult {
  if (samples.length < 2) {
    return { firstHalfRatio: 0, secondHalfRatio: 0, decouplingPercent: 0 };
  }
  const tStart = samples[0]!.t;
  const tEnd = samples[samples.length - 1]!.t;
  const mid = tStart + (tEnd - tStart) / 2;

  let n1Num = 0;
  let n1Hr = 0;
  let n1 = 0;
  let n2Num = 0;
  let n2Hr = 0;
  let n2 = 0;

  for (const s of samples) {
    if (
      typeof s.num !== 'number' ||
      !Number.isFinite(s.num) ||
      typeof s.hr !== 'number' ||
      !Number.isFinite(s.hr) ||
      s.hr <= 0
    ) {
      continue;
    }
    if (s.t < mid) {
      n1Num += s.num;
      n1Hr += s.hr;
      n1++;
    } else {
      n2Num += s.num;
      n2Hr += s.hr;
      n2++;
    }
  }

  const r1 = n1 > 0 ? n1Num / n1 / (n1Hr / n1) : 0;
  const r2 = n2 > 0 ? n2Num / n2 / (n2Hr / n2) : 0;
  const pct = r1 > 0 ? ((r1 - r2) / r1) * 100 : 0;
  return { firstHalfRatio: r1, secondHalfRatio: r2, decouplingPercent: pct };
}
