/**
 * Mean-max curve (a.k.a. peak power / pace / HR curve).
 *
 * For each duration in `windows`, returns the largest sustained
 * arithmetic mean of `stream` over a contiguous window of that
 * duration. Stream is assumed to be a 1Hz dense array — densify
 * upstream by filling gaps with 0 (or whatever neutral value the
 * caller wants to count as "did not produce").
 *
 * Complexity: O(n) per window via a single-pass sliding sum,
 * O(n · |windows|) overall.
 *
 * If a window is longer than the stream, returns 0 for that bucket.
 */

export interface PeakPoint {
  duration: number;
  /** Largest sustained mean of `stream` over a contiguous `duration`-second window. */
  peakValue: number;
}

export const DEFAULT_PEAK_WINDOWS = [1, 5, 30, 60, 300, 1200, 3600] as const;

export function peakCurve(
  stream: number[],
  windows: readonly number[] = DEFAULT_PEAK_WINDOWS,
): PeakPoint[] {
  const out: PeakPoint[] = [];
  for (const d of windows) {
    if (d <= 0 || stream.length < d) {
      out.push({ duration: d, peakValue: 0 });
      continue;
    }
    let sum = 0;
    for (let i = 0; i < d; i++) sum += stream[i] ?? 0;
    let best = sum;
    for (let i = d; i < stream.length; i++) {
      sum += (stream[i] ?? 0) - (stream[i - d] ?? 0);
      if (sum > best) best = sum;
    }
    out.push({ duration: d, peakValue: best / d });
  }
  return out;
}
