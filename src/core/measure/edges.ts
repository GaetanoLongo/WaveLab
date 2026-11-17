/**
 * Oscilloscope-style pulse and step measurements: rise / fall time (10 %–90 %), pulse widths (at
 * 50 %), overshoot / undershoot and settling time (±2 %).
 *
 * The signal is read from the same exact polyline the plot draws (ideal edges are vertical, so their
 * rise time is exactly 0). Levels come from a time-weighted histogram, the way a scope finds "top"
 * and "base": the most-occupied level in the upper and in the lower half of the range, so overshoot
 * and ringing do not move them. Signals without two clear levels (a sine) use minimum and maximum.
 */

import { sampleSignal } from '../plot/sampler';
import type { SignalEval } from '../signals/types';

export interface EdgeMetrics {
  /** True if two dominant levels were found (a pulse / step signal). */
  twoLevel: boolean;
  base: number;
  top: number;
  amplitude: number;
  /** Mean 10 %→90 % rise time and the number of edges measured. */
  rise?: { value: number; count: number };
  fall?: { value: number; count: number };
  /** Mean widths at 50 %: high (positive) and low (negative) pulses. */
  posWidth?: { value: number; count: number };
  negWidth?: { value: number; count: number };
  /** Percent of the amplitude above top / below base. */
  overshoot?: number;
  undershoot?: number;
  /** Time from the first rising 10 % crossing until the signal stays within ±2 % of top. */
  settling?: number;
  /** Why some values are missing (e.g. too dense a window to read edges). */
  note?: string;
}

const BINS = 64;

