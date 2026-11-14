/**
 * Builds the scene for one figure: one or more panels stacked vertically that all
 * share the same horizontal time axis. Independent of React and the DOM.
 */

import type { SignalEval } from '../signals/types';
import type { Range } from './range';
import { sampleSignal } from './sampler';
import type { Dash, Scene, SceneItem } from './scene';
import { formatSI } from '../units/si';
import { estimateWidth } from './mathtext';
import { niceTicks } from './ticks';
import { autoYRange } from './viewport';

export interface PlotTheme {
  id: string;
  label: string;
  background: string | null;
  plotBackground: string;
  axisColor: string;
  gridMajor: string;
  gridMajorOpacity: number;
  gridMinor: string;
  gridMinorOpacity: number;
  text: string;
  mutedText: string;
  fontFamily: string;
  fontSize: number;
}

export const LIGHT_TECHNICAL: PlotTheme = {
  id: 'light',
  label: 'Light technical',
  background: '#ffffff',
  plotBackground: '#ffffff',
  axisColor: '#2b3340',
  gridMajor: '#8a94a6',
  gridMajorOpacity: 0.45,
  gridMinor: '#8a94a6',
  gridMinorOpacity: 0.15,
  text: '#1c2330',
  mutedText: '#4a5466',
  fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 12,
};

/** Clean look for papers: no minor grid, faint major grid, black text. */
export const MINIMAL_PUBLICATION: PlotTheme = {
  id: 'minimal',
  label: 'Minimal / publication',
  background: '#ffffff',
  plotBackground: '#ffffff',
  axisColor: '#000000',
  gridMajor: '#000000',
  gridMajorOpacity: 0.12,
  gridMinor: '#000000',
  gridMinorOpacity: 0,
  text: '#000000',
  mutedText: '#000000',
  fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 12,
};

export const THEMES: Record<string, PlotTheme> = {
  light: LIGHT_TECHNICAL,
  minimal: MINIMAL_PUBLICATION,
};

export function themeById(id: string | undefined): PlotTheme {
  return (id && THEMES[id]) || LIGHT_TECHNICAL;
}

export interface TraceInput {
  id: string;
  name: string;
  signal: SignalEval;
  color: string;
  lineWidth: number;
  dash: Dash;
  unit: string;
  showInLegend?: boolean;
  /** Draw a soft halo behind the trace (selection, on screen only). */
  highlight?: boolean;
}

export interface PanelInput {
  id: string;
  traces: TraceInput[];
  /** null = automatic vertical range (full signal range, independent of zoom). */
  yRange: Range | null;
  title?: string;
}

export interface CursorSpec {
  t: ReadonlyArray<number | null>;
  y: ReadonlyArray<number | null>;
  /** Trace whose panel holds the level cursors. */
  yTraceId: string | null;
}

export const CURSOR_COLORS = { t: '#c2255c', y: '#6741d9' };

export interface FigureInput {
  width: number;
  height: number;
  panels: PanelInput[];
  xRange: Range;
  xTitle: string;
  showLegend: boolean;
  theme: PlotTheme;
  /** Measurement cursors (on screen always; in exports only on request). */
  cursors?: CursorSpec;
}

export interface PanelLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  yRange: Range;
  traceIds: string[];
}

export interface FigureLayout {
  width: number;
  height: number;
  xRange: Range;
  plotX: number;
  plotW: number;
  panels: PanelLayout[];
}

export const MARGIN = { left: 76, right: 16, top: 12, bottom: 46 };
export const PANEL_GAP = 14;
const PX_LIMIT = 1e6;

export function tToPx(l: FigureLayout, t: number): number {
  return l.plotX + ((t - l.xRange[0]) / (l.xRange[1] - l.xRange[0])) * l.plotW;
}

export function pxToT(l: FigureLayout, px: number): number {
  return l.xRange[0] + ((px - l.plotX) / l.plotW) * (l.xRange[1] - l.xRange[0]);
}

export function yToPx(p: PanelLayout, v: number): number {
  const px = p.y + p.h - ((v - p.yRange[0]) / (p.yRange[1] - p.yRange[0])) * p.h;
  return Math.max(-PX_LIMIT, Math.min(PX_LIMIT, px));
}

export function pxToY(p: PanelLayout, px: number): number {
  return p.yRange[0] + ((p.y + p.h - px) / p.h) * (p.yRange[1] - p.yRange[0]);
}

