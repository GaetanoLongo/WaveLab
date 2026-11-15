/**
 * First-order lag  τ·y' + y = x   (RC low-pass filter; the current of an R-L load is
 * lowpass((v − E)/R, L/R)).
 *
 *   lowpass(x, τ)          periodic x: the exact PERIODIC STEADY STATE (what a converter
 *                          reaches after the start-up transient); aperiodic x: at rest
 *                          (y = 0) until t = 0, then driven by x.
 *   lowpass(x, τ, t0, y0)  y = y0 until t0, then driven by x (start-up transient).
 *
 * Exact stepping between x's features:
 *   y(b) = y(a)·e^(−h/τ) + (1/τ)∫_a^b x(s)·e^(−(b−s)/τ) ds,  h = b − a,
 * with closed forms where x is constant or linear (all PWM / rectifier pieces) and
 * adaptive Gauss–Legendre on smooth stretches.
 * Periodic steady state: y(t0) = F / (1 − e^(−T/τ)), F = response over one period from 0.
 * A transient on a periodic input is the steady state plus (y0 − y_ss(t0))·e^(−(t−t0)/τ).
 */

import { integrateSmooth, scannedFeatures } from './operators';
import { MAX_SAMPLES } from './scan';
import { DEFAULT_MAX_FEATURES, type SignalEval } from './types';

interface Seg {
  a: number;
  ya: number;
  /** x on [a, next): 'lin' = exactly linear (slope k from x(a+)), else smooth. */
  lin: boolean;
  xa: number;
  k: number;
}

const NAN: SignalEval = { value: () => NaN, features: () => ({ features: [], truncated: false }) };

export function lowpassOf(x: SignalEval, tau: number, start?: { t0: number; y0: number }): SignalEval {
  if (!(tau > 0) || !Number.isFinite(tau)) return NAN;
  const T = x.period;

  /** Classify [a, b] once: linear pieces get the closed form. */
  const classify = (a: number, b: number): { lin: boolean; xa: number; k: number } => {
    const h = b - a;
    const xa = x.value(a);
    const xb = x.value(b - h * 1e-9);
    const k = (xb - xa) / (h * (1 - 1e-9));
    const tol = 1e-12 * Math.max(Math.abs(xa), Math.abs(xb), 1e-300);
    const lin = [0.21, 0.5, 0.83].every((u) => Math.abs(x.value(a + u * h) - (xa + k * u * h)) <= tol);
    return { lin, xa, k };
  };

  /** y at b from y(a) = ya, x smooth (no feature) on (a, b). */
  const step = (ya: number, a: number, b: number, c: { lin: boolean; xa: number; k: number }): number => {
    const h = b - a;
    if (h <= 0) return ya;
    const E = Math.exp(-h / tau);
    if (c.lin) return ya * E + c.xa * (1 - E) + c.k * (h - tau * (1 - E));
    return ya * E + integrateSmooth((s) => x.value(s) * Math.exp(-(b - s) / tau), a, b) / tau;
  };

  /** Segments covering [a, b] starting from y(a) = ya; null if x has too many features. */
  const buildSegs = (a: number, b: number, ya: number): { segs: Seg[]; yb: number } | null => {
    const q = x.features(a, b, MAX_SAMPLES);
    if (q.truncated) return null;
    const cuts = [a, ...q.features.map((f) => f.t).filter((t) => t > a && t < b), b];
    const segs: Seg[] = [];
    let y = ya;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const s0 = cuts[i]!;
      const s1 = cuts[i + 1]!;
      if (!(s1 > s0)) continue;
      const c = classify(s0, s1);
      segs.push({ a: s0, ya: y, ...c });
      y = step(y, s0, s1, c);
    }
    return { segs, yb: y };
  };

  const find = (segs: Seg[], t: number): Seg => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (segs[m]!.a <= t) lo = m;
      else hi = m - 1;
    }
    return segs[lo]!;
  };
  const at = (s: Seg, t: number) => step(s.ya, s.a, t, s);

  let value: (t: number) => number;
  let periodic = false;

  if (T !== undefined) {
    // One period from y = 0, then the steady-state start value.
    const a0 = start?.t0 ?? 0;
    const zero = buildSegs(a0, a0 + T, 0);
    if (!zero) return { ...NAN, warnings: ['lowpass(): the input has too many edges per period to compute exactly.'] };
    const ET = Math.exp(-T / tau);
    const yss0 = zero.yb / (1 - ET);
    const segs = zero.segs.map((s) => ({ ...s, ya: s.ya + yss0 * Math.exp(-(s.a - a0) / tau) }));
    const yss = (t: number) => {
      const k = Math.floor((t - a0) / T);
      const tt = Math.min(t - k * T, a0 + T);
      return at(find(segs, tt), tt);
    };
    if (!start) {
      value = yss;
      periodic = true;
    } else {
      const { t0, y0 } = start;
      value = (t) => (t < t0 ? y0 : yss(t) + (y0 - yss0) * Math.exp(-(t - t0) / tau));
    }
  } else {
    // Aperiodic: chunks from t0 forward, y cached at chunk starts.
    const t0 = start?.t0 ?? 0;
    const y0 = start?.y0 ?? 0;
    const C = Math.max((x.scale ?? tau) * 16, 1e-15);
    const chunks = new Map<number, Seg[] | null>();
    const startY = new Map<number, number>([[0, y0]]);
    let maxJ = 0;
    const chunk = (j: number): Seg[] | null => {
      let c = chunks.get(j);
      if (c !== undefined) return c;
      while (maxJ < j) {
        const r = buildSegs(t0 + maxJ * C, t0 + (maxJ + 1) * C, startY.get(maxJ)!);
        if (!r) return null;
        if (chunks.size < 4096) chunks.set(maxJ, r.segs);
        startY.set(maxJ + 1, r.yb);
        maxJ++;
      }
      const r = buildSegs(t0 + j * C, t0 + (j + 1) * C, startY.get(j)!);
      c = r ? r.segs : null;
      if (chunks.size < 4096) chunks.set(j, c);
      return c;
    };
    value = (t) => {
      if (t < t0) return y0;
      const j = Math.floor((t - t0) / C);
      if (j > 1e6) return NaN; // too far from the start to walk there
      const segs = chunk(j);
      return segs && segs.length ? at(find(segs, t), t) : NaN;
    };
  }

  // y is continuous: the left limit equals the value.
  const startT = start?.t0;
  const sc = Math.min(x.scale ?? x.period ?? Infinity, 8 * tau);
  return {
    value,
    left: value,
    features: (a, b, maxCount = DEFAULT_MAX_FEATURES) => {
      const q = x.features(a, b, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      const bps = q.features.map((f) => f.t);
      if (startT !== undefined) bps.push(startT);
      return scannedFeatures(bps, a, b, maxCount, value, value, Number.isFinite(sc) ? sc : undefined);
    },
    period: periodic ? T : undefined,
    scale: Math.min(x.scale ?? Infinity, tau),
    ...(x.impulses ? { warnings: ['lowpass(): impulses of the input are ignored (use dfinite() for a finite edge).'] } : {}),
  };
}
