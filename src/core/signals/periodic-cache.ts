/**
 * Periodic feature cache.
 *
 * A signal that repeats (period P) has the same features in every period. Operators such as
 * moving averages and filters ask their input for the features of a *different window* on every
 * evaluation, so a stack of such layers re-derives the same features again and again, and the
 * cost multiplies with every layer (a chain of five or six operations took ten seconds).
 *
 * This wrapper computes the features of one period once (from a window three periods wide, so
 * that events exactly at a period boundary are found) and answers any window by translating
 * that list. Point evaluation is unchanged.
 */

import type { Feature, FeatureQuery, SignalEval } from './types';

/** Longest period count translated in one query (beyond it the answer is "too many"). */
const MAX_TRANSLATED = 2_000_000;

export function withPeriodicCache(s: SignalEval): SignalEval {
  const P = s.period;
  if (P === undefined || !(P > 0) || !Number.isFinite(P)) return s;
  let base: Feature[] | null | undefined; // undefined = not computed, null = too dense to cache

  const getBase = (): Feature[] | null => {
    if (base !== undefined) return base;
    const q = s.features(-P, 2 * P, 6000);
    if (q.truncated) {
      base = null;
      return base;
    }
    base = q.features.filter((f) => f.t >= 0 && f.t < P).sort((x, y) => x.t - y.t);
    return base;
  };

  const features = (t0: number, t1: number, maxCount?: number): FeatureQuery => {
    const b = getBase();
    if (!b) return s.features(t0, t1, maxCount);
    if (b.length === 0) return { features: [], truncated: false };
    const k0 = Math.floor(t0 / P);
    const k1 = Math.floor(t1 / P);
    if (k1 - k0 > MAX_TRANSLATED / Math.max(1, b.length)) return { features: [], truncated: true };
    const limit = maxCount ?? Infinity;
    const out: Feature[] = [];
    for (let k = k0; k <= k1; k++) {
      const shift = k * P;
      for (const f of b) {
        const t = f.t + shift;
        if (t < t0) continue;
        if (t > t1) break;
        out.push(k === 0 ? f : { t, kind: f.kind, left: f.left, right: f.right });
        if (out.length > limit) return { features: out.slice(0, limit), truncated: true };
      }
    }
    return { features: out, truncated: false };
  };

  return { ...s, features };
}
