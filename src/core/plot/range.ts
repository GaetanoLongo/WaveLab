/**
 * Exact min/max of a signal over an interval, using the feature contract
 * (monotonic between features): the extremes can only occur at the interval
 * ends or at feature limits.
 */

import type { SignalEval } from '../signals/types';

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

function rangeExact(s: SignalEval, a: number, b: number): Range | null {
  let mn = Infinity;
  let mx = -Infinity;
  const add = (v: number) => {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  };
  const { features } = s.features(a, b);
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
