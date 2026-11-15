/**
 * Non-periodic and table-based generators: exponential, damped sinusoid,
 * piecewise (point table) and digital bit sequences. All are exact: features are
 * computed analytically, never by sampling.
 */

import type { BitsParams, GeneratorDef, PiecewiseParams } from '../model/signal-defs';
import { DEFAULT_MAX_FEATURES, type Feature, type FeatureQuery, type SignalEval } from './types';

const EMPTY: FeatureQuery = { features: [], truncated: false };

export function compileExtra(def: GeneratorDef): SignalEval | null {
  const start = def.timing.delay;
  switch (def.generator) {
    case 'exponential':
      return exponential(def.params.initial, def.params.final, def.params.tau, start);
    case 'damped':
      return damped(def.params.amplitude, def.params.offset, def.params.tau, def.timing.frequency, def.timing.phaseDeg, start);
    case 'piecewise':
      return piecewise(def.params, start);
    case 'bits':
      return bits(def.params, start);
    default:
      return null;
  }
}

/** y = final + (initial − final)·e^(−(t − start)/τ) for t ≥ start; `initial` before. */
function exponential(initial: number, final: number, tau: number, start: number): SignalEval {
  if (!(tau > 0)) return invalid();
  const value = (t: number) => (t < start ? initial : final + (initial - final) * Math.exp(-(t - start) / tau));
  return {
    value,
    left: (t) => (t <= start ? initial : value(t)),
    // Continuous at the start (value = initial there), monotonic afterwards: one corner.
    features: (t0, t1) => (start >= t0 && start <= t1 ? { features: [{ t: start, kind: 'kink', left: initial, right: initial }], truncated: false } : EMPTY),
    scale: tau,
    extent: [start, start + 5 * tau],
  };
}

/** y = offset + A·e^(−u/τ)·sin(ωu + φ), u = t − start ≥ 0; `offset` before the start. */
function damped(A: number, offset: number, tau: number, f: number, phaseDeg: number, start: number): SignalEval {
  if (!(tau > 0) || !(f > 0)) return invalid();
  const w = 2 * Math.PI * f;
  const phi = (phaseDeg * Math.PI) / 180;
  const v = (u: number) => offset + A * Math.exp(-u / tau) * Math.sin(w * u + phi);
  const value = (t: number) => (t < start ? offset : v(t - start));
  // Extrema where d/du = 0  ⇔  tan(ωu + φ) = ωτ  ⇔  ωu + φ = atan(ωτ) + kπ.
  const theta = Math.atan(w * tau);
  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const out: Feature[] = [];
    if (start >= t0 && start <= t1) {
      const R = v(0);
      out.push({ t: start, kind: R === offset ? 'kink' : 'jump', left: offset, right: R });
    }
    const u0 = Math.max(0, t0 - start);
    const u1 = t1 - start;
    if (u1 > 0 && A !== 0) {
      const k0 = Math.ceil((w * u0 + phi - theta) / Math.PI - 1e-12);
      const k1 = Math.floor((w * u1 + phi - theta) / Math.PI + 1e-12);
      if (k1 - k0 + 1 > maxCount) return { features: out, truncated: true };
      for (let k = k0; k <= k1; k++) {
        const u = (theta + k * Math.PI - phi) / w;
        if (u <= 0) continue;
        const y = v(u);
        out.push({ t: start + u, kind: y > offset ? 'max' : 'min', left: y, right: y });
      }
    }
    return { features: out, truncated: false };
  };
  return { value, left: (t) => (t <= start ? offset : value(t)), features, scale: Math.min(1 / f, tau), extent: [start, start + 5 * tau] };
}

// --- knot-based signals (piecewise tables, bit streams) -----------------------------

/** A breakpoint in local time with the values just before (L) and after (R) it. */
interface Knot {
  u: number;
  L: number;
  R: number;
}

/**
 * Signal defined by knots in local time (t − start). Between knots: linear from R(u_j)
 * to L(u_j+1), or constant R(u_j) for 'step'. Repeat: period = last.u − first.u.
 * Otherwise `before` / `after` hold outside the table.
 */
