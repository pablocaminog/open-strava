/**
 * Pace metrics — Grade-Adjusted Pace, Normalized Graded Pace, rTSS.
 *
 * Energy cost of running on grade — Minetti et al. (2002):
 *   C(g) = 155.4·g^5 − 30.4·g^4 − 43.3·g^3 + 46.3·g^2 + 19.5·g + 3.6
 * where g is decimal grade (positive = uphill). C(0) = 3.6 J·kg⁻¹·m⁻¹.
 *
 * For a fixed energy budget, flat-equivalent speed = actual speed × C(g)/C(0).
 * GAP (in pace) = 1 / flat-equivalent speed.
 *
 * NGP — analog of NP for running:
 *   1. compute the GAP-adjusted speed at every second
 *   2. take a 30s rolling average
 *   3. raise to the 4th power, mean, 4th root
 *   Result is a "normalized" speed; convert to pace as 1/speed.
 *
 * rTSS — analog of TSS for running, anchored on threshold pace:
 *   IF_run = NGP_speed / threshold_speed
 *   rTSS   = (seconds * NGP_speed * IF_run) / (threshold_speed * 3600) * 100
 */

const MINETTI_FLAT = 3.6;

export function minettiCost(grade: number): number {
  const g = clampGrade(grade);
  return 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
}

/**
 * Grade-adjusted (flat-equivalent) speed in m/s.
 * Caller passes the actual speed and the local decimal grade.
 */
export function gradeAdjustedSpeed(speedMs: number, grade: number): number {
  if (!Number.isFinite(speedMs) || speedMs <= 0) return 0;
  return speedMs * (minettiCost(grade) / MINETTI_FLAT);
}

function clampGrade(g: number): number {
  if (!Number.isFinite(g)) return 0;
  if (g > 0.45) return 0.45;
  if (g < -0.45) return -0.45;
  return g;
}

export interface PaceSample {
  /** Seconds since activity start, ideally 1Hz. */
  t: number;
  /** Speed in m/s. null/undefined = gap → treated as 0. */
  speed: number | null | undefined;
  /** Decimal grade. If undefined, assumed 0. */
  grade?: number | null | undefined;
}

export interface PaceMetrics {
  durationSeconds: number;
  /** Average raw speed in m/s (gaps = 0). */
  avgSpeedMs: number;
  /** Normalized graded pace expressed as a speed in m/s. */
  ngpSpeedMs: number;
  intensityFactor: number;
  rTSS: number;
}

/**
 * Compute NGP from a stream of grade-adjusted speeds.
 * Returns a flat-equivalent speed in m/s.
 */
export function normalizedGradedPace(adjustedSpeedMs: number[], windowSeconds = 30): number {
  if (adjustedSpeedMs.length < windowSeconds) return 0;
  let windowSum = 0;
  for (let i = 0; i < windowSeconds; i++) windowSum += adjustedSpeedMs[i] ?? 0;
  let acc = 0;
  let n = 0;
  let avg = windowSum / windowSeconds;
  acc += avg ** 4;
  n++;
  for (let i = windowSeconds; i < adjustedSpeedMs.length; i++) {
    windowSum += (adjustedSpeedMs[i] ?? 0) - (adjustedSpeedMs[i - windowSeconds] ?? 0);
    avg = windowSum / windowSeconds;
    acc += avg ** 4;
    n++;
  }
  return Math.pow(acc / n, 0.25);
}

export function paceMetrics(samples: PaceSample[], thresholdSpeedMs: number): PaceMetrics {
  if (thresholdSpeedMs <= 0) throw new Error('thresholdSpeedMs must be positive');
  if (samples.length === 0) {
    return { durationSeconds: 0, avgSpeedMs: 0, ngpSpeedMs: 0, intensityFactor: 0, rTSS: 0 };
  }

  const firstT = Math.floor(samples[0]!.t);
  const lastT = Math.floor(samples[samples.length - 1]!.t);
  const durationSeconds = Math.max(0, lastT - firstT + 1);
  const dense = new Array<number>(durationSeconds).fill(0);
  let sum = 0;

  for (const s of samples) {
    const idx = Math.floor(s.t) - firstT;
    if (idx < 0 || idx >= durationSeconds) continue;
    const speed =
      typeof s.speed === 'number' && Number.isFinite(s.speed) && s.speed > 0 ? s.speed : 0;
    const grade = typeof s.grade === 'number' && Number.isFinite(s.grade) ? clampGrade(s.grade) : 0;
    dense[idx] = gradeAdjustedSpeed(speed, grade);
    sum += speed;
  }

  const avgSpeedMs = sum / durationSeconds;
  const ngp = normalizedGradedPace(dense);
  const intensity = ngp / thresholdSpeedMs;
  const rTSS = ((durationSeconds * ngp * intensity) / (thresholdSpeedMs * 3600)) * 100;
  return {
    durationSeconds,
    avgSpeedMs,
    ngpSpeedMs: ngp,
    intensityFactor: intensity,
    rTSS,
  };
}
