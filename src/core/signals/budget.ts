/**
 * Compute budget.
 *
 * The signal engine is synchronous: a pathological signal (a window of 10⁶ s through a chain of
 * moving averages, a 100 kHz converter with dead time and a load…) would freeze the page for a
 * minute. Hot loops call `checkBudget()`; once the outermost evaluation of a signal has run longer
 * than the limit it throws `BudgetExceeded`, which the outermost guard (see `guardSignal`) catches
 * and turns into an undefined / "too many features" answer, so the page stays responsive and says so.
 *
 * Inner signals do not catch it: the signal the caller asked about is the one reported as too heavy.
 */

import type { FeatureQuery, SignalEval } from './types';

export class BudgetExceeded extends Error {
  constructor() {
    super('compute budget exceeded');
  }
}

let limitMs = 3000;
let depth = 0;
let deadline = Infinity;
let counter = 0;
const listeners = new Set<() => void>();

/** Change the budget (ms) used by evaluations that start afterwards; returns the previous value. */
export function setComputeBudget(ms: number): number {
  const prev = limitMs;
  limitMs = ms;
  return prev;
}

/** Run `fn` with a different budget (exports and explicit "compute anyway" actions get more). */
export function withComputeBudget<T>(ms: number, fn: () => T): T {
  const prev = setComputeBudget(ms);
  try {
    return fn();
  } finally {
    setComputeBudget(prev);
  }
}

/** Called when a top-level evaluation is abandoned (for a status message). */
export function onBudgetExceeded(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Cheap enough for inner loops: the clock is read once every 128 calls. */
export function checkBudget(): void {
  if ((++counter & 127) !== 0) return;
  if (performance.now() > deadline) throw new BudgetExceeded();
}

const HEAVY_FOR_MS = 15000;
/** Signals (guarded objects) abandoned recently, and until when they answer "undefined" at once. */
const heavy = new WeakMap<object, number>();
const isHeavy = (ev: object) => (heavy.get(ev) ?? 0) > performance.now();
const markHeavy = (ev: object) => {
  heavy.set(ev, performance.now() + HEAVY_FOR_MS);
  for (const l of listeners) l();
};

/**
 * Run `fn` (drawing one trace, measuring one signal…) within `ms`, however many cheap calls it makes.
 * On overrun the signal is marked heavy and `fallback()` is returned; a signal already marked heavy
 * is not tried again for a while.
 */
export function budgeted<T>(ev: SignalEval, ms: number, fn: () => T, fallback: () => T): T {
  if (isHeavy(ev)) return fallback();
  if (depth > 0) return fn(); // already inside a budgeted evaluation: share its deadline
  deadline = performance.now() + ms;
  depth++;
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof BudgetExceeded)) throw e;
    markHeavy(ev);
    return fallback();
  } finally {
    depth--;
    deadline = Infinity;
  }
}

/**
 * Wrap a compiled signal: the outermost call sets the deadline; if it is exceeded the signal is
 * remembered as heavy for a while and answers "undefined" instantly instead of retrying (each retry
 * would burn the whole budget again). Editing the project recompiles the signal and clears this.
 */
export function guardSignal(ev: SignalEval): SignalEval {
  const run = <T,>(fn: () => T, fallback: () => T): T => {
    if (depth === 0 && isHeavy(out)) return fallback();
    const outer = depth === 0;
    if (outer) deadline = performance.now() + limitMs;
    depth++;
    try {
      return fn();
    } catch (e) {
      if (!(e instanceof BudgetExceeded)) throw e;
      if (!outer) throw e; // the outermost signal reports it
      markHeavy(out);
      return fallback();
    } finally {
      depth--;
      if (outer) deadline = Infinity;
    }
  };
  const left = ev.left;
  const out: SignalEval = {
    ...ev,
    value: (t) => run(() => ev.value(t), () => NaN),
    features: (a, b, m): FeatureQuery => run(() => ev.features(a, b, m), () => ({ features: [], truncated: true })),
    ...(left ? { left: (t: number) => run(() => left(t), () => NaN) } : {}),
  };
  return out;
}