export function panelAt(l: FigureLayout, py: number): PanelLayout | undefined {
  return l.panels.find((p) => py >= p.y && py <= p.y + p.h);
}

/**
 * Overlay = all traces in one panel. Stacked = one panel per trace.
 * `yRanges` holds manual vertical ranges keyed by panel id.
 */
export function panelsForMode(
  mode: 'overlay' | 'stacked',
  traces: TraceInput[],
  yRanges: Record<string, Range | null | undefined>,
): PanelInput[] {
  if (mode === 'overlay') {
    return [{ id: 'overlay', traces, yRange: yRanges['overlay'] ?? null }];
  }
  return traces.map((t) => {
    const id = `stack-${t.id}`;
    return { id, traces: [t], yRange: yRanges[id] ?? null, title: t.name };
  });
}

export function computeLayout(input: FigureInput): FigureLayout {
  const { width, height } = input;
  const plotX = MARGIN.left;
  const plotW = Math.max(10, width - MARGIN.left - MARGIN.right);
  const n = Math.max(1, input.panels.length);
  const avail = height - MARGIN.top - MARGIN.bottom - PANEL_GAP * (n - 1);
  const h = Math.max(30, avail / n);
  const panels: PanelLayout[] = input.panels.map((p, i) => ({
    id: p.id,
    x: plotX,
    y: MARGIN.top + i * (h + PANEL_GAP),
    w: plotW,
    h,
    yRange:
      p.yRange ??
      autoYRange(p.traces.map((t) => t.signal)),
    traceIds: p.traces.map((t) => t.id),
  }));
  if (panels.length === 0) {
    panels.push({ id: 'empty', x: plotX, y: MARGIN.top, w: plotW, h, yRange: [-1, 1], traceIds: [] });
  }
  return { width, height, xRange: input.xRange, plotX, plotW, panels };
}

