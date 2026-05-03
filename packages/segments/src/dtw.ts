/**
 * Dynamic Time Warping over polylines, distance metric = haversine.
 *
 * Produces the minimum cumulative distance between two point sequences
 * along the optimal alignment. With a Sakoe-Chiba band (`window`) we
 * cap the warp size so DTW runs in O(n · band) rather than O(n · m).
 *
 * Returned `cost` is the *mean* per-aligned-pair distance in meters,
 * which is the property worth comparing against a tolerance threshold.
 */

import { haversine, type LatLng } from './geo.js';

export interface DtwOptions {
  /** Sakoe-Chiba band, in number of cells. Default = 20% of max(n, m). */
  window?: number;
}

export interface DtwResult {
  /** Total cost = sum of per-pair haversine distances along the optimal path. */
  total: number;
  /** Number of cells on the optimal path (warp length). */
  pathLength: number;
  /** total / pathLength — mean per-pair distance in meters. */
  cost: number;
}

const INF = Number.POSITIVE_INFINITY;

export function dtw(a: readonly LatLng[], b: readonly LatLng[], opts: DtwOptions = {}): DtwResult {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) return { total: 0, pathLength: 0, cost: 0 };

  const w = Math.max(opts.window ?? Math.ceil(Math.max(n, m) * 0.2), Math.abs(n - m));
  const cols = m + 1;
  const dp = new Float64Array((n + 1) * cols);
  const len = new Uint32Array((n + 1) * cols);
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      dp[i * cols + j] = INF;
    }
  }
  dp[0] = 0;

  for (let i = 1; i <= n; i++) {
    const jLo = Math.max(1, i - w);
    const jHi = Math.min(m, i + w);
    for (let j = jLo; j <= jHi; j++) {
      const d = haversine(a[i - 1]!, b[j - 1]!);
      const up = dp[(i - 1) * cols + j]!;
      const left = dp[i * cols + (j - 1)]!;
      const diag = dp[(i - 1) * cols + (j - 1)]!;
      let best = diag;
      let bestLen = len[(i - 1) * cols + (j - 1)]! + 1;
      if (up < best) {
        best = up;
        bestLen = len[(i - 1) * cols + j]! + 1;
      }
      if (left < best) {
        best = left;
        bestLen = len[i * cols + (j - 1)]! + 1;
      }
      dp[i * cols + j] = best + d;
      len[i * cols + j] = bestLen;
    }
  }

  const total = dp[n * cols + m]!;
  const pathLength = len[n * cols + m]!;
  if (!Number.isFinite(total) || pathLength === 0) {
    return { total: INF, pathLength: 0, cost: INF };
  }
  return { total, pathLength, cost: total / pathLength };
}
