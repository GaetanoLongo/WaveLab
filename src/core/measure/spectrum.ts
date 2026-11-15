/**
 * Exact harmonic spectrum (Fourier series) of a signal over an analysis window
 * [t0, t0 + N/f1] — no FFT, no sampling grid, no leakage for periodic signals.
 * Method adapted from ModulationToy (same author, MIT), generalised from
 * piecewise-constant to any WaveLab signal:
 *
 *   c_k = (1/T) ∫ x(t) e^(−jω_k (t − t0)) dt,  ω_k = 2πk/T,  T = N/f1
 *
 * Between features x is smooth. Linear stretches (constants, ramps — square, pulse,
 * triangle, sawtooth, PWM, bit streams, piecewise tables) use the exact closed form
 * for every k; other stretches use adaptive Gauss–Legendre with panels refined to the
 * harmonic's wavelength. Ideal impulses (from deriv) add w·e^(−jω_k t)/T exactly.
 * Bin k is harmonic order h = k/N of f1. THD comes from the exact RMS (independent of
 * how many harmonics are listed).
 */

import { measureInterval } from './measure';
import { DEFAULT_MAX_FEATURES, type SignalEval } from '../signals/types';
import { leftValue } from '../signals/scan';

export interface SpectrumOptions {
  /** Fundamental frequency (Hz). */
  f1: number;
  /** Window length in fundamental periods (integer ≥ 1). */
  periods: number;
  /** Window start (s). */
  t0: number;
  /** Highest harmonic order to compute. */
  maxOrder: number;
}

export interface Spectrum {
  f1: number;
  window: [number, number];
  /** Harmonic orders h = k/N for k = 0…K. */
  orders: number[];
  /** One-sided peak amplitudes (index 0 = DC mean). */
  amp: number[];
  /** Phase of each component as a cosine, cos(2π·h·f1·(t − t0) + φ), in degrees. */
  phaseDeg: number[];
  dc: number;
  rms: number;
  /** Peak amplitude of the fundamental (order 1). */
  fundamental: number;
  /** Total harmonic distortion relative to the fundamental's RMS (NaN without a fundamental). */
  thd: number;
  /** True if the signal is periodic with a period that divides the window exactly. */
  exactWindow: boolean;
  /** The window holds too many edges/breakpoints to integrate exactly: no result. */
  unresolved?: boolean;
}

const GL_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
const GL_W = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891];

export function harmonicSpectrum(s: SignalEval, o: SpectrumOptions): Spectrum {
  const N = Math.max(1, Math.round(o.periods));
  const T = N / o.f1;
  const a = o.t0;
  const b = a + T;
  const K = Math.max(1, Math.round(o.maxOrder * N));
  const re = new Float64Array(K + 1);
  const im = new Float64Array(K + 1);

  // Segments between features (exact limits at the ends).
  const { features, truncated } = s.features(a, b, DEFAULT_MAX_FEATURES);
  if (truncated || !(T > 0) || !Number.isFinite(T)) {
    const nan = Array.from({ length: K + 1 }, () => NaN);
    return {
      f1: o.f1, window: [a, b], orders: nan.map((_, k) => k / N), amp: nan, phaseDeg: nan,
      dc: NaN, rms: NaN, fundamental: NaN, thd: NaN, exactWindow: false, unresolved: true,
    };
  }
  const cuts = [a, ...features.map((f) => f.t).filter((t) => t > a && t < b), b];
  const scale = Math.max(1e-300, ...features.map((f) => Math.max(Math.abs(f.left), Math.abs(f.right))), Math.abs(s.value(a)));

  for (let i = 0; i + 1 < cuts.length; i++) {
    const x0 = cuts[i]!;
    const x1 = cuts[i + 1]!;
    if (!(x1 > x0)) continue;
    const v0 = s.value(x0);
    const v1 = leftValue(s, x1);
    const vm = s.value((x0 + x1) / 2);
    const vq = s.value(x0 + (x1 - x0) / 4);
    if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue; // undefined parts contribute nothing
    const linear =
      Math.abs(vm - (v0 + v1) / 2) <= 1e-11 * scale && Math.abs(vq - (0.75 * v0 + 0.25 * v1)) <= 1e-11 * scale;
    if (linear) {
      addLinear(re, im, v0, v1, x0 - a, x1 - a, T, K);
    } else {
      addSmooth(re, im, (t) => s.value(t), x0, x1, a, T, K);
    }
  }
  for (const imp of s.impulses?.(a, b) ?? []) {
    if (imp.t < a || imp.t >= b) continue;
    for (let k = 0; k <= K; k++) {
      const th = (-2 * Math.PI * k * (imp.t - a)) / T;
      re[k] = re[k]! + imp.weight * Math.cos(th);
      im[k] = im[k]! + imp.weight * Math.sin(th);
    }
  }

  const orders: number[] = [];
  const amp: number[] = [];
  const phaseDeg: number[] = [];
  for (let k = 0; k <= K; k++) {
    const cr = re[k]! / T;
    const ci = im[k]! / T;
    orders.push(k / N);
    let A = k === 0 ? cr : 2 * Math.hypot(cr, ci);
    // Rounding residue relative to the signal's scale is an exact zero (no phase either).
    const zero = Math.abs(A) <= 1e-10 * scale;
    if (zero) A = 0;
    amp.push(A);
    phaseDeg.push(k === 0 || zero ? 0 : (Math.atan2(ci, cr) * 180) / Math.PI);
  }
  const dc = amp[0]!;
  const fundamental = amp[N] ?? 0;
  const rms = measureInterval(s, a, b).rms;
  const hasFund = fundamental > 1e-9 * scale;
  const dist2 = Math.max(0, rms * rms - dc * dc - (fundamental * fundamental) / 2);
  const thd = hasFund ? Math.sqrt(dist2) / (fundamental / Math.SQRT2) : NaN;
  const P = s.period;
  const exactWindow = P !== undefined && Math.abs(T / P - Math.round(T / P)) < 1e-9 * Math.max(1, T / P) && Math.round(T / P) >= 1;
  return { f1: o.f1, window: [a, b], orders, amp, phaseDeg, dc, rms, fundamental, thd, exactWindow };
}

