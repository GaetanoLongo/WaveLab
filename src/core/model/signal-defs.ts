/**
 * Serializable signal definitions (the document model). These are pure data —
 * they are what gets saved in a .wlab file. `compileSignal` turns them into
 * evaluable SignalEval objects.
 *
 * Conventions (documented in docs/CONVENTIONS.md):
 *  - Amplitude = zero-to-peak. Offset = DC level.
 *  - Square/pulse are defined by high/low levels.
 *  - Phase φ (degrees): +φ LEADS, i.e. f(t) = g(ω·(t − delay) + φ).
 *  - Delay (seconds): position on the global timeline, positive = shift right.
 *  - Each periodic cycle starts at local phase 0: square goes high, pulse starts
 *    rising, triangle and rising sawtooth are at their minimum, sine crosses zero
 *    upward, cosine is at its maximum.
 */

export type GeneratorKind =
  | 'sine'
  | 'cosine'
  | 'square'
  | 'pulse'
  | 'triangle'
  | 'sawtooth'
  | 'dc'
  | 'exponential'
  | 'damped'
  | 'piecewise'
  | 'bits';

/** Generators that repeat with timing.frequency (the others are one-shot or define their own repetition). */
export const PERIODIC_KINDS: GeneratorKind[] = ['sine', 'cosine', 'square', 'pulse', 'triangle', 'sawtooth'];
export const isPeriodicKind = (k: GeneratorKind) => PERIODIC_KINDS.includes(k);

export interface Timing {
  /** Hz. Ignored for DC. */
  frequency: number;
  /** Degrees, +φ leads. Ignored for DC. */
  phaseDeg: number;
  /** Seconds, positive shifts right on the global timeline. */
  delay: number;
}

export type OutsideValue = 'zero' | 'undefined';

/**
 * Optional time window. Times are LOCAL (relative to `delay`) so the window moves
 * with the signal when it is repositioned.
 */
export type SignalWindow =
  | { mode: 'infinite' }
  | { mode: 'interval'; start: number; end: number; outside: OutsideValue }
  | { mode: 'cycles'; start: number; cycles: number; outside: OutsideValue };

export interface SineParams {
  amplitude: number;
  offset: number;
}

export interface SquareParams {
  high: number;
  low: number;
  /** Fraction 0..1 of the period spent high. */
  duty: number;
}

/**
 * Trapezoidal pulse, SPICE PULSE convention: within each period the signal rises
 * from `low` to `high` in `rise` seconds, stays high for `width` seconds (flat top,
 * excluding rise/fall), falls in `fall` seconds and stays low for the rest.
 */
export interface PulseParams {
  high: number;
  low: number;
  width: number;
  rise: number;
  fall: number;
}

export interface TriangleParams {
  amplitude: number;
  offset: number;
}

export interface SawtoothParams {
  amplitude: number;
  offset: number;
  slope: 'rising' | 'falling';
}

export interface DcParams {
  level: number;
}

/**
 * First-order step response starting at the signal's start time (timing.delay):
 * y = final + (initial − final)·e^(−(t − start)/τ) for t ≥ start, `initial` before.
 */
export interface ExponentialParams {
  initial: number;
  final: number;
  /** Time constant τ in seconds (> 0). */
  tau: number;
}

/**
 * Damped sinusoid from the start time (timing.delay):
 * y = offset + A·e^(−τ'/τ)·sin(2πf·τ' + φ), τ' = t − start, for t ≥ start; `offset` before.
 */
export interface DampedParams {
  amplitude: number;
  offset: number;
  /** Decay time constant τ in seconds (> 0). */
  tau: number;
}

/** Arbitrary waveform through points (t relative to the start time, sorted; equal t = vertical step). */
export interface PiecewiseParams {
  points: Array<[number, number]>;
  interp: 'linear' | 'step';
  /** Repeat with period = last t − first t; otherwise hold the end values outside. */
  repeat: boolean;
}

export type BitEncoding = 'nrz' | 'rz' | 'manchester';

/**
 * Digital bit sequence from the start time.
 *  NRZ: level for the whole bit. RZ: '1' is high for the first half of the bit, '0' stays low.
 *  Manchester (IEEE 802.3): '0' = high→low at mid-bit, '1' = low→high at mid-bit.
 */
export interface BitsParams {
  bits: string;
  bitTime: number;
  high: number;
  low: number;
  encoding: BitEncoding;
  repeat: boolean;
}

interface GeneratorBase {
  timing: Timing;
  window: SignalWindow;
}

export type GeneratorDef = GeneratorBase &
  (
    | { generator: 'sine'; params: SineParams }
    | { generator: 'cosine'; params: SineParams }
    | { generator: 'square'; params: SquareParams }
    | { generator: 'pulse'; params: PulseParams }
    | { generator: 'triangle'; params: TriangleParams }
    | { generator: 'sawtooth'; params: SawtoothParams }
    | { generator: 'dc'; params: DcParams }
    | { generator: 'exponential'; params: ExponentialParams }
    | { generator: 'damped'; params: DampedParams }
    | { generator: 'piecewise'; params: PiecewiseParams }
    | { generator: 'bits'; params: BitsParams }
  );

export const INFINITE: SignalWindow = { mode: 'infinite' };

export function defaultTiming(frequency = 50): Timing {
  return { frequency, phaseDeg: 0, delay: 0 };
}

/** Time displacement equivalent to a phase angle at a given frequency (+φ → signal earlier). */
export function phaseToTime(phaseDeg: number, frequency: number): number {
  return phaseDeg / 360 / frequency;
}

export function timeToPhase(seconds: number, frequency: number): number {
  return seconds * frequency * 360;
}
