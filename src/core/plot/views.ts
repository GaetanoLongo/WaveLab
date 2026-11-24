/**
 * Alternative views rendered into a Scene (same SVG/PNG export path as figures):
 *  - XY (Lissajous): the parametric curve (x(t), y(t)) over a time interval, with
 *    exact corners (both signals' feature times are included, jumps as two points).
 *  - Eye diagram: a signal folded over a unit interval UI (2 UI wide), every trace
 *    sampled exactly; eye height measured at the centre of the eye.
 */

import { budgeted } from '../signals/budget';
import type { SignalEval } from '../signals/types';
import { formatSI } from '../units/si';
import type { PlotTheme } from './layout';
import { rangeOf } from './range';
import { sampleSignal } from './sampler';
import type { Scene, SceneItem } from './scene';
import { niceTicks } from './ticks';

interface Frame {
  x: number;
  y: number;
  w: number;
  h: number;
  xr: [number, number];
  yr: [number, number];
}

const px = (f: Frame, v: number) => f.x + ((v - f.xr[0]) / (f.xr[1] - f.xr[0])) * f.w;
const py = (f: Frame, v: number) => f.y + f.h - ((v - f.yr[0]) / (f.yr[1] - f.yr[0])) * f.h;

function pad(r: [number, number]): [number, number] {
  const span = r[1] - r[0];
  const m = span > 0 ? span * 0.06 : Math.abs(r[0]) * 0.1 || 1;
  return [r[0] - m, r[1] + m];
}

/** Axes, grid, tick labels and titles; returns the plot frame. */
function axes(items: SceneItem[], th: PlotTheme, f: Frame, xTitle: string, yTitle: string, xUnit: string, yUnit: string, xLabels?: (v: number) => string) {
  const fs = th.fontSize;
  items.push({ type: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, fill: th.plotBackground });
  const xt = niceTicks(f.xr[0], f.xr[1], Math.max(2, Math.floor(f.w / 90)), xUnit);
  const yt = niceTicks(f.yr[0], f.yr[1], Math.max(2, Math.floor(f.h / 50)), yUnit);
  for (const v of xt.major) items.push({ type: 'line', x1: px(f, v), y1: f.y, x2: px(f, v), y2: f.y + f.h, stroke: th.gridMajor, width: 1, opacity: th.gridMajorOpacity });
  for (const v of yt.major) items.push({ type: 'line', x1: f.x, y1: py(f, v), x2: f.x + f.w, y2: py(f, v), stroke: th.gridMajor, width: 1, opacity: th.gridMajorOpacity });
  if (f.xr[0] < 0 && f.xr[1] > 0) items.push({ type: 'line', x1: px(f, 0), y1: f.y, x2: px(f, 0), y2: f.y + f.h, stroke: th.axisColor, width: 1, opacity: 0.5 });
  if (f.yr[0] < 0 && f.yr[1] > 0) items.push({ type: 'line', x1: f.x, y1: py(f, 0), x2: f.x + f.w, y2: py(f, 0), stroke: th.axisColor, width: 1, opacity: 0.5 });
  items.push({ type: 'rect', x: f.x, y: f.y, w: f.w, h: f.h, stroke: th.axisColor, strokeWidth: 1 });
  xt.major.forEach((v, i) =>
    items.push({ type: 'text', x: px(f, v), y: f.y + f.h + 6, text: xLabels ? xLabels(v) : xt.labels[i]!, size: fs * 0.92, fill: th.mutedText, anchor: 'middle', baseline: 'top' }),
  );
  yt.major.forEach((v, i) => items.push({ type: 'text', x: f.x - 6, y: py(f, v), text: yt.labels[i]!, size: fs * 0.92, fill: th.mutedText, anchor: 'end', baseline: 'middle' }));
  const xu = xLabels ? '' : xt.unitLabel;
  items.push({ type: 'text', x: f.x + f.w / 2, y: f.y + f.h + 8 + fs * 1.9, text: xu ? `${xTitle} (${xu})` : xTitle, size: fs, fill: th.text, anchor: 'middle', baseline: 'bottom' });
  items.push({ type: 'text', x: Math.max(fs * 1.1, 14), y: f.y + f.h / 2, text: yt.unitLabel ? `${yTitle} (${yt.unitLabel})` : yTitle, size: fs, fill: th.text, anchor: 'middle', baseline: 'middle', rotate: -90 });
}

