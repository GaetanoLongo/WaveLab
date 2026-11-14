/**
 * Phase relationships between generator signals.
 *
 * "Fundamental phase" = phase (degrees) of the signal's fundamental component,
 * expressed as a sine, i.e. the fundamental is ∝ sin(2πf·t + θ). This is what
 * engineers mean by the phase difference between, say, a sine and a square wave
 * of the same frequency. It accounts for each shape's cycle-start convention,
 * the phase parameter and the delay.
 */

import type { GeneratorDef } from '../model/signal-defs';

/** Phase of the fundamental relative to the cycle start (degrees), per shape. */
export function intrinsicPhaseDeg(def: GeneratorDef): number | null {
  switch (def.generator) {
    case 'sine':
      return 0;
    case 'cosine':
      return 90; // cos = sin(· + 90°)
    case 'triangle':
      return -90; // minimum at cycle start → −cos
    case 'sawtooth':
      // Rising ramp from −A: fundamental −sin → 180°. Falling: +sin → 0°.
      return def.params.slope === 'rising' ? 180 : 0;
    case 'square': {
      // High for D·T from the cycle start: fundamental peaks at the middle of the high part.
      return 90 - 180 * def.params.duty;
    }
    case 'pulse': {
      const T = 1 / def.timing.frequency;
      const { rise, width, fall } = def.params;
      const center = Math.min(T, rise + width + fall) / 2; // symmetric approximation for rise ≠ fall
      return 90 - (360 * center) / T;
    }
    default:
      // DC and non-periodic generators have no fundamental phase.
      return null;
  }
}

/** Fundamental phase θ (degrees, wrapped to (−180, 180]) at the global time origin. */
export function fundamentalPhaseDeg(def: GeneratorDef): number | null {
  const intr = intrinsicPhaseDeg(def);
  if (intr === null) return null;
  const { phaseDeg, delay, frequency } = def.timing;
  return wrapDeg(intr + phaseDeg - 360 * frequency * delay);
}

/** Phase by which `a` leads `b` (degrees, (−180, 180]); null if not comparable. */
export function phaseDifferenceDeg(a: GeneratorDef, b: GeneratorDef): number | null {
  if (!sameFrequency(a, b)) return null;
  const pa = fundamentalPhaseDeg(a);
  const pb = fundamentalPhaseDeg(b);
  return pa === null || pb === null ? null : wrapDeg(pa - pb);
}

/** New phase parameter for `a` so that it leads `b` by `targetDeg`. */
export function phaseForDifference(a: GeneratorDef, b: GeneratorDef, targetDeg: number): number | null {
  const current = phaseDifferenceDeg(a, b);
  if (current === null) return null;
  return a.timing.phaseDeg + wrapDeg(targetDeg - current);
}

export function sameFrequency(a: GeneratorDef, b: GeneratorDef): boolean {
  if (a.generator === 'dc' || b.generator === 'dc') return false;
  const fa = a.timing.frequency;
  const fb = b.timing.frequency;
  return Math.abs(fa - fb) <= 1e-9 * Math.max(fa, fb);
}

export function wrapDeg(d: number): number {
  let w = d % 360;
  if (w <= -180) w += 360;
  if (w > 180) w -= 360;
  // Remove floating noise like 1e-13.
  return Math.abs(w) < 1e-9 ? 0 : Math.abs(Math.abs(w) - 180) < 1e-9 ? 180 : w;
}