/**
 * Exact ∫ (p + q·τ) e^(−jωτ) dτ over [u0, u1] (τ relative to the window start) for every k.
 * With F(τ) = e^(−jωτ)·[ (p + qτ)/(−jω) + q/ω² ], the integral is F(u1) − F(u0).
 */
function addLinear(re: Float64Array, im: Float64Array, v0: number, v1: number, u0: number, u1: number, T: number, K: number) {
  const q = (v1 - v0) / (u1 - u0);
  const p = v0 - q * u0;
  re[0] = re[0]! + ((v0 + v1) / 2) * (u1 - u0);
  for (let k = 1; k <= K; k++) {
    const w = (2 * Math.PI * k) / T;
    const F = (u: number): [number, number] => {
      const c = Math.cos(w * u);
      const sn = -Math.sin(w * u); // e^(−jωu) = c + j·sn
      // A = (p + q u)/(−jω) = j (p + q u)/ω ; B = q/ω²  →  bracket = B + jA'
      const Ai = (p + q * u) / w; // imaginary part of (p+qu)/(−jω)
      const Br = q / (w * w);
      // (c + j sn)(Br + j Ai) = (c·Br − sn·Ai) + j(c·Ai + sn·Br)
      return [c * Br - sn * Ai, c * Ai + sn * Br];
    };
    const [r1, i1] = F(u1);
    const [r0, i0] = F(u0);
    re[k] = re[k]! + r1 - r0;
    im[k] = im[k]! + i1 - i0;
  }
}

/** Adaptive Gauss–Legendre of x(t)·e^(−jω_k(t − a)) on a smooth segment, for every k. */
function addSmooth(re: Float64Array, im: Float64Array, f: (t: number) => number, x0: number, x1: number, a: number, T: number, K: number) {
  const len = x1 - x0;
  // Panels: enough for the highest harmonic (≥ 6 panels per wavelength), at least 4.
  const n = Math.min(20000, Math.max(4, Math.ceil(((len * K) / T) * 6)));
  const h = len / n;
  // Sample x at all Gauss nodes once, then accumulate every harmonic.
  const ts: number[] = [];
  const ws: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = x0 + (i + 0.5) * h;
    for (let j = 0; j < 5; j++) {
      ts.push(m + (h / 2) * GL_X[j]!);
      ws.push((h / 2) * GL_W[j]!);
    }
  }
  const xs = ts.map(f);
  for (let k = 0; k <= K; k++) {
    const w = (2 * Math.PI * k) / T;
    let sr = 0;
    let si = 0;
    for (let i = 0; i < ts.length; i++) {
      const th = w * (ts[i]! - a);
      const v = xs[i]! * ws[i]!;
      sr += v * Math.cos(th);
      si -= v * Math.sin(th);
    }
    re[k] = re[k]! + sr;
    im[k] = im[k]! + si;
  }
}
