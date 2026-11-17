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
    if (!q.truncated) return rangeFrom(s, a, hi, q.features);
    hi = a + (hi - a) / 4;
  }
  return rangeFrom(s, a, hi, s.features(a, hi, maxFeatures).features);
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
