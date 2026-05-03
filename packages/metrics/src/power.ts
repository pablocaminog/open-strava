/**
 * Power-based training metrics.
 *
 * NP (Normalized Power) — Coggan, 2003:
 *   1. 30s rolling average of the power stream
 *   2. raise each rolling average to the 4th power
 *   3. arithmetic mean of those values
 *   4. take the 4th root
 *
 * IF (Intensity Factor) = NP / FTP
 * TSS (Training Stress Score) = (seconds * NP * IF) / (FTP * 3600) * 100
 * VI (Variability Index)      = NP / avgPower
 * kJ (mechanical work)        = sum of power * dt / 1000
 *
 * Inputs are assumed to be at a roughly uniform 1Hz cadence — the
 * standard for cycling head units. Sparse / irregular streams should
 * be resampled to 1Hz upstream.
 */

export interface PowerSample {
  /** Seconds since activity start, monotonic, ideally 1Hz. */
  t: number;
  /** Power in watts; null/undefined treated as a zero gap. */
  p: number | null | undefined;
}

export interface PowerMetrics {
  /** Sample count used (excludes leading gap before first valid sample). */
  durationSeconds: number;
  avgPower: number;
  maxPower: number;
  normalizedPower: number;
  intensityFactor: number;
  trainingStressScore: number;
  variabilityIndex: number;
  workKilojoules: number;
}

/**
 * Compute NP using a 30s simple moving average over a 1Hz stream.
 * Returns 0 for streams shorter than the first 30 seconds.
 */
export function normalizedPower(power: number[], windowSeconds = 30): number {
  if (power.length < windowSeconds) return 0;
  let windowSum = 0;
  for (let i = 0; i < windowSeconds; i++) windowSum += power[i] ?? 0;

  let acc = 0;
  let n = 0;
  // First valid window ending at index windowSeconds-1
  let avg = windowSum / windowSeconds;
  acc += avg ** 4;
  n++;

  for (let i = windowSeconds; i < power.length; i++) {
    windowSum += (power[i] ?? 0) - (power[i - windowSeconds] ?? 0);
    avg = windowSum / windowSeconds;
    acc += avg ** 4;
    n++;
  }
  return Math.pow(acc / n, 0.25);
}

export function powerMetrics(samples: PowerSample[], ftp: number): PowerMetrics {
  if (ftp <= 0) throw new Error('FTP must be positive');
  if (samples.length === 0) {
    return zeroPowerMetrics();
  }

  // Build a dense 1Hz integer-second array. Missing samples count as 0W
  // for NP purposes (per Coggan: zeros are valid; the 4th-power weighting
  // handles them correctly).
  const lastT = Math.floor(samples[samples.length - 1]!.t);
  const firstT = Math.floor(samples[0]!.t);
  const durationSeconds = Math.max(0, lastT - firstT + 1);
  const dense = new Array<number>(durationSeconds).fill(0);
  let sum = 0;
  let nValid = 0;
  let maxP = 0;
  let kJ = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const idx = Math.floor(s.t) - firstT;
    if (idx < 0 || idx >= durationSeconds) continue;
    const p = typeof s.p === 'number' && Number.isFinite(s.p) ? Math.max(0, s.p) : 0;
    dense[idx] = p;
    if (p > maxP) maxP = p;
    if (p > 0) nValid++;
    sum += p;
    // 1J per (W * s); convert to kJ.
    kJ += p / 1000;
  }

  const avg = nValid > 0 ? sum / durationSeconds : 0;
  const np = normalizedPower(dense);
  const intensity = np / ftp;
  const tss = ((durationSeconds * np * intensity) / (ftp * 3600)) * 100;
  const vi = avg > 0 ? np / avg : 0;

  return {
    durationSeconds,
    avgPower: avg,
    maxPower: maxP,
    normalizedPower: np,
    intensityFactor: intensity,
    trainingStressScore: tss,
    variabilityIndex: vi,
    workKilojoules: kJ,
  };
}

function zeroPowerMetrics(): PowerMetrics {
  return {
    durationSeconds: 0,
    avgPower: 0,
    maxPower: 0,
    normalizedPower: 0,
    intensityFactor: 0,
    trainingStressScore: 0,
    variabilityIndex: 0,
    workKilojoules: 0,
  };
}
