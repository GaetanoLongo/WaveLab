/**
 * Exact measurements of a signal over an interval [a, b]:
 *  - max / min from the exact feature list (no sampling),
 *  - mean and RMS from exact integration (adaptive Gauss–Legendre between features),
 *  - duty cycle and frequency from exact crossings of the mid-level threshold.
 */

import { rangeOf } from '../plot/range';
import { integrateRange, squareOf } from '../signals/operators';
import type { SignalEval } from '../signals/types';
import { zeroCrossings } from '../snap/points';

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

/** Signal shifted down by `level` (features shifted too), for crossing detection. */
function shifted(s: SignalEval, level: number): SignalEval {
  return {
    value: (t) => s.value(t) - level,
    left: s.left ? (t) => s.left!(t) - level : undefined,
    features: (a, b, m) => {
      const q = s.features(a, b, m);
      return { truncated: q.truncated, features: q.features.map((f) => ({ ...f, left: f.left - level, right: f.right - level })) };
    },
    period: s.period,
    scale: s.scale,
  };
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
    const x = shifted(s, threshold);
    const crossings = zeroCrossings(x, a, b);
    // Time above the threshold: walk the crossings. The initial state comes from the first
    // crossing's direction (robust when the interval starts exactly on the threshold).
    const first = crossings[0];
    let above = first ? !first.rising : x.value((a + b) / 2) > 0;
    let last = a;
    let high = 0;
    for (const c of crossings) {
      if (above) high += c.t - last;
      above = c.rising;
      last = c.t;
    }
    if (above) high += b - last;
    duty = high / span;
    // Frequency from same-direction crossings (whichever direction has more of them).
    const ups = crossings.filter((c) => c.rising).map((c) => c.t);
    const downs = crossings.filter((c) => !c.rising).map((c) => c.t);
    rising = ups.length;
    const use = ups.length >= downs.length ? ups : downs;
    if (use.length >= 2) frequency = (use.length - 1) / (use[use.length - 1]! - use[0]!);
  }
  return { a, b, max, min, peakToPeak: max - min, mean, rms, threshold, duty, frequency, risingCrossings: rising };
}
