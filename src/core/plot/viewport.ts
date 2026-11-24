/** Pure helpers for the shared time axis and vertical ranges (zoom, pan, fit). */

import type { SignalEval } from '../signals/types';
import { budgeted, isHeavySignal } from '../signals/budget';
import { rangeOfBounded, unionRanges, type Range } from './range';

export const MIN_SPAN = 1e-12;
export const MAX_SPAN = 1e9;

/** Zoom by `factor` (<1 zooms in) keeping `anchor` fixed on screen. */
export function zoomRange(r: Range, factor: number, anchor = (r[0] + r[1]) / 2): Range {
  const span = r[1] - r[0];
  const newSpan = Math.min(MAX_SPAN, Math.max(MIN_SPAN * Math.max(1, Math.abs(anchor)), span * factor));
  const f = newSpan / span;
  return [anchor - (anchor - r[0]) * f, anchor + (r[1] - anchor) * f];
}

export function panRange(r: Range, delta: number): Range {
  return [r[0] + delta, r[1] + delta];
}

/**
 * Time range showing all signals: from min(0, earliest start) to the later of the
 * latest window end and two periods of the slowest periodic signal.
 */
export function fitTimeRange(signals: SignalEval[]): Range {
  let start = 0;
  let end = 0;
  for (const s of signals) {
    if (s.extent) {
      start = Math.min(start, s.extent[0]);
      end = Math.max(end, s.extent[1]);
    }
    if (s.period !== undefined) end = Math.max(end, start + 2 * s.period);
  }
  if (!(end > start)) end = start + 1;
  return [start, end];
}

/**
 * Automatic vertical range: the union of each signal's FULL range (one period for
 * periodic signals, the whole window plus the outside value for windowed ones),
 * with 8 % padding. It deliberately does not depend on the visible time window,
 * so zooming in time never rescales the vertical axis.
 */
export function autoYRange(signals: SignalEval[]): Range {
  const r = unionRanges(signals.map(fullRange));
  if (!r) return [-1, 1];
  let [mn, mx] = r;
  if (mx - mn < 1e-12 * Math.max(1, Math.abs(mx))) {
    const m = Math.abs(mx) > 0 ? Math.abs(mx) * 0.1 : 1;
    mn -= m;
    mx += m;
  } else {
    const pad = (mx - mn) * 0.08;
    mn -= pad;
    mx += pad;
  }
  return [mn, mx];
}

/**
 * Full range of one signal (what `autoYRange` unites). It depends on the signal alone, and signals are
 * immutable (an edit compiles a new object), so it is computed once per signal instead of on every
 * redraw of every panel with an automatic range. An abandoned (over-budget) answer is not kept.
 */
const fullRangeCache = new WeakMap<SignalEval, Range | null>();
function fullRange(s: SignalEval): Range | null {
  const hit = fullRangeCache.get(s);
  if (hit !== undefined) return hit;
  return budgeted(
    s,
    3000,
    () => {
      const [a, b] = fitTimeRange([s]);
      const m = (b - a) * 0.01;
      const r = rangeOfBounded(s, a - m, b + m);
      if (!isHeavySignal(s)) fullRangeCache.set(s, r);
      return r;
    },
    () => null,
  );
}