export function buildFigure(input: FigureInput): { scene: Scene; layout: FigureLayout } {
  const layout = computeLayout(input);
  const th = input.theme;
  const fs = th.fontSize;
  const items: SceneItem[] = [];
  const clips: Scene['clips'] = [];
  const [t0, t1] = layout.xRange;

  const xt = timeTicks(layout);

  layout.panels.forEach((pl, idx) => {
    const pin = input.panels[idx];
    const traces = pin?.traces ?? [];
    const isLast = idx === layout.panels.length - 1;
    const clipId = `clip-${idx}`;
    clips.push({ id: clipId, x: pl.x, y: pl.y, w: pl.w, h: pl.h });

    items.push({ type: 'rect', x: pl.x, y: pl.y, w: pl.w, h: pl.h, fill: th.plotBackground });

    const units = new Set(traces.map((t) => t.unit));
    const unit = units.size === 1 ? [...units][0]! : '';
    const yt = niceTicks(pl.yRange[0], pl.yRange[1], Math.max(2, Math.floor(pl.h / 36)), unit);

    // Grid.
    const vline = (t: number, color: string, opacity: number) => {
      const x = tToPx(layout, t);
      items.push({ type: 'line', x1: x, y1: pl.y, x2: x, y2: pl.y + pl.h, stroke: color, width: 1, opacity });
    };
    const hline = (v: number, color: string, opacity: number, width = 1) => {
      const y = yToPx(pl, v);
      items.push({ type: 'line', x1: pl.x, y1: y, x2: pl.x + pl.w, y2: y, stroke: color, width, opacity });
    };
    if (th.gridMinorOpacity > 0) {
      for (const t of xt.minor) vline(t, th.gridMinor, th.gridMinorOpacity);
      for (const v of yt.minor) hline(v, th.gridMinor, th.gridMinorOpacity);
    }
    for (const t of xt.major) vline(t, th.gridMajor, th.gridMajorOpacity);
    for (const v of yt.major) hline(v, th.gridMajor, th.gridMajorOpacity);
    if (pl.yRange[0] < 0 && pl.yRange[1] > 0) hline(0, th.axisColor, 0.55, 1);

    // Traces.
    for (const tr of traces) {
      const sampled = sampleSignal(tr.signal, t0, t1, layout.plotW);
      const polylines = sampled.lines.map((line) => {
        const flat: number[] = new Array(line.t.length * 2);
        for (let i = 0; i < line.t.length; i++) {
          flat[2 * i] = tToPx(layout, line.t[i]!);
          flat[2 * i + 1] = yToPx(pl, line.y[i]!);
        }
        return flat;
      });
      if (tr.highlight) {
        items.push({
          type: 'path',
          polylines,
          stroke: tr.color,
          width: tr.lineWidth + 6,
          dash: 'solid',
          opacity: 0.18,
          clipId,
        });
      }
      items.push({
        type: 'path',
        polylines,
        stroke: tr.color,
        width: tr.lineWidth,
        dash: sampled.mode === 'envelope' ? 'solid' : tr.dash,
        clipId,
        dataId: tr.id,
      });
      drawImpulses(items, tr, pl, layout, clipId, fs);
    }

    // Frame.
    items.push({ type: 'rect', x: pl.x, y: pl.y, w: pl.w, h: pl.h, stroke: th.axisColor, strokeWidth: 1 });

    // Y tick labels and title.
    yt.major.forEach((v, i) => {
      items.push({
        type: 'text',
        x: pl.x - 6,
        y: yToPx(pl, v),
        text: yt.labels[i]!,
        size: fs * 0.92,
        fill: th.mutedText,
        anchor: 'end',
        baseline: 'middle',
      });
    });
    const yTitleBase = pin?.title ?? (traces.length === 1 ? traces[0]!.name : '');
    const yTitle = yt.unitLabel ? (yTitleBase ? `${yTitleBase} (${yt.unitLabel})` : yt.unitLabel) : yTitleBase;
    if (yTitle) {
      items.push({
        type: 'text',
        x: 14,
        y: pl.y + pl.h / 2,
        text: yTitle,
        size: fs,
        fill: th.text,
        anchor: 'middle',
        baseline: 'middle',
        rotate: -90,
      });
    }

    // Overlay legend (top-right, inside).
    const entries = traces.filter((t) => t.showInLegend !== false);
    if (input.showLegend && traces.length > 1 && entries.length > 0) {
      const rowH = fs + 6;
      const textW = Math.max(...entries.map((e) => estimateWidth(e.name, fs * 0.92)));
      const boxW = 30 + textW + 10;
      const boxH = entries.length * rowH + 8;
      const bx = pl.x + pl.w - boxW - 8;
      const by = pl.y + 8;
      items.push({ type: 'rect', x: bx, y: by, w: boxW, h: boxH, fill: th.plotBackground, stroke: th.gridMajor, strokeWidth: 0.8, opacity: 0.92 });
      entries.forEach((e, i) => {
        const cy = by + 4 + rowH * i + rowH / 2;
        items.push({ type: 'line', x1: bx + 8, y1: cy, x2: bx + 26, y2: cy, stroke: e.color, width: e.lineWidth, dash: e.dash });
        items.push({ type: 'text', x: bx + 32, y: cy, text: e.name, size: fs * 0.92, fill: th.text, anchor: 'start', baseline: 'middle' });
      });
    }

    // X tick labels and title under the last panel only (shared axis).
    if (isLast) {
      xt.major.forEach((t, i) => {
        items.push({
          type: 'text',
          x: tToPx(layout, t),
          y: pl.y + pl.h + 6,
          text: xt.labels[i]!,
          size: fs * 0.92,
          fill: th.mutedText,
          anchor: 'middle',
          baseline: 'top',
        });
      });
      items.push({
        type: 'text',
        x: pl.x + pl.w / 2,
        y: input.height - 8,
        text: `${input.xTitle} (${xt.unitLabel})`,
        size: fs,
        fill: th.text,
        anchor: 'middle',
        baseline: 'bottom',
      });
    }
  });

  if (input.cursors) drawCursors(items, input.cursors, layout, fs);

  const scene: Scene = {
    width: input.width,
    height: input.height,
    background: th.background,
    fontFamily: th.fontFamily,
    clips,
    items,
  };
  return { scene, layout };
}

/** Time-axis ticks exactly as drawn (shared with snapping so the grid matches). */
export function timeTicks(l: FigureLayout) {
  return niceTicks(l.xRange[0], l.xRange[1], Math.max(2, Math.floor(l.plotW / 90)), 's', 1);
}

/**
 * Ideal impulses (e.g. derivative of an ideal edge) as arrows from the zero line,
 * labelled with their area. Their height is symbolic: it never affects the axis range.
 */
