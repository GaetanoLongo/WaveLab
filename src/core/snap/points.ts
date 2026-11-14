/**
 * Snap points of a signal: edges, zero crossings, peaks and cycle starts.
 * Computed from the exact feature list (no sampling), so they are exact.
 */

import type { SignalEval } from '../signals/types';

export type SnapGroup = 'edge' | 'zero' | 'peak' | 'cycle' | 'grid' | 'time-zero';

export interface SnapPoint {
  t: number;
  group: SnapGroup;
  /** Human-readable label for the visual guide, e.g. "Rising edge". */
  label: string;
  signalId?: string;
}

export interface PointOptions {
  edges: boolean;
  zeros: boolean;
  peaks: boolean;
  cycles: boolean;
  /** Times where local phase 0 occurs (cycle starts) are provided by the caller. */
  cycleStarts?: (t0: number, t1: number) => number[];
  max?: number;
}

const MAX_POINTS = 4000;

export function snapPoints(s: SignalEval, t0: number, t1: number, o: PointOptions, signalId?: string): SnapPoint[] {
  const max = o.max ?? MAX_POINTS;
  const out: SnapPoint[] = [];
  const { features, truncated } = s.features(t0, t1, max);
  if (truncated) return out; // too dense to be meaningful at this zoom

  if (o.edges || o.peaks) {
    for (const f of features) {
      if (o.edges && f.kind === 'jump') {
        if (Number.isNaN(f.left) || Number.isNaN(f.right)) continue;
        out.push({ t: f.t, group: 'edge', label: f.right > f.left ? 'Rising edge' : 'Falling edge', signalId });
      } else if (o.edges && f.kind === 'kink') {
        out.push({ t: f.t, group: 'edge', label: 'Corner', signalId });
      } else if (o.peaks && (f.kind === 'max' || f.kind === 'min')) {
        out.push({ t: f.t, group: 'peak', label: f.kind === 'max' ? 'Positive peak' : 'Negative peak', signalId });
      }
    }
  }
  if (o.zeros) {
    for (const z of zeroCrossings(s, t0, t1, max)) {
      out.push({ t: z.t, group: 'zero', label: z.rising ? 'Zero crossing ↑' : 'Zero crossing ↓', signalId });
    }
  }
  if (o.cycles && o.cycleStarts) {
    for (const t of o.cycleStarts(t0, t1).slice(0, max)) out.push({ t, group: 'cycle', label: 'Cycle start', signalId });
  }
  return out;
}

/**
 * Exact zero crossings using the monotonic-between-features contract: each
 * segment between features crosses zero at most once (found by bisection);
 * a jump that changes sign is itself a crossing.
 */
export function zeroCrossings(s: SignalEval, t0: number, t1: number, max = MAX_POINTS): Array<{ t: number; rising: boolean }> {
  const out: Array<{ t: number; rising: boolean }> = [];
  const { features, truncated } = s.features(t0, t1, max);
  if (truncated) return out;

  let a = t0;
  let va = s.value(t0);
  const segment = (b: number, vb: number) => {
    if (Number.isNaN(va) || Number.isNaN(vb)) return;
    if ((va < 0 && vb > 0) || (va > 0 && vb < 0)) {
      let lo = a;
      let hi = b;
      const rising = vb > va;
      for (let i = 0; i < 80 && hi - lo > 1e-15 * Math.max(1, Math.abs(hi)); i++) {
        const m = (lo + hi) / 2;
        const vm = s.value(m);
        if (vm === 0) {
          lo = hi = m;
          break;
        }
        if (vm < 0 === rising) lo = m;
        else hi = m;
      }
      out.push({ t: (lo + hi) / 2, rising });
    }
  };
  for (const f of features) {
    if (f.t <= t0) {
      va = f.right;
      continue;
    }
    segment(f.t, f.left);
    if (f.kind === 'jump' && ((f.left < 0 && f.right > 0) || (f.left > 0 && f.right < 0))) {
      out.push({ t: f.t, rising: f.right > f.left });
    }
    a = f.t;
    va = f.right;
    if (out.length >= max) return out;
  }
  if (a < t1) segment(t1, s.value(t1));
  return out;
}

/** Times where the generator's local phase is 0 (cycle starts) within [t0, t1]. */
export function cycleStarts(
  timing: { frequency: number; phaseDeg: number; delay: number },
  t0: number,
  t1: number,
  max = MAX_POINTS,
): number[] {
  const f = timing.frequency;
  if (!(f > 0)) return [];
  const base = timing.delay - timing.phaseDeg / 360 / f;
  const k0 = Math.ceil((t0 - base) * f - 1e-9);
  const k1 = Math.floor((t1 - base) * f + 1e-9);
  if (k1 - k0 > max) return [];
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(base + k / f + 0);
  return out;
}
