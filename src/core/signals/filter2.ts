/**
 * Second-order (RLC-type) filters, exact:
 *   LP: ω₀²/(s² + (ω₀/Q)s + ω₀²)   BP: (ω₀/Q)s/(…)   HP: s²/(…)
 * State x₁ = y_LP, x₂ = y_LP′:  x₁′ = x₂,  x₂′ = ω₀²(u − x₁) − (ω₀/Q)x₂;
 * BP = x₂/(Qω₀), HP = u − LP − BP.
 *
 * Stepping between the input's features with the closed-form state transition e^{Ah}
 * (exact for constant and linear input pieces, via A⁻¹) or Gauss–Legendre quadrature of
 * e^{A(b−s)}B·u(s) on smooth pieces. Periodic input: the exact periodic steady state
 * x(t₀) = (I − e^{AT})⁻¹·F; aperiodic input: at rest until t = 0.
 * A series RLC driven by v: the capacitor voltage is LP with f₀ = 1/(2π√(LC)),
 * Q = √(L/C)/R; the resistor voltage is BP; the inductor voltage is HP.
 */

import { scannedFeatures } from './operators';
import { MAX_SAMPLES } from './scan';
import { DEFAULT_MAX_FEATURES, type SignalEval } from './types';

export type Filter2Kind = 'low' | 'band' | 'high';

type M = number[][];

const NAN: SignalEval = { value: () => NaN, features: () => ({ features: [], truncated: false }) };

