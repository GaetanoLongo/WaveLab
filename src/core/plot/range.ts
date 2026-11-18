/**
 * Exact min/max of a signal over an interval, using the feature contract
 * (monotonic between features): the extremes can only occur at the interval
 * ends or at feature limits.
 */

import type { Feature, SignalEval } from '../signals/types';

export type Range = readonly [number, number];

const periodRangeCache = new WeakMap<SignalEval, Range | null>();

/** Returns [min, max] ignoring undefined (NaN) parts, or null if entirely undefined. */
export function rangeOf(s: SignalEval, a: number, b: number): Range | null {
  if (s.period !== undefined && b - a >= s.period) {
    let r = periodRangeCache.get(s);
    if (r === undefined) {
      r = rangeExact(s, 0, s.period);
      periodRangeCache.set(s, r);
    }
    return r;
  }
  return rangeExact(s, a, b);
}

/**
 * Like rangeOf, but with a bounded cost: if [a, b] holds more than `maxFeatures` features, only
 * the leading part of the window that does is used (each retry takes a quarter). Used for the
 * automatic vertical range of signals without a period, whose natural window (1 s) can hold
 * hundreds of thousands of edges. Deterministic: depends on feature counts, not on timing.
 */
export function rangeOfBounded(s: SignalEval, a: number, b: number, maxFeatures = 250): Range | null {
  if (s.period !== undefined && b - a >= s.period) return rangeOf(s, a, b);
  let hi = b;
  for (let i = 0; i < 10; i++) {
    const q = s.features(a, hi, maxFeatures);
    if (!q.truncated) return withSamples(s, a, b, hi < b, rangeFrom(s, a, hi, q.features));
    hi = a + (hi - a) / 4;
  }
  return withSamples(s, a, b, true, rangeFrom(s, a, hi, s.features(a, hi, maxFeatures).features));
}

/** Samples used to cover the part of the window the bounded feature scan did not look at. */
const COVER_SAMPLES = 512;

/**
 * The bounded scan only looks at the start of a window that holds many features, so the peaks of a long
 * table (imported data) or of a long derived signal were missed and the plot was clipped. When the scan
 * was cut short, 512 evenly spaced samples of the whole window complete the range.
 */
function withSamples(s: SignalEval, a: number, b: number, cut: boolean, r: Range | null): Range | null {
  if (!cut) return r;
  let mn = r ? r[0] : Infinity;
  let mx = r ? r[1] : -Infinity;
  for (let i = 0; i < COVER_SAMPLES; i++) {
    const v = s.value(a + ((b - a) * i) / (COVER_SAMPLES - 1));
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return mn <= mx ? [mn, mx] : null;
}

function rangeExact(s: SignalEval, a: number, b: number): Range | null {
  return rangeFrom(s, a, b, s.features(a, b).features);
}

function rangeFrom(s: SignalEval, a: number, b: number, features: readonly Feature[]): Range | null {
  let mn = Infinity;
  let mx = -Infinity;
  const add = (v: number) => {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  };
  add(s.value(a));
  const last = features[features.length - 1];
  add(last && last.t >= b ? last.left : s.value(b));
  for (const f of features) {
    add(f.left);
    add(f.right);
  }
  // NaN comparisons are false, so undefined values never enter mn/mx.
  return mn <= mx ? [mn, mx] : null;
}

/** Union of ranges, ignoring nulls. */
export function unionRanges(ranges: Array<Range | null>): Range | null {
  let mn = Infinity;
  let mx = -Infinity;
  for (const r of ranges) {
    if (!r) continue;
    mn = Math.min(mn, r[0]);
    mx = Math.max(mx, r[1]);
  }
  return mn <= mx ? [mn, mx] : null;
}
