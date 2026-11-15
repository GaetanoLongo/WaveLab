/**
 * Chirp (frequency sweep), seeded noise and PRBS generators. All exact: chirp
 * extrema are solved in closed form, noise and PRBS are piecewise linear / constant
 * between known knots.
 */

import type { ChirpParams, GeneratorDef, NoiseParams, PrbsParams } from '../model/signal-defs';
import { compileExtra } from './extra';
import { DEFAULT_MAX_FEATURES, type Feature, type FeatureQuery, type SignalEval } from './types';

const NAN: SignalEval = { value: () => NaN, features: () => ({ features: [], truncated: false }) };

// --- chirp -------------------------------------------------------------------------

export function compileSource(def: GeneratorDef): SignalEval | null {
  const start = def.timing.delay;
  switch (def.generator) {
    case 'chirp':
      return chirp(def.params, start);
    case 'noise':
      return noise(def.params, start);
    case 'prbs':
      return prbs(def.params, start);
    default:
      return null;
  }
}

export function chirp(p: ChirpParams, start: number): SignalEval {
  const { amplitude: A, offset: o, f0, f1, duration: T } = p;
  if (!(f0 > 0 && f1 > 0 && T > 0) || !Number.isFinite(f0 + f1 + T)) return NAN;
  const phi0 = (p.phaseDeg * Math.PI) / 180;
  const k = f1 / f0;
  const log = p.sweep === 'log' && Math.abs(k - 1) > 1e-12;
  const lnk = Math.log(k);
  const C = log ? (2 * Math.PI * f0 * T) / lnk : 0;
  const a = (f1 - f0) / (2 * T); // linear: φ = φ0 + 2π(f0 u + a u²)

  /** Phase at local time u ∈ [0, T]. */
  const phase = (u: number) => (log ? phi0 + C * (Math.pow(k, u / T) - 1) : phi0 + 2 * Math.PI * (f0 * u + a * u * u));
  /** Local time where the phase equals θ (phase is increasing). */
  const timeOf = (theta: number) => {
    if (log) return (T * Math.log(1 + (theta - phi0) / C)) / lnk;
    const c = (theta - phi0) / (2 * Math.PI);
    return Math.abs(a) < 1e-300 ? c / f0 : (2 * c) / (f0 + Math.sqrt(f0 * f0 + 4 * a * c));
  };
  const inner = (u: number) => o + A * Math.sin(phase(u));
  const P = p.repeat ? T : undefined;

  /** Local position (cycle index, u) for global t. */
  const local = (t: number): [number, number] => {
    const u = t - start;
    if (!P) return [0, u];
    const c = Math.floor(u / P);
    return [c, u - c * P];
  };
  const value = (t: number) => {
    const [, u] = local(t);
    return u >= 0 && u < T ? inner(u) : o;
  };
  const left = (t: number) => {
    const [, u] = local(t);
    if (P && u === 0) return inner(T); // end of the previous sweep
    return u > 0 && u <= T ? inner(u) : o;
  };

  /** Features of one sweep (local u in [ua, ub] ⊂ [0, T]) shifted to global `base`. */
  const sweepFeatures = (ua: number, ub: number, base: number, out: Feature[], maxCount: number): boolean => {
    const nLo = Math.ceil((phase(ua) - Math.PI / 2) / Math.PI - 1e-12);
    const nHi = Math.floor((phase(ub) - Math.PI / 2) / Math.PI + 1e-12);
    if (nHi - nLo + 1 + out.length > maxCount) return false;
    for (let n = nLo; n <= nHi; n++) {
      const u = timeOf(Math.PI / 2 + n * Math.PI);
      if (!(u > 0 && u < T) || u < ua || u > ub) continue;
      const v = inner(u);
      out.push({ t: base + u, kind: v > o ? 'max' : 'min', left: v, right: v });
    }
    return true;
  };

  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const out: Feature[] = [];
    if (!(t1 >= t0)) return { features: out, truncated: false };
    const edge = (t: number, L: number, R: number) => {
      if (t >= t0 && t <= t1) out.push({ t, kind: L === R ? 'kink' : 'jump', left: L, right: R });
    };
    const cycles: number[] = [];
    if (P) {
      const c0 = Math.floor((t0 - start) / P);
      const c1 = Math.floor((t1 - start) / P);
      if (c1 - c0 > maxCount) return { features: [], truncated: true };
      for (let c = c0; c <= c1; c++) cycles.push(c);
    } else cycles.push(0);
    for (const c of cycles) {
      const base = start + c * (P ?? 0);
      edge(base, P ? inner(T) : o, inner(0));
      if (!P) edge(base + T, inner(T), o);
      const ua = Math.max(0, t0 - base);
      const ub = Math.min(T, t1 - base);
      if (ub > ua && !sweepFeatures(ua, ub, base, out, maxCount)) return { features: out, truncated: true };
    }
    out.sort((x, y) => x.t - y.t);
    return { features: out, truncated: false };
  };

  return {
    value,
    left,
    features,
    period: P,
    extent: P ? undefined : [start, start + T],
    scale: 1 / Math.max(f0, f1),
  };
}