function drawImpulses(items: SceneItem[], tr: TraceInput, pl: PanelLayout, l: FigureLayout, clipId: string, fs: number) {
  const imps = tr.signal.impulses?.(l.xRange[0], l.xRange[1]) ?? [];
  if (imps.length === 0 || imps.length > l.plotW / 3) return;
  const zero = Math.min(Math.max(0, pl.yRange[0]), pl.yRange[1]);
  const y0 = yToPx(pl, zero);
  const len = pl.h * 0.38;
  const polylines: number[][] = [];
  const head = Math.min(7, len / 4);
  for (const imp of imps) {
    const x = tToPx(l, imp.t);
    const dir = imp.weight >= 0 ? -1 : 1; // positive = up (smaller y)
    const tip = y0 + dir * len;
    polylines.push([x, y0, x, tip]);
    polylines.push([x - head * 0.6, tip - dir * head, x, tip, x + head * 0.6, tip - dir * head]);
  }
  items.push({ type: 'path', polylines, stroke: tr.color, width: Math.max(1.2, tr.lineWidth), dash: 'solid', clipId, dataId: tr.id });
  if (imps.length <= l.plotW / 70) {
    const unit = tr.unit.endsWith('/s') ? tr.unit.slice(0, -2) : '';
    for (const imp of imps) {
      const x = tToPx(l, imp.t);
      const dir = imp.weight >= 0 ? -1 : 1;
      const nearRight = x > l.plotX + l.plotW - 60;
      items.push({
        type: 'text',
        x: nearRight ? x - 4 : x + 4,
        y: y0 + dir * len,
        text: `δ·${formatSI(imp.weight, unit, 4)}`,
        size: fs * 0.85,
        fill: tr.color,
        anchor: nearRight ? 'end' : 'start',
        baseline: dir < 0 ? 'top' : 'bottom',
      });
    }
  }
}

/** Time cursors across all panels (shaded between them) and level cursors in the target's panel. */
function drawCursors(items: SceneItem[], c: CursorSpec, l: FigureLayout, fs: number) {
  const first = l.panels[0];
  const last = l.panels[l.panels.length - 1];
  if (!first || !last) return;
  const top = first.y;
  const bottom = last.y + last.h;
  const [t1, t2] = c.t;
  const inView = (t: number) => t >= l.xRange[0] && t <= l.xRange[1];
  if (t1 != null && t2 != null) {
    const xa = tToPx(l, Math.max(Math.min(t1, t2), l.xRange[0]));
    const xb = tToPx(l, Math.min(Math.max(t1, t2), l.xRange[1]));
    if (xb > xa) {
      for (const p of l.panels) items.push({ type: 'rect', x: xa, y: p.y, w: xb - xa, h: p.h, fill: CURSOR_COLORS.t, opacity: 0.06 });
    }
  }
  c.t.forEach((t, i) => {
    if (t == null || !inView(t)) return;
    const x = tToPx(l, t);
    items.push({ type: 'line', x1: x, y1: top, x2: x, y2: bottom, stroke: CURSOR_COLORS.t, width: 1.3, dash: i === 0 ? 'solid' : 'dashed' });
    items.push({ type: 'rect', x: x - 7, y: top, w: 14, h: 14, fill: CURSOR_COLORS.t });
    items.push({ type: 'text', x, y: top + 7, text: String(i + 1), size: fs * 0.8, fill: '#ffffff', anchor: 'middle', baseline: 'middle', weight: 'bold' });
  });
  const panel = c.yTraceId ? l.panels.find((p) => p.traceIds.includes(c.yTraceId!)) : undefined;
  if (!panel) return;
  c.y.forEach((v, i) => {
    if (v == null || v < panel.yRange[0] || v > panel.yRange[1]) return;
    const y = yToPx(panel, v);
    items.push({ type: 'line', x1: panel.x, y1: y, x2: panel.x + panel.w, y2: y, stroke: CURSOR_COLORS.y, width: 1.3, dash: i === 0 ? 'solid' : 'dashed' });
    items.push({ type: 'rect', x: panel.x + panel.w - 14, y: y - 7, w: 14, h: 14, fill: CURSOR_COLORS.y });
    items.push({
      type: 'text', x: panel.x + panel.w - 7, y, text: i === 0 ? 'A' : 'B', size: fs * 0.8, fill: '#ffffff', anchor: 'middle', baseline: 'middle', weight: 'bold',
    });
  });
}