export function edgeMetrics(s: SignalEval, a: number, b: number): EdgeMetrics | null {
  if (!(b > a)) return null;
  const sampled = sampleSignal(s, a, b, 6000);
  if (sampled.mode === 'envelope') return { twoLevel: false, base: NaN, top: NaN, amplitude: NaN, note: 'too many edges in the window: zoom in to measure edges' };
  // Samples of all connected lines, in order; lines are broken at undefined values.
  const lines = sampled.lines.filter((l) => l.t.length >= 2);
  if (lines.length === 0) return null;
  let mn = Infinity;
  let mx = -Infinity;
  for (const l of lines) for (const v of l.y) if (Number.isFinite(v)) (mn = Math.min(mn, v)), (mx = Math.max(mx, v));
  if (!(mx - mn > 1e-12 * Math.max(1, Math.abs(mx), Math.abs(mn)))) return { twoLevel: false, base: mn, top: mx, amplitude: 0, note: 'the signal is constant in this window' };

  // Time-weighted histogram of the value (each polyline segment contributes its duration).
  const occ = new Array<number>(BINS).fill(0);
  const sum = new Array<number>(BINS).fill(0);
  let total = 0;
  const binOf = (v: number) => Math.min(BINS - 1, Math.max(0, Math.floor(((v - mn) / (mx - mn)) * BINS)));
  for (const l of lines) {
    for (let i = 0; i + 1 < l.t.length; i++) {
      const dt = l.t[i + 1]! - l.t[i]!;
      if (!(dt > 0)) continue;
      const v = (l.y[i]! + l.y[i + 1]!) / 2;
      const k = binOf(v);
      occ[k]! += dt;
      sum[k]! += dt * v;
      total += dt;
    }
  }
  const best = (from: number, to: number) => {
    let k = -1;
    for (let i = from; i < to; i++) if (k < 0 || occ[i]! > occ[k]!) k = i;
    return k;
  };
  const kLow = best(0, BINS / 2);
  const kHigh = best(BINS / 2, BINS);
  const twoLevel = total > 0 && occ[kLow]! > 0.08 * total && occ[kHigh]! > 0.08 * total;
  // The level is found in two passes: the dominant coarse bin, then a finer histogram of just the
  // samples around it (its neighbours included), whose dominant bin gives the plateau value to
  // ~1/4000 of the range even when the level is approached exponentially or the edges ring.
  const refine = (k: number): number => {
    const lo = mn + ((k - 1) / BINS) * (mx - mn);
    const hi = mn + ((k + 2) / BINS) * (mx - mn);
    const w = new Array<number>(BINS).fill(0);
    const m = new Array<number>(BINS).fill(0);
    for (const l of lines)
      for (let i = 0; i + 1 < l.t.length; i++) {
        const dt = l.t[i + 1]! - l.t[i]!;
        const v = (l.y[i]! + l.y[i + 1]!) / 2;
        if (!(dt > 0) || v < lo || v >= hi) continue;
        const f = Math.min(BINS - 1, Math.floor(((v - lo) / (hi - lo)) * BINS));
        w[f]! += dt;
        m[f]! += dt * v;
      }
    let best = 0;
    for (let i = 1; i < BINS; i++) if (w[i]! > w[best]!) best = i;
    return w[best]! > 0 ? m[best]! / w[best]! : (lo + hi) / 2;
  };
  const base = twoLevel ? refine(kLow) : mn;
  const top = twoLevel ? refine(kHigh) : mx;
  const amp = top - base;
  const out: EdgeMetrics = { twoLevel, base, top, amplitude: amp };
  if (!(amp > 0)) return out;

  const lo = base + 0.1 * amp;
  const mid = base + 0.5 * amp;
  const hi = base + 0.9 * amp;

  // Threshold crossings along the polylines (linear interpolation inside a segment).
  type Ev = { t: number; kind: 'up10' | 'up50' | 'up90' | 'dn90' | 'dn50' | 'dn10' };
  const events: Ev[] = [];
  const cross = (t0: number, y0: number, t1: number, y1: number, level: number): number => (y1 === y0 ? t0 : t0 + ((level - y0) / (y1 - y0)) * (t1 - t0));
  for (const l of lines) {
    for (let i = 0; i + 1 < l.t.length; i++) {
      const y0 = l.y[i]!;
      const y1 = l.y[i + 1]!;
      if (!Number.isFinite(y0) || !Number.isFinite(y1) || y0 === y1) continue;
      const t0 = l.t[i]!;
      const t1 = l.t[i + 1]!;
      const seg: Ev[] = [];
      if (y1 > y0) {
        for (const [lev, kind] of [[lo, 'up10'], [mid, 'up50'], [hi, 'up90']] as const) if (y0 < lev && y1 >= lev) seg.push({ t: cross(t0, y0, t1, y1, lev), kind });
      } else {
        for (const [lev, kind] of [[hi, 'dn90'], [mid, 'dn50'], [lo, 'dn10']] as const) if (y0 > lev && y1 <= lev) seg.push({ t: cross(t0, y0, t1, y1, lev), kind });
      }
      events.push(...seg);
    }
  }
  events.sort((x, y) => x.t - y.t);

  // Rise: an 10 % crossing followed by the 90 % crossing before the signal falls back below 10 %.
  const mean = (xs: number[]) => (xs.length ? { value: xs.reduce((p, c) => p + c, 0) / xs.length, count: xs.length } : undefined);
  const rises: number[] = [];
  const falls: number[] = [];
  let up10: number | null = null;
  let dn90: number | null = null;
  for (const e of events) {
    if (e.kind === 'up10') up10 = e.t;
    else if (e.kind === 'dn10') up10 = null;
    else if (e.kind === 'up90' && up10 !== null) (rises.push(e.t - up10), (up10 = null));
    if (e.kind === 'dn90') dn90 = e.t;
    else if (e.kind === 'up90') dn90 = null;
    else if (e.kind === 'dn10' && dn90 !== null) (falls.push(e.t - dn90), (dn90 = null));
  }
  out.rise = mean(rises);
  out.fall = mean(falls);

  // Widths at 50 %: up50 → next dn50 (positive), dn50 → next up50 (negative), both inside the window.
  const pos: number[] = [];
  const neg: number[] = [];
  const mids = events.filter((e) => e.kind === 'up50' || e.kind === 'dn50');
  for (let i = 0; i + 1 < mids.length; i++) {
    const e = mids[i]!;
    const n = mids[i + 1]!;
    if (e.kind === 'up50' && n.kind === 'dn50') pos.push(n.t - e.t);
    else if (e.kind === 'dn50' && n.kind === 'up50') neg.push(n.t - e.t);
  }
  out.posWidth = mean(pos);
  out.negWidth = mean(neg);

  // Overshoot / undershoot beyond top / base (only when significant).
  if (twoLevel) {
    if (mx > top + 0.005 * amp) out.overshoot = ((mx - top) / amp) * 100;
    if (mn < base - 0.005 * amp) out.undershoot = ((base - mn) / amp) * 100;

    // Settling after the first rising edge: the last time the signal ENTERS the ±2 % band of top
    // before the plateau ends (the next fall through 50 %: ringing stays above it). Not settled if it never enters.
    const first = events.find((e) => e.kind === 'up10');
    if (first) {
      const next = events.find((e) => e.kind === 'dn50' && e.t > first.t);
      const end = next ? next.t : b;
      const band = 0.02 * amp;
      let inside = false; // the plateau ends where the fall begins, so only the last entry matters
      let entry: number | null = null;
      for (const l of lines) {
        for (let i = 0; i < l.t.length; i++) {
          const t = l.t[i]!;
          if (t <= first.t || t > end) continue;
          const now = Math.abs(l.y[i]! - top) <= band;
          if (now && !inside) entry = t;
          inside = now;
        }
      }
      if (entry !== null) out.settling = Math.max(0, entry - first.t);
    }
  }
  return out;
}