function knotSignal(knots: Knot[], mode: 'linear' | 'step', repeat: boolean, start: number, before: number, after: number): SignalEval {
  const n = knots.length;
  if (n < 2) return invalid();
  const u0 = knots[0]!.u;
  const uN = knots[n - 1]!.u;
  const P = uN - u0;
  const periodic = repeat && P > 0;

  const segValue = (j: number, um: number) => {
    const a = knots[j]!;
    if (mode === 'step') return a.R;
    const b = knots[j + 1]!;
    return b.u === a.u ? a.R : a.R + ((b.L - a.R) * (um - a.u)) / (b.u - a.u);
  };
  /** Index of the last knot with u <= um (within the table). */
  const find = (um: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (knots[m]!.u <= um) lo = m;
      else hi = m - 1;
    }
    return lo;
  };
  const wrap = (u: number) => u0 + ((((u - u0) % P) + P) % P);

  const value = (t: number) => {
    const u = t - start;
    if (!periodic) {
      if (u < u0) return before;
      if (u >= uN) return after;
      return segValue(find(u), u);
    }
    const um = wrap(u);
    return segValue(Math.min(find(um), n - 2), um);
  };
  const left = (t: number) => {
    const u = t - start;
    if (!periodic) {
      if (u <= u0) return before;
      if (u > uN) return after;
      const j = find(u);
      if (knots[j]!.u === u) return knots[j]!.L;
      return segValue(j, u);
    }
    const um = wrap(u);
    if (um === u0) return knots[n - 1]!.L; // cycle boundary: end of the previous cycle
    const j = find(um);
    if (knots[j]!.u === um) return knots[j]!.L;
    return segValue(j, um);
  };

  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const out: Feature[] = [];
    const push = (t: number, L: number, R: number) => {
      if (t < t0 || t > t1) return;
      out.push({ t, kind: L === R ? 'kink' : 'jump', left: L, right: R });
    };
    if (!periodic) {
      knots.forEach((k, i) => push(start + k.u, i === 0 ? before : k.L, i === n - 1 ? after : k.R));
      return { features: out.slice(0, maxCount), truncated: out.length > maxCount };
    }
    const c0 = Math.floor((t0 - start - u0) / P);
    const c1 = Math.floor((t1 - start - u0) / P);
    if ((c1 - c0 + 1) * (n - 1) > maxCount) return { features: [], truncated: true };
    for (let c = c0; c <= c1; c++) {
      for (let j = 0; j < n - 1; j++) {
        const k = knots[j]!;
        push(start + c * P + k.u, j === 0 ? knots[n - 1]!.L : k.L, k.R);
      }
    }
    return { features: out, truncated: false };
  };

  return {
    value,
    left,
    features,
    period: periodic ? P : undefined,
    piecewiseConstant: mode === 'step',
    scale: P > 0 ? P / Math.max(1, n - 1) : undefined,
    extent: periodic ? undefined : [start + u0, start + uN],
  };
}

/** Piecewise table: points grouped by time (equal times = vertical step). */
function piecewise(p: PiecewiseParams, start: number): SignalEval {
  const pts = [...p.points].filter((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]));
  pts.sort((a, b) => a[0] - b[0]); // stable: keeps the order of points with equal times
  if (pts.length < 2) return invalid();
  const knots: Knot[] = [];
  for (const [t, y] of pts) {
    const last = knots[knots.length - 1];
    if (last && last.u === t) last.R = y;
    else knots.push({ u: t, L: y, R: y });
  }
  if (p.interp === 'step') {
    for (let j = 1; j < knots.length; j++) knots[j]!.L = knots[j - 1]!.R;
  }
  if (knots.length < 2) return invalid();
  return knotSignal(knots, p.interp, p.repeat, start, knots[0]!.L, knots[knots.length - 1]!.R);
}

/** Bit stream → step knots at every level change (plus frame start and end). */
export function bitKnots(p: BitsParams): Knot[] | null {
  const bitsStr = p.bits.replace(/[^01]/g, '');
  if (!bitsStr || !(p.bitTime > 0)) return null;
  const T = p.bitTime;
  const segs: Array<[number, number]> = []; // [start time, level]
  [...bitsStr].forEach((b, k) => {
    const one = b === '1';
    const t = k * T;
    if (p.encoding === 'nrz') segs.push([t, one ? p.high : p.low]);
    else if (p.encoding === 'rz') {
      segs.push([t, one ? p.high : p.low]);
      segs.push([t + T / 2, p.low]);
    } else {
      // Manchester, IEEE 802.3: 0 = high→low, 1 = low→high at mid-bit.
      segs.push([t, one ? p.low : p.high]);
      segs.push([t + T / 2, one ? p.high : p.low]);
    }
  });
  const idle = p.idle === 'high' ? p.high : p.low;
  const knots: Knot[] = [];
  let prev = idle;
  for (const [t, lvl] of segs) {
    if (knots.length === 0 || lvl !== prev) knots.push({ u: t, L: prev, R: lvl });
    prev = lvl;
  }
  knots.push({ u: bitsStr.length * T, L: prev, R: idle });
  return knots;
}

function bits(p: BitsParams, start: number): SignalEval {
  const knots = bitKnots(p);
  if (!knots) return invalid();
  if (p.repeat) {
    // Close the frame: the next frame starts with the first level.
    knots[knots.length - 1]!.R = knots[0]!.R;
    knots[0]!.L = knots[knots.length - 1]!.L;
  }
  const idle = p.idle === 'high' ? p.high : p.low;
  return knotSignal(knots, 'step', p.repeat, start, idle, idle);
}

function invalid(): SignalEval {
  return { value: () => NaN, features: () => EMPTY };
}
