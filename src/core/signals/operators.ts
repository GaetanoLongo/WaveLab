/**
 * Calculus operators on signals: integral, derivative (three treatments of
 * discontinuities), moving average and moving RMS.
 *
 * Integral  I(t) = y0 + ∫_{t0}^{t} x(τ) dτ  (+ the weights of any impulses of x in (t0, t])
 *   Exact for piecewise-polynomial inputs: each smooth segment between x's features is
 *   integrated with adaptive Gauss–Legendre quadrature (exact up to degree 9 per panel).
 *   Periodic x: I(t) = y0 + k·P + (partial period from a cached cumulative table),
 *   so the cost does not grow with |t − t0|. Aperiodic x: cumulative tables per chunk.
 *
 * deriv(x)       derivative of the smooth parts (4th-order finite differences that never
 *                straddle a feature) + ideal impulses J·δ(t − tj) at jumps, reported via
 *                `impulses()` and drawn as markers — never as a finite spike.
 * dfinite(x, tr) each jump J is spread over a ramp of duration tr: a rectangle J/tr wide tr.
 * dnum(x, h)     plain central difference (x(t + h/2) − x(t − h/2)) / h.
 * movavg(x, W)   trailing window average (1/W)·∫_{t−W}^{t} x.
 * rms(x, W)      trailing window RMS sqrt((1/W)·∫_{t−W}^{t} x²).
 */

import { zeroCrossings } from '../snap/points';
import { leftValue, MAX_SAMPLES, same, scanSegment } from './scan';
import { DEFAULT_MAX_FEATURES, type Feature, type FeatureQuery, type Impulse, type SignalEval } from './types';

const SAMPLES_PER_SCALE = 64;

// --- quadrature ------------------------------------------------------------------

const GL_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
const GL_W = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891];

function gl5(f: (t: number) => number, a: number, b: number): number {
  const m = (a + b) / 2;
  const h = (b - a) / 2;
  let s = 0;
  for (let i = 0; i < 5; i++) s += GL_W[i]! * f(m + h * GL_X[i]!);
  return s * h;
}

/**
 * Adaptive Gauss–Legendre on a smooth interval (no features inside). The tolerance is
 * absolute, relative to ∫|f| over the whole interval: a purely relative test never
 * converges on pieces whose integral is (close to) zero and would recurse to full depth.
 */
function integrateSmooth(f: (t: number) => number, a: number, b: number, depth = 0, whole?: number, tol?: number): number {
  if (b === a) return 0;
  const w = whole ?? gl5(f, a, b);
  const eps = tol ?? 1e-12 * Math.max(Math.abs(gl5((t) => Math.abs(f(t)), a, b)), 1e-300);
  const m = (a + b) / 2;
  const l = gl5(f, a, m);
  const r = gl5(f, m, b);
  const sum = l + r;
  // Depth cap: 2^10 panels of 5-point GL are far beyond what smooth segments need; it also
  // bounds the cost when rounding noise (e.g. sin at a large phase) exceeds the tolerance.
  if (depth >= 10 || Math.abs(sum - w) <= eps) return sum;
  return integrateSmooth(f, a, m, depth + 1, l, eps / 2) + integrateSmooth(f, m, b, depth + 1, r, eps / 2);
}

/** ∫_a^b x over intervals that may contain features (a < b), plus impulses in (a, b]. */
export function integrateRange(x: SignalEval, a: number, b: number): number {
  if (b === a) return 0;
  const q = x.features(a, b, MAX_SAMPLES);
  let total = 0;
  let lo = a;
  const value = (t: number) => x.value(t);
  for (const f of q.features) {
    if (f.t <= a || f.t >= b) continue;
    total += integrateSmooth(value, lo, f.t);
    lo = f.t;
  }
  total += integrateSmooth(value, lo, b);
  for (const imp of x.impulses?.(a, b) ?? []) if (imp.t > a && imp.t <= b) total += imp.weight;
  return total;
}

/** Cumulative integral table over [a, b] at x's feature times (for fast lookups). */
interface Table {
  a: number;
  ts: number[]; // segment start times (ts[0] = a)
  cum: number[]; // ∫_a^{ts[i]} (right of any impulse at ts[i])
}

