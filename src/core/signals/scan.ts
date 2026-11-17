/**
 * Shared helpers for signals whose features are found numerically (derived
 * expressions and calculus operators): segment scanning with bisection of
 * state changes and golden-section refinement of extrema.
 */

import { checkBudget } from './budget';
import type { Feature, SignalEval } from './types';

export const MAX_SAMPLES = 20_000;

export function leftValue(s: SignalEval, t: number): number {
  return s.left ? s.left(t) : s.value(t - 1e-12 * Math.max(1, Math.abs(t)));
}

export function same(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Sample [a, b] at ~`step` and append switching instants (state-signature changes,
 * located by bisection) and local extrema (golden section) to `out`. The value at
 * `b` is taken as a left limit. `ev` may ignore the signature array.
 */
export function scanSegment(
  a: number,
  b: number,
  step: number,
  ev: (t: number, left: boolean, sig: number[] | null) => number,
  findExtrema: boolean,
  out: Feature[],
) {
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil((b - a) / step)));
  const ts: number[] = new Array(n + 1);
  const vs: number[] = new Array(n + 1);
  const sigs: string[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    checkBudget();
    const t = i === n ? b : a + ((b - a) * i) / n;
    const sig: number[] = [];
    // Segment ends use one-sided limits (inside the segment).
    vs[i] = ev(t, i === n, sig);
    ts[i] = t;
    sigs[i] = sig.join(',') + (Number.isNaN(vs[i]!) ? 'N' : '');
  }

  const sigAt = (t: number) => {
    const sig: number[] = [];
    const v = ev(t, false, sig);
    return sig.join(',') + (Number.isNaN(v) ? 'N' : '');
  };

  // Continuous switches (abs/clip/min/max corners) can show ~1e-16 differences between the two
  // sides; treat differences below 1e-9 of the segment's magnitude as continuous.
  let mag = 0;
  for (const v of vs) if (Number.isFinite(v)) mag = Math.max(mag, Math.abs(v));
  const close = (x: number, y: number) => same(x, y) || Math.abs(x - y) <= 1e-9 * mag;

  // Switching instants.
  for (let i = 0; i < n; i++) {
    let lo = ts[i]!;
    const hi0 = ts[i + 1]!;
    let sLo = sigs[i]!;
    const sHi = sigs[i + 1]!;
    for (let guard = 0; guard < 8 && sLo !== sHi; guard++) {
      let l = lo;
      let h = hi0;
      for (let k = 0; k < 64 && h - l > 1e-15 * Math.max(1, Math.abs(h)); k++) {
        checkBudget();
        const m = (l + h) / 2;
        if (m <= l || m >= h) break;
        if (sigAt(m) === sLo) l = m;
        else h = m;
      }
      // The sample at the segment end is a left limit, so a genuine switch lies strictly inside
      // the last interval. For an interior interval, a switch that converges onto the next
      // sample point is genuine: that sample (right-continuous) already shows the new state,
      // e.g. a comparator crossing exactly on the sampling grid.
      if (h >= hi0 && i === n - 1) break;
      const L = ev(l, false, null);
      const R = ev(h, false, null);
      if (close(L, R)) {
        const v = (L + R) / 2;
        out.push({ t: h, kind: 'kink', left: v, right: v });
      } else {
        out.push({ t: h, kind: 'jump', left: L, right: R });
      }
      lo = h;
      sLo = sigAt(h);
      if (h >= hi0) break;
    }
  }

  // Local extrema (only inside stretches with an unchanged signature).
  if (!findExtrema) return;
  for (let i = 1; i < n; i++) {
    if (sigs[i - 1] !== sigs[i] || sigs[i] !== sigs[i + 1]) continue;
    const d1 = vs[i]! - vs[i - 1]!;
    const d2 = vs[i + 1]! - vs[i]!;
    if (!(d1 * d2 < 0)) continue;
    const isMax = d1 > 0;
    const t = golden(ts[i - 1]!, ts[i + 1]!, (x) => (isMax ? -1 : 1) * ev(x, false, null));
    const v = ev(t, false, null);
    out.push({ t, kind: isMax ? 'max' : 'min', left: v, right: v });
  }
}

/** Golden-section minimization of f on [a, b]. */
function golden(a: number, b: number, f: (x: number) => number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 80 && b - a > 1e-15 * Math.max(1, Math.abs(b)); i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}


