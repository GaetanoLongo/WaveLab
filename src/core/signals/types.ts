/**
 * Core evaluation interface of the signal engine.
 *
 * A signal is a mathematical function of global time t (seconds). Besides point
 * evaluation it reports its *features*: exact times of discontinuities, slope
 * changes and extrema. The renderer inserts these as exact vertices so edges are
 * never interpolated, and the snapping system uses them as targets.
 *
 * Conventions:
 *  - value(t) is right-continuous: at a jump, value(t) returns the right limit.
 *  - NaN means "undefined" (drawn as a gap, propagates through operations).
 *  - CONTRACT: between two consecutive features the signal is continuous and
 *    monotonic. This lets the renderer compute exact min/max over any interval
 *    from the interval end values and the feature limits alone.
 */

export type FeatureKind =
  /** Discontinuity (left !== right). Rising if right > left. */
  | 'jump'
  /** Continuous point where the slope changes abruptly (e.g. pulse corner). */
  | 'kink'
  /** Local maximum (may also be a kink, e.g. triangle apex). */
  | 'max'
  /** Local minimum. */
  | 'min';

export interface Feature {
  t: number;
  kind: FeatureKind;
  /** Left limit lim_{s→t⁻} f(s). */
  left: number;
  /** Right limit lim_{s→t⁺} f(s) (= value(t)). */
  right: number;
}

export interface FeatureQuery {
  features: Feature[];
  /** True if more than `maxCount` features exist in the interval (list was cut). */
  truncated: boolean;
}

/** Ideal Dirac impulse weight·δ(t − t₀) (e.g. the derivative of an ideal edge). */
export interface Impulse {
  t: number;
  weight: number;
}

export interface SignalEval {
  value(t: number): number;
  /** All features with t0 <= t <= t1, sorted by time. */
  features(t0: number, t1: number, maxCount?: number): FeatureQuery;
  /** Fundamental period in seconds if the signal is periodic over all time. */
  readonly period?: number;
  /** Global time interval outside which the signal is constant (0) or undefined. */
  readonly extent?: readonly [number, number];
  /** Exact left limit lim_{s→t⁻} f(s) (if omitted, callers approximate it). */
  left?(t: number): number;
  /** Characteristic time scale (shortest period involved) used to choose sampling steps. */
  readonly scale?: number;
  /** Ideal impulses in [t0, t1] that are part of the signal but not of value(t). */
  impulses?(t0: number, t1: number): Impulse[];
  /** Notes about approximations (e.g. impulses dropped by a non-linear operation). */
  readonly warnings?: string[];
  /** Constant between its features (only jumps): logic signals, square waves, step tables. */
  readonly piecewiseConstant?: boolean;
}

export const DEFAULT_MAX_FEATURES = 100_000;

export function isRisingEdge(f: Feature): boolean {
  return f.kind === 'jump' && f.right > f.left;
}

export function isFallingEdge(f: Feature): boolean {
  return f.kind === 'jump' && f.right < f.left;
}