function buildTable(x: SignalEval, a: number, b: number): Table {
  const ts = [a];
  const cum = [0];
  const q = x.features(a, b, MAX_SAMPLES);
  const imps = x.impulses?.(a, b) ?? [];
  const pts = new Set<number>();
  for (const f of q.features) if (f.t > a && f.t < b) pts.add(f.t);
  for (const i of imps) if (i.t > a && i.t < b) pts.add(i.t);
  let acc = 0;
  let lo = a;
  for (const t of [...pts].sort((p, r) => p - r)) {
    acc += integrateSmooth((s) => x.value(s), lo, t);
    for (const i of imps) if (i.t === t) acc += i.weight;
    ts.push(t);
    cum.push(acc);
    lo = t;
  }
  return { a, ts, cum };
}

function lookup(x: SignalEval, tab: Table, t: number): number {
  // Last table point <= t; then integrate the remaining smooth piece.
  let lo = 0;
  let hi = tab.ts.length - 1;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (tab.ts[m]! <= t) lo = m;
    else hi = m - 1;
  }
  return tab.cum[lo]! + integrateSmooth((s) => x.value(s), tab.ts[lo]!, t);
}

// --- integral --------------------------------------------------------------------

export function integralOf(x: SignalEval, t0: number, y0: number): SignalEval {
  const T = x.period;
  let periodTable: Table | null = null;
  let P = 0;
  if (T !== undefined) {
    periodTable = buildTable(x, t0, t0 + T);
    P = integrateRange(x, t0, t0 + T);
  }
  // Aperiodic: chunks of length C anchored at t0, chunk start values cached.
  const C = (x.scale ?? 1e-3) * 16;
  const chunkStart = new Map<number, number>([[0, 0]]);
  const chunkTables = new Map<number, Table>();
  const startOf = (j: number): number => {
    const cached = chunkStart.get(j);
    if (cached !== undefined) return cached;
    // Walk from the nearest cached chunk.
    let k = j;
    while (!chunkStart.has(k)) k += j > 0 ? -1 : 1;
    let v = chunkStart.get(k)!;
    while (k !== j) {
      if (j > k) {
        v += integrateRange(x, t0 + k * C, t0 + (k + 1) * C);
        k++;
      } else {
        v -= integrateRange(x, t0 + (k - 1) * C, t0 + k * C);
        k--;
      }
      chunkStart.set(k, v);
    }
    return v;
  };

  const cumulative = (t: number): number => {
    if (periodTable && T !== undefined) {
      const k = Math.floor((t - t0) / T);
      const base = t0 + k * T;
      return k * P + lookup(x, periodTable, Math.min(t, base + T) - k * T);
    }
    const j = Math.floor((t - t0) / C);
    let tab = chunkTables.get(j);
    if (!tab) {
      tab = buildTable(x, t0 + j * C, t0 + (j + 1) * C);
      if (chunkTables.size > 512) chunkTables.clear();
      chunkTables.set(j, tab);
    }
    return startOf(j) + lookup(x, tab, t);
  };

  const value = (t: number) => y0 + cumulative(t);
  // Left limit differs from the value only at impulses of x.
  const left = (t: number) => {
    const imps = x.impulses?.(t, t) ?? [];
    return value(t) - imps.filter((i) => i.t === t).reduce((s, i) => s + i.weight, 0);
  };

  const features = (a: number, b: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const q = x.features(a, b, maxCount);
    if (q.truncated) return { features: [], truncated: true };
    const out: Feature[] = [];
    const imps = new Map((x.impulses?.(a, b) ?? []).map((i) => [i.t, i.weight]));
    for (const f of q.features) {
      const v = value(f.t);
      const w = imps.get(f.t);
      if (w !== undefined) out.push({ t: f.t, kind: 'jump', left: v - w, right: v });
      else out.push({ t: f.t, kind: 'kink', left: v, right: v });
    }
    // Extrema of the integral = sign changes of x (zero crossings, incl. sign-changing jumps).
    for (const z of zeroCrossings(x, a, b, maxCount)) {
      if (out.some((f) => f.t === z.t)) {
        const f = out.find((g) => g.t === z.t)!;
        if (f.kind === 'kink') f.kind = z.rising ? 'min' : 'max';
        continue;
      }
      const v = value(z.t);
      out.push({ t: z.t, kind: z.rising ? 'min' : 'max', left: v, right: v });
    }
    out.sort((p, r) => p.t - r.t);
    return out.length > maxCount ? { features: out.slice(0, maxCount), truncated: true } : { features: out, truncated: false };
  };

  const range = Math.abs(P);
  const periodic = T !== undefined && range <= 1e-12 * Math.max(1e-300, integrateAbs(x, t0, T));
  return { value, left, features, period: periodic ? T : undefined, scale: x.scale ?? T };
}