export function filter2Of(u: SignalEval, kind: Filter2Kind, f0: number, Q: number): SignalEval {
  if (!(f0 > 0 && Q > 0) || !Number.isFinite(f0 + Q)) return NAN;
  const w = 2 * Math.PI * f0;
  const A: M = [
    [0, 1],
    [-w * w, -w / Q],
  ];
  const B = [0, w * w];

  // Closed-form e^{Ah} for this 2×2 system: λ = −α ± β, α = ω/2Q.
  //   e^{Ah} = e^{−αh}·[C(h)·I + S(h)·(A + αI)],  C = cos βh, S = sin(βh)/β (underdamped),
  //   cosh / sinh(βh)/β (overdamped), 1 / h (critical).
  const alpha = w / (2 * Q);
  const disc = alpha * alpha - w * w;
  const beta = Math.sqrt(Math.abs(disc));
  const phiCache = new Map<number, M>();
  const phiOf = (h: number): M => {
    let p = phiCache.get(h);
    if (p) return p;
    let C: number;
    let S: number;
    if (Math.abs(disc) <= 1e-12 * w * w) (C = 1), (S = h);
    else if (disc < 0) (C = Math.cos(beta * h)), (S = Math.sin(beta * h) / beta);
    else (C = Math.cosh(beta * h)), (S = Math.sinh(beta * h) / beta);
    const e = Math.exp(-alpha * h);
    p = [
      [e * (C + S * (A[0]![0]! + alpha)), e * S * A[0]![1]!],
      [e * S * A[1]![0]!, e * (C + S * (A[1]![1]! + alpha))],
    ];
    if (phiCache.size > 8192) phiCache.clear();
    phiCache.set(h, p);
    return p;
  };
  // A⁻¹ = (1/ω²)·[[−ω/Q, −1], [ω², 0]]
  const Ai: M = [
    [-w / Q / (w * w), -1 / (w * w)],
    [1, 0],
  ];
  const mv = (m: M, v: number[]) => [m[0]![0]! * v[0]! + m[0]![1]! * v[1]!, m[1]![0]! * v[0]! + m[1]![1]! * v[1]!];
  const AiB = mv(Ai, B);
  const Ai2B = mv(Ai, AiB);
  /** Response to u = u0 + k·s over h: x(h) = Φx0 + (Φ − I)A⁻¹B·u0 + [(Φ − I)A⁻²B − A⁻¹B·h]·k. */
  const linStep = (h: number) => {
    const phi = phiOf(h);
    const PmI: M = [
      [phi[0]![0]! - 1, phi[0]![1]!],
      [phi[1]![0]!, phi[1]![1]! - 1],
    ];
    const g0 = mv(PmI, AiB);
    const t1 = mv(PmI, Ai2B);
    return { phi, g0, g1: [t1[0]! - AiB[0]! * h, t1[1]! - AiB[1]! * h] };
  };

  /** Classify [a, b]: linear input piece? */
  const classify = (a: number, b: number) => {
    const h = b - a;
    const ua = u.value(a);
    const ub = u.value(b - h * 1e-9);
    const k = (ub - ua) / (h * (1 - 1e-9));
    const tol = 1e-12 * Math.max(Math.abs(ua), Math.abs(ub), 1e-300);
    const lin = [0.21, 0.5, 0.83].every((q) => Math.abs(u.value(a + q * h) - (ua + k * q * h)) <= tol);
    return { lin, ua, k };
  };

  /** State at a + h from x at a. */
  const step = (x: number[], a: number, h: number, c: { lin: boolean; ua: number; k: number }): number[] => {
    if (h <= 0) return x;
    if (c.lin) {
      const s = linStep(h);
      return [0, 1].map((i) => s.phi[i]![0]! * x[0]! + s.phi[i]![1]! * x[1]! + s.g0[i]! * c.ua + s.g1[i]! * c.k);
    }
    // Smooth piece: split into sub-steps, each with a 5-point Gauss–Legendre convolution.
    const nSub = Math.max(1, Math.ceil((h * f0) * 16));
    let y = x;
    const hs = h / nSub;
    const s = linStep(hs);
    const GX = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664];
    const GW = [0.2369268850561891, 0.4786286704993665, 0.5688888888888889, 0.4786286704993665, 0.2369268850561891];
    for (let j = 0; j < nSub; j++) {
      const a0 = a + j * hs;
      let acc = [0, 0];
      for (let q = 0; q < 5; q++) {
        const tau = (hs / 2) * (GX[q]! + 1); // time from a0
        const P = phiOf(hs - tau);
        const uu = u.value(a0 + tau);
        acc = [acc[0]! + GW[q]! * (P[0]![1]! * B[1]! * uu), acc[1]! + GW[q]! * (P[1]![1]! * B[1]! * uu)];
      }
      y = [0, 1].map((i) => s.phi[i]![0]! * y[0]! + s.phi[i]![1]! * y[1]! + (acc[i]! * hs) / 2);
    }
    return y;
  };

  interface Seg {
    a: number;
    x: number[];
    c: { lin: boolean; ua: number; k: number };
  }
  const build = (a: number, b: number, x0: number[]): { segs: Seg[]; xb: number[] } | null => {
    const q = u.features(a, b, MAX_SAMPLES);
    if (q.truncated) return null;
    const cuts = [a, ...q.features.map((f) => f.t).filter((t) => t > a && t < b), b];
    const segs: Seg[] = [];
    let x = x0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const s0 = cuts[i]!;
      const s1 = cuts[i + 1]!;
      if (!(s1 > s0)) continue;
      const c = classify(s0, s1);
      segs.push({ a: s0, x, c });
      x = step(x, s0, s1 - s0, c);
    }
    return { segs, xb: x };
  };
  const find = (segs: Seg[], t: number) => {
    let lo = 0;
    let hi = segs.length - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >> 1;
      if (segs[m]!.a <= t) lo = m;
      else hi = m - 1;
    }
    return segs[lo]!;
  };
  const out = (x: number[], t: number) => {
    const lp = x[0]!;
    const bp = x[1]! / (Q * w);
    return kind === 'low' ? lp : kind === 'band' ? bp : u.value(t) - lp - bp;
  };
  const outLeft = (x: number[], t: number) => {
    const lp = x[0]!;
    const bp = x[1]! / (Q * w);
    if (kind !== 'high') return out(x, t);
    const ul = u.left ? u.left(t) : u.value(t);
    return ul - lp - bp;
  };

  let stateAt: (t: number) => number[];
  const T = u.period;
  let periodic = false;
  if (T !== undefined) {
    const zero = build(0, T, [0, 0]);
    if (!zero) return { ...NAN, warnings: ['Filter: the input has too many edges per period to compute exactly.'] };
    // x(0) = (I − Φ(T))⁻¹ · F
    const PhiT = phiOf(T);
    const I_P = [
      [1 - PhiT[0]![0]!, -PhiT[0]![1]!],
      [-PhiT[1]![0]!, 1 - PhiT[1]![1]!],
    ];
    const det = I_P[0]![0]! * I_P[1]![1]! - I_P[0]![1]! * I_P[1]![0]!;
    const F = zero.xb;
    const x0 = [(I_P[1]![1]! * F[0]! - I_P[0]![1]! * F[1]!) / det, (-I_P[1]![0]! * F[0]! + I_P[0]![0]! * F[1]!) / det];
    const ss = build(0, T, x0)!;
    stateAt = (t) => {
      const k = Math.floor(t / T);
      const tt = Math.min(t - k * T, T);
      const s = find(ss.segs, tt);
      return step(s.x, s.a, tt - s.a, s.c);
    };
    periodic = true;
  } else {
    const C = Math.max((u.scale ?? 1 / f0) * 16, 1e-15);
    const starts = new Map<number, number[]>([[0, [0, 0]]]);
    const chunks = new Map<number, Seg[] | null>();
    let maxJ = 0;
    stateAt = (t) => {
      if (t < 0) return [0, 0];
      const j = Math.floor(t / C);
      if (j > 1e5) return [NaN, NaN];
      while (maxJ < j) {
        const r = build(maxJ * C, (maxJ + 1) * C, starts.get(maxJ)!);
        if (!r) return [NaN, NaN];
        chunks.set(maxJ, r.segs);
        starts.set(maxJ + 1, r.xb);
        maxJ++;
      }
      let segs = chunks.get(j);
      if (segs === undefined) {
        const r = build(j * C, (j + 1) * C, starts.get(j)!);
        segs = r ? r.segs : null;
        if (chunks.size < 4096) chunks.set(j, segs);
      }
      if (!segs || !segs.length) return [NaN, NaN];
      const s = find(segs, t);
      return step(s.x, s.a, t - s.a, s.c);
    };
  }

  const value = (t: number) => out(stateAt(t), t);
  const left = (t: number) => outLeft(stateAt(t), t);
  return {
    value,
    left,
    features: (a, b, maxCount = DEFAULT_MAX_FEATURES) => {
      const q = u.features(a, b, maxCount);
      if (q.truncated) return { features: [], truncated: true };
      return scannedFeatures(q.features.map((f) => f.t), a, b, maxCount, value, left, Math.min(u.scale ?? Infinity, 1 / f0));
    },
    period: periodic ? T : undefined,
    scale: Math.min(u.scale ?? Infinity, 1 / f0),
    ...(u.impulses ? { warnings: ['Filter: impulses of the input are ignored.'] } : {}),
  };
}