function frameFor(th: PlotTheme, width: number, height: number, square: boolean): Omit<Frame, 'xr' | 'yr'> {
  const fs = th.fontSize;
  const left = Math.round(48 + fs * 2.3);
  const bottom = Math.round(22 + fs * 2.4);
  let w = width - left - 16;
  let h = height - bottom - 14;
  let x = left;
  if (square) {
    const s = Math.min(w, h);
    x = left + (w - s) / 2;
    w = h = s;
  }
  return { x, y: 14, w: Math.max(10, w), h: Math.max(10, h) };
}

export interface XYInput {
  x: { signal: SignalEval; name: string; unit: string };
  y: { signal: SignalEval; name: string; unit: string };
  t0: number;
  t1: number;
  width: number;
  height: number;
  theme: PlotTheme;
  color: string;
  /** Equal scales on both axes (1 V = same length), else each axis fits its data. */
  equal: boolean;
}

/** Parametric points (x(t), y(t)) with exact corners. */
export function xyPoints(x: SignalEval, y: SignalEval, t0: number, t1: number, n = 4000): Array<[number, number]> {
  const ts = new Map<number, boolean>();
  for (let i = 0; i <= n; i++) ts.set(t0 + ((t1 - t0) * i) / n, false);
  for (const s of [x, y]) {
    const q = s.features(t0, t1, 50_000);
    if (!q.truncated) for (const f of q.features) ts.set(f.t, (ts.get(f.t) ?? false) || f.kind === 'jump');
  }
  const out: Array<[number, number]> = [];
  const L = (s: SignalEval, t: number) => (s.left ? s.left(t) : s.value(t));
  for (const t of [...ts.keys()].sort((a, b) => a - b)) {
    if (ts.get(t)) out.push([L(x, t), L(y, t)]);
    out.push([x.value(t), y.value(t)]);
  }
  return out;
}

export function xyScene(o: XYInput): Scene {
  const th = o.theme;
  const pts = xyPoints(o.x.signal, o.y.signal, o.t0, o.t1).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  let xr: [number, number] = [Infinity, -Infinity];
  let yr: [number, number] = [Infinity, -Infinity];
  for (const [a, b] of pts) {
    xr = [Math.min(xr[0], a), Math.max(xr[1], a)];
    yr = [Math.min(yr[0], b), Math.max(yr[1], b)];
  }
  if (!pts.length) (xr = [-1, 1]), (yr = [-1, 1]);
  xr = pad(xr);
  yr = pad(yr);
  const base = frameFor(th, o.width, o.height, o.equal);
  if (o.equal) {
    // Same data span per pixel on both axes.
    const span = Math.max(xr[1] - xr[0], yr[1] - yr[0]);
    const cx = (xr[0] + xr[1]) / 2;
    const cy = (yr[0] + yr[1]) / 2;
    xr = [cx - span / 2, cx + span / 2];
    yr = [cy - span / 2, cy + span / 2];
  }
  const f: Frame = { ...base, xr, yr };
  const items: SceneItem[] = [];
  axes(items, th, f, o.x.name, o.y.name, o.x.unit, o.y.unit);
  const flat: number[] = [];
  for (const [a, b] of pts) flat.push(px(f, a), py(f, b));
  items.push({ type: 'path', polylines: [flat], stroke: o.color, width: 1.6 * th.lineScale, dash: 'solid', clipId: 'xy' });
  return { width: o.width, height: o.height, background: th.background, fontFamily: th.fontFamily, clips: [{ id: 'xy', x: f.x, y: f.y, w: f.w, h: f.h }], items };
}