function integrateAbs(x: SignalEval, t0: number, T: number): number {
  const ax: SignalEval = { value: (t) => Math.abs(x.value(t)), features: (a, b, m) => x.features(a, b, m) };
  return Math.abs(integrateRange(ax, t0, t0 + T)) || 1;
}

// --- derivatives -----------------------------------------------------------------

/** Derivative of the smooth parts; never differentiates across a feature. */
function smoothDerivative(x: SignalEval, t: number, side: 'left' | 'right'): number {
  let h = (x.scale ?? 1e-3) * 1e-4;
  const near = x.features(t - 4.5 * h, t + 4.5 * h, 64).features.map((f) => f.t);
  const at = near.some((u) => u === t);
  const dl = Math.min(Infinity, ...near.filter((u) => u < t).map((u) => t - u));
  const dr = Math.min(Infinity, ...near.filter((u) => u > t).map((u) => u - t));
  const fR = (s: number) => x.value(s);
  const fL = (s: number) => leftValue(x, s);
  const rightStencil = (hh: number) =>
    (-25 * fR(t) + 48 * fR(t + hh) - 36 * fR(t + 2 * hh) + 16 * fR(t + 3 * hh) - 3 * fR(t + 4 * hh)) / (12 * hh);
  const leftStencil = (hh: number) =>
    (25 * fL(t) - 48 * fL(t - hh) + 36 * fL(t - 2 * hh) - 16 * fL(t - 3 * hh) + 3 * fL(t - 4 * hh)) / (12 * hh);
  const central = (hh: number) => (-fR(t + 2 * hh) + 8 * fR(t + hh) - 8 * fR(t - hh) + fR(t - 2 * hh)) / (12 * hh);

  if (at) {
    if (side === 'right') return rightStencil(Math.min(h, dr / 4.5));
    return leftStencil(Math.min(h, dl / 4.5));
  }
  if (dl > 2.2 * h && dr > 2.2 * h) return central(h);
  if (dr > 4.5 * h) return rightStencil(h);
  if (dl > 4.5 * h) return leftStencil(h);
  h = Math.min(dl, dr) / 4.5;
  return central(h);
}

function jumpsOf(x: SignalEval, a: number, b: number): Impulse[] {
  return x
    .features(a, b, MAX_SAMPLES)
    .features.filter((f) => f.kind === 'jump' && Number.isFinite(f.left) && Number.isFinite(f.right))
    .map((f) => ({ t: f.t, weight: f.right - f.left }));
}

/** Build features from known breakpoints plus numerically refined extrema. */
function scannedFeatures(
  bps: number[],
  a: number,
  b: number,
  maxCount: number,
  value: (t: number) => number,
  left: (t: number) => number,
  scale: number | undefined,
): FeatureQuery {
  const pts = [a, ...bps.filter((t) => t > a && t < b).sort((p, r) => p - r), b];
  const uniq: number[] = [];
  for (const t of pts) if (uniq.length === 0 || t > uniq[uniq.length - 1]!) uniq.push(t);
  const out: Feature[] = [];
  for (let i = 1; i < uniq.length - 1; i++) {
    const t = uniq[i]!;
    const L = left(t);
    const R = value(t);
    out.push({ t, kind: same(L, R) ? 'kink' : 'jump', left: L, right: R });
  }
  let step = scale !== undefined ? scale / SAMPLES_PER_SCALE : (b - a) / 512;
  if ((b - a) / step > MAX_SAMPLES) step = (b - a) / MAX_SAMPLES;
  const ev = (t: number, isLeft: boolean) => (isLeft ? left(t) : value(t));
  for (let i = 0; i + 1 < uniq.length; i++) {
    scanSegment(uniq[i]!, uniq[i + 1]!, step, ev, true, out);
    if (out.length > maxCount * 2) break;
  }
  out.sort((p, r) => p.t - r.t);
  return out.length > maxCount ? { features: out.slice(0, maxCount), truncated: true } : { features: out, truncated: false };
}

