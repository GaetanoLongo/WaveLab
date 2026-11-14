/**
 * Exact measurements of a signal over an interval [a, b]:
 *  - max / min from the exact feature list (no sampling),
 *  - mean and RMS from exact integration (adaptive Gauss–Legendre between features),
 *  - duty cycle and frequency from exact crossings of the mid-level threshold.
 */

import { rangeOf } from '../plot/range';
import { integrateRange, squareOf } from '../signals/operators';
import type { SignalEval } from '../signals/types';
import { leftValue } from '../signals/scan';

export interface IntervalMeasurements {
  a: number;
  b: number;
  max: number;
  min: number;
  peakToPeak: number;
  mean: number;
  rms: number;
  /** Mid-level threshold (max + min) / 2 used for duty cycle and frequency. */
  threshold: number;
  /** Fraction of [a, b] above the threshold (NaN if the signal never crosses it… or is flat). */
  duty: number;
  /** From same-direction threshold crossings: (n − 1) / (last − first); NaN with fewer than 2. */
  frequency: number;
  risingCrossings: number;
}

/**
 * Time above `thr` in [a, b] and the instants where the signal goes above / below it.
 * Walks the exact segments between features (monotonic by contract): whole stretches
 * count directly, partial ones are split by bisection, and jumps across the threshold
 * are transitions. Robust to plateaus that sit exactly on the threshold (e.g. 3-level PWM).
 */
function aboveThreshold(s: SignalEval, a: number, b: number, thr: number) {
  const { features } = s.features(a, b);
  // Use the features' own left/right limits at their times (re-evaluating exactly at a
  // feature time can land on the wrong side of it through floating-point rounding).
  const inner = features.filter((f) => f.t > a && f.t < b);
  const pts = [a, ...inner.map((f) => f.t), b];
  const rightAt = [s.value(a), ...inner.map((f) => f.right)];
  const leftAt = [...inner.map((f) => f.left), leftValue(s, b)];
  const ups: number[] = [];
  const downs: number[] = [];
  let high = 0;
  const above = (v: number) => v > thr;
  for (let i = 0; i + 1 < pts.length; i++) {
    const x0 = pts[i]!;
    const x1 = pts[i + 1]!;
    if (!(x1 > x0)) continue;
    const s0 = above(rightAt[i]!);
    const s1 = above(leftAt[i]!);
    if (s0 && s1) high += x1 - x0;
    else if (s0 !== s1) {
      // Monotonic between features: one crossing, found by bisection strictly inside.
      let lo = x0;
      let hi = x1;
      for (let k = 0; k < 80 && hi - lo > 1e-15 * Math.max(1, Math.abs(hi)); k++) {
        const m = (lo + hi) / 2;
        if (above(s.value(m)) === s0) lo = m;
        else hi = m;
      }
      if (s0) {
        high += hi - x0;
        downs.push(hi);
      } else {
        high += x1 - hi;
        ups.push(hi);
      }
    }
    // Jump at the end of this segment (an interior feature).
    if (i + 1 < rightAt.length) {
      const after = above(rightAt[i + 1]!);
      if (after !== s1) (after ? ups : downs).push(x1);
    }
  }
  return { high, ups, downs };
}

export function measureInterval(s: SignalEval, a0: number, b0: number): IntervalMeasurements {
  const a = Math.min(a0, b0);
  const b = Math.max(a0, b0);
  const nan: IntervalMeasurements = {
    a, b, max: NaN, min: NaN, peakToPeak: NaN, mean: NaN, rms: NaN, threshold: NaN, duty: NaN, frequency: NaN, risingCrossings: 0,
  };
  if (!(b > a)) return nan;
  const r = rangeOf(s, a, b);
  if (!r) return nan;
  const [min, max] = r;
  const span = b - a;
  const mean = integrateRange(s, a, b) / span;
  const rms = Math.sqrt(Math.max(0, integrateRange(squareOf(s), a, b) / span));
  const threshold = (max + min) / 2;

  let duty = NaN;
  let frequency = NaN;
  let rising = 0;
  if (max > min) {
    const r = aboveThreshold(s, a, b, threshold);
    duty = r.high / span;
    rising = r.ups.length;
    // Frequency from same-direction transitions (whichever direction has more of them).
    const use = r.ups.length >= r.downs.length ? r.ups : r.downs;
    if (use.length >= 2) frequency = (use.length - 1) / (use[use.length - 1]! - use[0]!);
  }
  return { a, b, max, min, peakToPeak: max - min, mean, rms, threshold, duty, frequency, risingCrossings: rising };
}
