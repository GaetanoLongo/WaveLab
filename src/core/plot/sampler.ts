/**
 * Converts a signal into drawable polylines (data coordinates) for a given
 * time interval and horizontal pixel resolution.
 *
 *  - EXACT mode (features sparse relative to pixels): breakpoints are inserted
 *    exactly; jumps become vertical segments (both limits at the same t); smooth
 *    parts are sampled at ~1 point per pixel. Nothing is ever interpolated across
 *    a discontinuity.
 *  - ENVELOPE mode (more than ~1 feature per 2 pixels): each pixel column is drawn
 *    as a vertical stroke from its exact min to its exact max, so very high
 *    frequency signals render as a correct band instead of aliasing.
 *
 * Undefined (NaN) regions split the output into separate polylines (gaps).
 */

import type { SignalEval } from '../signals/types';
import { rangeOf } from './range';

export interface Polyline {
  t: number[];
  y: number[];
}

export interface SampledTrace {
  mode: 'exact' | 'envelope';
  lines: Polyline[];
}

class LineBuilder {
  lines: Polyline[] = [];
  private cur: Polyline | null = null;

  push(t: number, y: number): void {
    if (Number.isNaN(y)) {
      this.break();
      return;
    }
    if (!this.cur) this.cur = { t: [], y: [] };
    const n = this.cur.t.length;
    if (n > 0 && this.cur.t[n - 1] === t && this.cur.y[n - 1] === y) return;
    this.cur.t.push(t);
    this.cur.y.push(y);
  }

  break(): void {
    if (this.cur && this.cur.t.length > 0) this.lines.push(this.cur);
    this.cur = null;
  }

  finish(): Polyline[] {
    this.break();
    return this.lines;
  }
}

export function sampleSignal(s: SignalEval, t0: number, t1: number, columns: number): SampledTrace {
  const cols = Math.max(1, Math.floor(columns));
  if (!(t1 > t0)) return { mode: 'exact', lines: [] };

  const { features, truncated } = s.features(t0, t1, Math.max(4, Math.floor(cols / 2)));
  if (truncated) return sampleEnvelope(s, t0, t1, cols);

  const dt = (t1 - t0) / cols;
  const out = new LineBuilder();

  const emitSegment = (a: number, va: number, b: number, vb: number) => {
    out.push(a, va);
    const k = Math.min(Math.ceil((b - a) / dt), 100_000);
    for (let i = 1; i < k; i++) {
      const t = a + ((b - a) * i) / k;
      out.push(t, s.value(t));
    }
    out.push(b, vb);
  };

  let a = t0;
  let va = s.value(t0);
  for (const f of features) {
    if (f.t <= t0) {
      va = f.right;
      continue;
    }
    if (f.t >= t1) {
      emitSegment(a, va, t1, f.left);
      return { mode: 'exact', lines: out.finish() };
    }
    emitSegment(a, va, f.t, f.left);
    a = f.t;
    va = f.right;
  }
  emitSegment(a, va, t1, s.value(t1));
  return { mode: 'exact', lines: out.finish() };
}

/** Features of the whole window in one query (null if there are too many). */
const ENVELOPE_MAX_FEATURES = 200_000;

function sampleEnvelope(s: SignalEval, t0: number, t1: number, cols: number): SampledTrace {
  const dt = (t1 - t0) / cols;
  const out = new LineBuilder();
  // One query for the whole window, then per-column min/max from the feature limits and
  // the column edges (monotonic between features). Much cheaper than one query per column
  // for expression signals, whose queries recurse through all their inputs.
  const all = s.features(t0, t1, ENVELOPE_MAX_FEATURES);
  const feats = all.truncated ? null : all.features;
  let fi = 0;
  for (let i = 0; i < cols; i++) {
    const c0 = t0 + i * dt;
    let r: readonly [number, number] | null;
    if (feats) {
      let mn = Infinity;
      let mx = -Infinity;
      const add = (v: number) => {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      };
      const c1 = c0 + dt;
      add(s.value(c0));
      while (fi < feats.length && feats[fi]!.t < c0) fi++;
      let last: number | null = null;
      for (let k = fi; k < feats.length && feats[k]!.t <= c1; k++) {
        add(feats[k]!.left);
        add(feats[k]!.right);
        last = feats[k]!.t;
      }
      add(last === c1 ? feats.find((f) => f.t === c1)!.left : s.left ? s.left(c1) : s.value(c1));
      r = mn <= mx ? [mn, mx] : null;
    } else {
      r = rangeOf(s, c0, c0 + dt);
    }
    if (!r) {
      out.break();
      continue;
    }
    const tc = c0 + dt / 2;
    // Alternate the stroke direction so consecutive columns connect cleanly.
    if (i % 2 === 0) {
      out.push(tc, r[0]);
      out.push(tc, r[1]);
    } else {
      out.push(tc, r[1]);
      out.push(tc, r[0]);
    }
  }
  return { mode: 'envelope', lines: out.finish() };
}