export interface EyeInput {
  signal: SignalEval;
  name: string;
  unit: string;
  /** Unit interval (bit time), s. */
  ui: number;
  /** Time of the first displayed window start. */
  t0: number;
  /** Number of folded windows (traces). */
  traces: number;
  width: number;
  height: number;
  theme: PlotTheme;
  color: string;
}

export interface EyeResult {
  scene: Scene;
  /** Vertical opening at the eye centre (NaN if closed / undefined). */
  height: number;
  threshold: number;
}

export function eyeScene(o: EyeInput): EyeResult {
  const th = o.theme;
  const W = 2 * o.ui; // window: 2 UI, eye centred at 1 UI
  const n = Math.max(1, Math.min(2000, Math.round(o.traces)));
  // Like the traces of the main plot, the eye runs within the compute budget: 2000 folded windows of a
  // derived signal could block the page for many seconds. On overrun the traces are left out (the eye reads
  // "closed / undefined") and the status bar says the signal was too heavy.
  const r = budgeted(o.signal, 3000, () => rangeOf(o.signal, o.t0, o.t0 + (n + 1) * o.ui), () => null) ?? [-1, 1];
  const f: Frame = { ...frameFor(th, o.width, o.height, false), xr: [0, 2], yr: pad([r[0], r[1]]) };
  const items: SceneItem[] = [];
  axes(items, th, f, `Time (UI = ${formatSI(o.ui, 's')})`, o.name, '', o.unit, (v) => `${Number(v.toFixed(2))} UI`);
  const cols = Math.max(100, Math.round(f.w));
  const thr = (r[0] + r[1]) / 2;
  const { polylines, lowMax, highMin } = budgeted(
    o.signal,
    4000,
    () => {
      const polylines: number[][] = [];
      let lowMax = -Infinity;
      let highMin = Infinity;
      for (let k = 0; k < n; k++) {
        const a = o.t0 + k * o.ui;
        const s = sampleSignal(o.signal, a, a + W, cols);
        for (const line of s.lines) {
          const flat: number[] = [];
          for (let i = 0; i < line.t.length; i++) flat.push(px(f, (line.t[i]! - a) / o.ui), py(f, line.y[i]!));
          polylines.push(flat);
        }
        const c = o.signal.value(a + o.ui);
        if (c >= thr) highMin = Math.min(highMin, c);
        else lowMax = Math.max(lowMax, c);
      }
      return { polylines, lowMax, highMin };
    },
    () => ({ polylines: [] as number[][], lowMax: -Infinity, highMin: Infinity }),
  );
  items.push({ type: 'path', polylines, stroke: o.color, width: 1.1 * th.lineScale, dash: 'solid', clipId: 'eye', opacity: Math.max(0.15, Math.min(0.9, 6 / Math.sqrt(n))) });
  const height = Number.isFinite(highMin) && Number.isFinite(lowMax) ? highMin - lowMax : NaN;
  if (height > 0) {
    // Mark the opening at the centre.
    const x = px(f, 1);
    items.push({ type: 'line', x1: x, y1: py(f, highMin), x2: x, y2: py(f, lowMax), stroke: th.text, width: 1.2, dash: 'dashed' });
    items.push({ type: 'text', x: x + 6, y: (py(f, highMin) + py(f, lowMax)) / 2, text: `eye height ${formatSI(height, o.unit, 4)}`, size: th.fontSize * 0.92, fill: th.text, anchor: 'start', baseline: 'middle' });
  }
  return {
    scene: { width: o.width, height: o.height, background: th.background, fontFamily: th.fontFamily, clips: [{ id: 'eye', x: f.x, y: f.y, w: f.w, h: f.h }], items },
    height,
    threshold: thr,
  };
}
