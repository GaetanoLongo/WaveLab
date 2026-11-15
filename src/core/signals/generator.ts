/**
 * Compiles a GeneratorDef (pure data) into an evaluable SignalEval.
 *
 * Global → local mapping:
 *   τ = t − delay                       (local time, used for the window)
 *   x = f·τ + φ/360                     (cycle coordinate; +φ leads)
 *   u = x − ⌊x⌋ ∈ [0, 1)                (position in the cycle)
 */

import type { GeneratorDef, SignalWindow } from '../model/signal-defs';
import { compileExtra } from './extra';
import { shapeFor, shapeLeftValue, type PeriodicShape } from './shapes';
import { DEFAULT_MAX_FEATURES, type Feature, type FeatureQuery, type SignalEval } from './types';

const T_EPS_REL = 1e-12;

interface ActiveRange {
  /** Local start/end times; ±Infinity for an infinite window. */
  a: number;
  b: number;
  outside: number; // 0 or NaN
}

function activeRange(w: SignalWindow, frequency: number): ActiveRange {
  switch (w.mode) {
    case 'infinite':
      return { a: -Infinity, b: Infinity, outside: 0 };
    case 'interval':
      return { a: w.start, b: w.end, outside: w.outside === 'zero' ? 0 : NaN };
    case 'cycles':
      return {
        a: w.start,
        b: w.start + w.cycles / frequency,
        outside: w.outside === 'zero' ? 0 : NaN,
      };
  }
}

export function compileGenerator(def: GeneratorDef): SignalEval {
  const extra = compileExtra(def);
  if (extra) return extra;
  const isDc = def.generator === 'dc';
  const f = isDc ? 1 : def.timing.frequency;
  if (!(f > 0) || !Number.isFinite(f)) return invalidSignal();

  const shape: PeriodicShape = shapeFor(def);
  const range = activeRange(def.window, f);
  const infinite = range.a === -Infinity && range.b === Infinity;
  // Infinite periodic signals: whole cycles of delay or phase change nothing, so reduce
  // them to [0, 1) cycle. This keeps cycle coordinates small (huge delays or phases
  // would otherwise exhaust floating-point precision).
  const rawPhase = isDc ? 0 : def.timing.phaseDeg / 360;
  const phaseCycles = infinite ? rawPhase - Math.floor(rawPhase) : rawPhase;
  const delay = infinite && !isDc ? def.timing.delay - Math.floor(def.timing.delay * f) / f : def.timing.delay;

  const cycleCoord = (t: number) => f * (t - delay) + phaseCycles;
  const cyclePos = (t: number) => {
    const x = cycleCoord(t);
    return x - Math.floor(x);
  };
  const inner = (t: number) => shape.value(cyclePos(t));
  const innerLeft = (t: number) => shapeLeftValue(shape, cyclePos(t));

  const value = (t: number): number => {
    const tau = t - delay;
    if (tau < range.a || tau >= range.b) return range.outside;
    return inner(t);
  };

  const left = (t: number): number => {
    const tau = t - delay;
    if (tau <= range.a || tau > range.b) return range.outside;
    return innerLeft(t);
  };

  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const out: Feature[] = [];
    if (!(t1 >= t0)) return { features: out, truncated: false };

    // Global times of the active window.
    const ga = delay + range.a;
    const gb = delay + range.b;
    const tol = T_EPS_REL * Math.max(1, Math.abs(t0), Math.abs(t1), 1 / f);

    // Periodic features strictly inside the active window and inside [t0, t1].
    const lo = Math.max(t0, ga);
    const hi = Math.min(t1, gb);
    let truncated = false;
    if (shape.features.length > 0 && hi >= lo) {
      const kStart = Math.floor(cycleCoord(lo)) - 1;
      const kEnd = Math.ceil(cycleCoord(hi)) + 1;
      // Beyond 2^52 cycles consecutive cycle numbers are no longer representable: the
      // features cannot be resolved (report truncation instead of looping forever).
      if (!(Math.abs(kStart) < 2 ** 52 && Math.abs(kEnd) < 2 ** 52)) truncated = true;
      else outer: for (let k = kStart; k <= kEnd; k++) {
        for (const lf of shape.features) {
          const t = delay + (k + lf.u - phaseCycles) / f;
          if (t < lo - tol || t > hi + tol) continue;
          if (!infinite && (Math.abs(t - ga) <= tol || Math.abs(t - gb) <= tol)) continue;
          if (out.length >= maxCount) {
            truncated = true;
            break outer;
          }
          out.push({ t, kind: lf.kind, left: lf.left, right: lf.right });
        }
      }
    }

    // Window edges.
    if (Number.isFinite(ga) && ga >= t0 - tol && ga <= t1 + tol) {
      out.push(edgeFeature(ga, range.outside, inner(ga)));
    }
    if (Number.isFinite(gb) && gb >= t0 - tol && gb <= t1 + tol) {
      out.push(edgeFeature(gb, innerLeft(gb), range.outside));
    }
    out.sort((p, q) => p.t - q.t);
    return { features: out, truncated };
  };

  return {
    value,
    left,
    features,
    scale: isDc ? undefined : 1 / f,
    period: infinite && !isDc ? 1 / f : undefined,
    piecewiseConstant:
      def.generator === 'square' || isDc || (def.generator === 'pulse' && def.params.rise === 0 && def.params.fall === 0),
    extent: infinite ? undefined : [delay + range.a, delay + range.b],
  };
}

function edgeFeature(t: number, left: number, right: number): Feature {
  const same = left === right || (Number.isNaN(left) && Number.isNaN(right));
  return { t, kind: same ? 'kink' : 'jump', left, right };
}

function invalidSignal(): SignalEval {
  return {
    value: () => NaN,
    features: () => ({ features: [], truncated: false }),
  };
}
