/**
 * Periodic shapes defined over one normalized cycle u ∈ [0, 1).
 * Each shape knows its value and its exact local features (jumps, kinks, extrema).
 */

import type {
  GeneratorDef,
  PulseParams,
  SawtoothParams,
  SineParams,
  SquareParams,
  TriangleParams,
} from '../model/signal-defs';
import type { FeatureKind } from './types';

export interface LocalFeature {
  /** Position in the cycle, 0 <= u < 1. */
  u: number;
  kind: FeatureKind;
  left: number;
  right: number;
}

export interface PeriodicShape {
  /** Right-continuous value at cycle position u ∈ [0, 1). */
  value(u: number): number;
  /** Sorted by u, unique u values. */
  features: LocalFeature[];
}

const TWO_PI = 2 * Math.PI;
const U_EPS = 1e-12;

export function sineShape(p: SineParams): PeriodicShape {
  const { amplitude: A, offset: o } = p;
  return {
    value: (u) => o + A * Math.sin(TWO_PI * u),
    features: A === 0 ? [] : [
      extremum(0.25, o + A, A > 0 ? 'max' : 'min'),
      extremum(0.75, o - A, A > 0 ? 'min' : 'max'),
    ],
  };
}

export function cosineShape(p: SineParams): PeriodicShape {
  const { amplitude: A, offset: o } = p;
  return {
    value: (u) => o + A * Math.cos(TWO_PI * u),
    features: A === 0 ? [] : [
      extremum(0, o + A, A > 0 ? 'max' : 'min'),
      extremum(0.5, o - A, A > 0 ? 'min' : 'max'),
    ],
  };
}

export function squareShape(p: SquareParams): PeriodicShape {
  const { high, low } = p;
  const d = clamp01(p.duty);
  if (d <= 0) return constantShape(low);
  if (d >= 1) return constantShape(high);
  return {
    value: (u) => (u < d ? high : low),
    features: mergeFeatures([jump(0, low, high), jump(d, high, low)]),
  };
}

/** Triangle: minimum at u = 0, maximum at u = 0.5. */
export function triangleShape(p: TriangleParams): PeriodicShape {
  const { amplitude: A, offset: o } = p;
  return {
    value: (u) => (u < 0.5 ? o - A + 4 * A * u : o + A - 4 * A * (u - 0.5)),
    features: A === 0 ? [] : [
      extremum(0, o - A, A > 0 ? 'min' : 'max'),
      extremum(0.5, o + A, A > 0 ? 'max' : 'min'),
    ],
  };
}

/** Rising: ramps from o−A to o+A, jumps back at u = 0. Falling: the mirror image. */
export function sawtoothShape(p: SawtoothParams): PeriodicShape {
  const { amplitude: A, offset: o } = p;
  if (A === 0) return constantShape(o);
  const s = p.slope === 'rising' ? 1 : -1;
  return {
    value: (u) => o + s * (-A + 2 * A * u),
    features: [jump(0, o + s * A, o - s * A)],
  };
}

/** Trapezoidal pulse (SPICE PULSE convention), times in seconds within `period`. */
export function pulseShape(p: PulseParams, period: number): PeriodicShape {
  const { high, low } = p;
  const T = period;
  const r = clampRange(p.rise, 0, T);
  const w = clampRange(p.width, 0, T - r);
  const f = clampRange(p.fall, 0, T - r - w);
  if (r + w + f <= 0) return constantShape(low);
  if (r === 0 && f === 0 && w >= T) return constantShape(high);

  const ur = r / T;
  const uw = (r + w) / T;
  const uf = (r + w + f) / T;

  const value = (u: number): number => {
    if (u < ur) return low + ((high - low) * u) / ur;
    if (u < uw) return high;
    if (u < uf) return high - ((high - low) * (u - uw)) / (uf - uw);
    return low;
  };

  const cand: LocalFeature[] = [];
  if (r > 0) {
    cand.push(kink(0, low), kink(ur, high));
  } else {
    cand.push(jump(0, low, high));
  }
  if (f > 0) {
    cand.push(kink(uw, high));
    if (uf < 1 - U_EPS) cand.push(kink(uf, low));
  } else {
    cand.push(jump(uw >= 1 - U_EPS ? 0 : uw, high, low));
  }
  return { value, features: mergeFeatures(cand) };
}

export function constantShape(level: number): PeriodicShape {
  return { value: () => level, features: [] };
}

export function shapeFor(def: GeneratorDef): PeriodicShape {
  switch (def.generator) {
    case 'sine':
      return sineShape(def.params);
    case 'cosine':
      return cosineShape(def.params);
    case 'square':
      return squareShape(def.params);
    case 'pulse':
      return pulseShape(def.params, 1 / def.timing.frequency);
    case 'triangle':
      return triangleShape(def.params);
    case 'sawtooth':
      return sawtoothShape(def.params);
    case 'dc':
      return constantShape(def.params.level);
    default:
      // Non-periodic generators are compiled in extra.ts and never reach here.
      return constantShape(NaN);
  }
}

/** Left limit of the shape at cycle position u (accounts for jumps, incl. at u = 0 → u = 1⁻). */
export function shapeLeftValue(shape: PeriodicShape, u: number): number {
  for (const f of shape.features) {
    if (Math.abs(f.u - u) < U_EPS || (f.u === 0 && Math.abs(u - 1) < U_EPS)) return f.left;
  }
  return shape.value(u);
}

// ---------------------------------------------------------------------------

function extremum(u: number, v: number, kind: 'max' | 'min'): LocalFeature {
  return { u, kind, left: v, right: v };
}

function kink(u: number, v: number): LocalFeature {
  return { u, kind: 'kink', left: v, right: v };
}

function jump(u: number, left: number, right: number): LocalFeature {
  return { u, kind: 'jump', left, right };
}

/**
 * Sort and merge features that share the same u: the merged feature takes the
 * first left limit and the last right limit. Pairs of jumps that cancel out are dropped.
 */
export function mergeFeatures(list: LocalFeature[]): LocalFeature[] {
  const sorted = [...list].sort((a, b) => a.u - b.u);
  const out: LocalFeature[] = [];
  for (const f of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.u - f.u) < U_EPS) {
      last.right = f.right;
      if (last.kind === 'jump' || f.kind === 'jump') {
        last.kind = last.left !== last.right ? 'jump' : 'kink';
      }
    } else {
      out.push({ ...f });
    }
  }
  return out;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function clampRange(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), Math.max(lo, hi));
}