// --- noise -------------------------------------------------------------------------

/** 32-bit integer hash → uniform in (0, 1). */
function hash01(seed: number, k: number): number {
  let h = Math.imul(k | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77) ^ 0x27d4eb2f;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return ((h >>> 0) + 0.5) / 4294967296;
}

/** The normalised sample sequence (exact mean and standard deviation). */
export function noiseSamples(p: NoiseParams): Float64Array {
  const L = Math.max(2, Math.round(p.length));
  const x = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    if (p.distribution === 'uniform') x[k] = hash01(p.seed, k) - 0.5;
    else {
      const u1 = hash01(p.seed, 2 * k);
      const u2 = hash01(p.seed ^ 0x5bd1e995, 2 * k + 1);
      x[k] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
  }
  let m = 0;
  for (const v of x) m += v;
  m /= L;
  let s2 = 0;
  for (const v of x) s2 += (v - m) ** 2;
  const sd = Math.sqrt(s2 / L) || 1;
  for (let k = 0; k < L; k++) x[k] = p.mean + (p.rms * (x[k]! - m)) / sd;
  return x;
}

export function noise(p: NoiseParams, start: number): SignalEval {
  const dt = p.sampleTime;
  if (!(dt > 0) || !Number.isFinite(dt)) return NAN;
  const x = noiseSamples(p);
  const L = x.length;
  const at = (k: number) => x[((k % L) + L) % L]!;
  const hold = p.interp === 'hold';
  const pos = (t: number): [number, number] => {
    const q = (t - start) / dt;
    const k = Math.floor(q);
    return [k, q - k];
  };
  const value = (t: number) => {
    const [k, f] = pos(t);
    return hold ? at(k) : at(k) + (at(k + 1) - at(k)) * f;
  };
  const left = (t: number) => {
    const [k, f] = pos(t);
    if (f === 0) return hold ? at(k - 1) : at(k);
    return value(t);
  };
  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const out: Feature[] = [];
    const k0 = Math.ceil((t0 - start) / dt);
    const k1 = Math.floor((t1 - start) / dt);
    if (!(k1 - k0 + 1 <= maxCount)) return { features: [], truncated: true };
    for (let k = k0; k <= k1; k++) {
      const t = start + k * dt;
      const v = at(k);
      if (hold) {
        const L0 = at(k - 1);
        if (L0 !== v) out.push({ t, kind: 'jump', left: L0, right: v });
      } else {
        const a = at(k - 1);
        const b = at(k + 1);
        out.push({ t, kind: v > a && v > b ? 'max' : v < a && v < b ? 'min' : 'kink', left: v, right: v });
      }
    }
    return { features: out, truncated: false };
  };
  return { value, left, features, period: L * dt, scale: dt, piecewiseConstant: hold };
}

// --- PRBS --------------------------------------------------------------------------

/** Feedback taps (1-based register stages) of maximal-length LFSRs, PRBS-3 … PRBS-15. */
export const PRBS_TAPS: Record<number, number[]> = {
  3: [3, 2],
  4: [4, 3],
  5: [5, 3],
  6: [6, 5],
  7: [7, 6],
  8: [8, 6, 5, 4],
  9: [9, 5],
  10: [10, 7],
  11: [11, 9],
  12: [12, 11, 10, 4],
  13: [13, 12, 11, 8],
  14: [14, 13, 12, 2],
  15: [15, 14],
};

/** One period (2ⁿ − 1 bits) of the Fibonacci LFSR sequence, as a string of 0/1. */
export function prbsBits(order: number, seed: number): string | null {
  const taps = PRBS_TAPS[order];
  if (!taps) return null;
  const mask = 2 ** order - 1;
  let state = seed & mask;
  if (state === 0) return null;
  const n = mask;
  const out: string[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = state & 1 ? '1' : '0';
    let fb = 0;
    for (const tp of taps) fb ^= (state >> (order - tp)) & 1;
    state = ((state >> 1) | (fb << (order - 1))) & mask;
  }
  return out.join('');
}

export function prbs(p: PrbsParams, start: number): SignalEval {
  const bits = prbsBits(p.order, p.seed);
  if (!bits) return NAN;
  return (
    compileExtra({
      generator: 'bits',
      timing: { frequency: 1, phaseDeg: 0, delay: start },
      window: { mode: 'infinite' },
      params: { bits, bitTime: p.bitTime, high: p.high, low: p.low, encoding: 'nrz', repeat: true },
    }) ?? NAN
  );
}