export function derivativeOf(x: SignalEval): SignalEval {
  const value = (t: number) => smoothDerivative(x, t, 'right');
  const left = (t: number) => smoothDerivative(x, t, 'left');
  return {
    value,
    left,
    features: (a, b, maxCount = DEFAULT_MAX_FEATURES) => {
      const q = x.features(a, b, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      return scannedFeatures(q.features.map((f) => f.t), a, b, maxCount, value, left, x.scale ?? x.period);
    },
    impulses: (a, b) => jumpsOf(x, a, b).filter((i) => i.t >= a && i.t <= b),
    period: x.period,
    scale: x.scale,
  };
}

export function finiteRiseDerivativeOf(x: SignalEval, tr: number): SignalEval {
  const half = tr / 2;
  // Ramps are centred on the jump: [tj − tr/2, tj + tr/2).
  const ramps = (t: number, isLeft: boolean) =>
    jumpsOf(x, t - half - tr, t + half + tr).reduce((s, j) => {
      const inside = isLeft ? t > j.t - half && t <= j.t + half : t >= j.t - half && t < j.t + half;
      return inside ? s + j.weight / tr : s;
    }, 0);
  const value = (t: number) => smoothDerivative(x, t, 'right') + ramps(t, false);
  const left = (t: number) => smoothDerivative(x, t, 'left') + ramps(t, true);
  return {
    value,
    left,
    features: (a, b, maxCount = DEFAULT_MAX_FEATURES) => {
      const q = x.features(a - half, b + half, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      const bps: number[] = [];
      for (const f of q.features) {
        if (f.kind === 'jump') bps.push(f.t - half, f.t + half);
        else bps.push(f.t);
      }
      return scannedFeatures(bps, a, b, maxCount, value, left, x.scale ?? x.period);
    },
    period: x.period,
    scale: x.scale,
  };
}

export function numericDerivativeOf(x: SignalEval, h: number): SignalEval {
  const value = (t: number) => (x.value(t + h / 2) - x.value(t - h / 2)) / h;
  const left = (t: number) => (leftValue(x, t + h / 2) - leftValue(x, t - h / 2)) / h;
  return {
    value,
    left,
    features: (a, b, maxCount = DEFAULT_MAX_FEATURES) => {
      const q = x.features(a - h, b + h, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      const bps = q.features.flatMap((f) => [f.t - h / 2, f.t + h / 2]);
      return scannedFeatures(bps, a, b, maxCount, value, left, x.scale ?? x.period);
    },
    period: x.period,
    scale: x.scale,
  };
}

// --- moving windows ----------------------------------------------------------------

/** x² as a signal (monotonic between x's features and zero crossings). */
export function squareOf(x: SignalEval): SignalEval {
  return {
    value: (t) => x.value(t) ** 2,
    left: (t) => leftValue(x, t) ** 2,
    features: (a, b, maxCount) => {
      const q = x.features(a, b, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      const out: Feature[] = q.features.map((f) => ({ ...f, left: f.left ** 2, right: f.right ** 2, kind: f.kind === 'jump' ? 'jump' : 'kink' }));
      for (const z of zeroCrossings(x, a, b, maxCount)) if (!out.some((f) => f.t === z.t)) out.push({ t: z.t, kind: 'min', left: 0, right: 0 });
      out.sort((p, r) => p.t - r.t);
      return { features: out, truncated: false };
    },
    period: x.period,
    scale: x.scale,
  };
}

function windowed(x: SignalEval, W: number, post: (mean: number) => number, integrand: SignalEval): SignalEval {
  const I = integralOf(integrand, 0, 0);
  const mean = (t: number) => (I.value(t) - I.value(t - W)) / W;
  const meanL = (t: number) => (leftValue(I, t) - leftValue(I, t - W)) / W;
  const value = (t: number) => post(mean(t));
  const left = (t: number) => post(meanL(t));
  return {
    value,
    left,
    features: (a, b, maxCount = DEFAULT_MAX_FEATURES) => {
      const q = x.features(a - W, b, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      const bps = q.features.flatMap((f) => [f.t, f.t + W]);
      return scannedFeatures(bps, a, b, maxCount, value, left, x.scale ?? x.period);
    },
    period: x.period,
    scale: x.scale,
  };
}

export function movingAverageOf(x: SignalEval, W: number): SignalEval {
  return windowed(x, W, (m) => m, x);
}

export function movingRmsOf(x: SignalEval, W: number): SignalEval {
  // Clamp tiny negative round-off before the square root.
  return windowed(x, W, (m) => Math.sqrt(Math.max(0, m)), squareOf(x));
}
