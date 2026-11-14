/**
 * Snapping while dragging a signal horizontally.
 *
 * Anchors = snap points of the dragged signal at its position when the drag
 * started. Targets = snap points of the other visible signals, t = 0 and grid
 * lines. For a raw time displacement Δ, the closest compatible pair
 * (anchor.t + Δ ≈ target.t) within the threshold wins. Phase snapping instead
 * quantizes the displacement to multiples of a phase step of the dragged signal.
 */

import type { SnapGroup, SnapPoint } from './points';

export interface SnapSettings {
  enabled: boolean;
  grid: boolean;
  /** Grid step in seconds; null = automatic (the plot's minor tick spacing). */
  gridStep: number | null;
  edges: boolean;
  zeros: boolean;
  peaks: boolean;
  phase: boolean;
  phaseStepDeg: number;
  period: boolean;
  /** Capture distance in pixels. */
  thresholdPx: number;
}

export const DEFAULT_SNAP: SnapSettings = {
  enabled: true,
  grid: true,
  gridStep: null,
  edges: true,
  zeros: true,
  peaks: false,
  phase: false,
  phaseStepDeg: 15,
  period: false,
  thresholdPx: 8,
};

export interface SnapResult {
  /** Final displacement to apply. */
  delta: number;
  /** What was snapped to (for the guide); null = free movement. */
  target: SnapPoint | null;
  anchor: SnapPoint | null;
  /** Description for phase snapping, e.g. "Phase +30°". */
  label?: string;
}

const UNIVERSAL: SnapGroup[] = ['time-zero', 'grid'];

function compatible(anchor: SnapGroup, target: SnapGroup): boolean {
  return anchor === target || UNIVERSAL.includes(target);
}

/** Targets must be sorted by t. */
export function computeSnap(
  rawDelta: number,
  anchors: SnapPoint[],
  targets: SnapPoint[],
  threshold: number,
  phaseStep?: { seconds: number; degrees: number },
  /** Time under the pointer: among equivalent pairs (periodic copies) prefer the nearest one. */
  focusT?: number,
): SnapResult {
  let best: SnapResult = { delta: rawDelta, target: null, anchor: null };
  let bestD = threshold;

  for (const a of anchors) {
    const want = a.t + rawDelta;
    let i = lowerBound(targets, want - threshold);
    for (; i < targets.length && targets[i]!.t <= want + threshold; i++) {
      const tg = targets[i]!;
      if (!compatible(a.group, tg.group)) continue;
      const d = Math.abs(tg.t - want);
      // Tie-breaks: prefer real features over grid lines, and like-for-like pairs
      // (rising edge → rising edge) over mixed pairs.
      const sameKind = tg.label.split(' · ')[0] === a.label;
      const far = focusT === undefined ? 0 : Math.tanh(Math.abs(tg.t - focusT) / (50 * threshold));
      const dEff =
        d + (tg.group === 'grid' ? threshold * 0.05 : 0) - (sameKind ? threshold * 0.01 : 0) + far * threshold * 0.005;
      if (dEff < bestD) {
        bestD = dEff;
        best = { delta: tg.t - a.t, target: tg, anchor: a };
      }
    }
  }

  if (phaseStep && phaseStep.seconds > 0) {
    const k = Math.round(rawDelta / phaseStep.seconds);
    const q = k * phaseStep.seconds;
    const d = Math.abs(q - rawDelta);
    if (d < bestD) {
      // Dragging right (positive Δ) is a phase lag, i.e. a negative phase.
      const deg = -k * phaseStep.degrees;
      best = { delta: q, target: null, anchor: null, label: `Phase shift ${deg > 0 ? '+' : ''}${Number(deg.toPrecision(6))}°` };
    }
  }
  return best;
}

function lowerBound(arr: SnapPoint[], t: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m]!.t < t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Grid lines covering [t0, t1] with the given step. */
export function gridPoints(t0: number, t1: number, step: number, max = 5000): SnapPoint[] {
  if (!(step > 0)) return [];
  const k0 = Math.ceil(t0 / step - 1e-9);
  const k1 = Math.floor(t1 / step + 1e-9);
  if (k1 - k0 > max) return [];
  const out: SnapPoint[] = [];
  for (let k = k0; k <= k1; k++) out.push({ t: k * step + 0, group: 'grid', label: 'Grid' }); // + 0 avoids −0
  return out;
}
