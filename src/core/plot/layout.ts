/**
 * Builds the scene for one figure: one or more panels stacked vertically that all
 * share the same horizontal time axis. Independent of React and the DOM.
 */

import type { SignalEval } from '../signals/types';
import { rangeOf, type Range } from './range';
import { sampleSignal } from './sampler';
import type { Dash, Scene, SceneItem } from './scene';
import { formatSI } from '../units/si';
import { estimateWidth, plainText } from './mathtext';
import { logTicks, niceTicks } from './ticks';
import { autoYRange } from './viewport';
import type { Annotation } from '../model/project';
import { drawAnnotations, resolveAnnotations } from './annotations';

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
  legend: LegendPosition;
  margins: 'compact' | 'normal' | 'wide';
  /** Multiplier for trace line widths (presentation style). */
  lineScale: number;
}

export type LegendPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'outside-right' | 'none';

/** Per-axis presentation options (document state). */
export interface AxisStyle {
  /** Custom title; empty/undefined = automatic (signal name and unit). */
  title?: string;
  /** Fixed major tick step; null/undefined = automatic. */
  tickStep?: number | null;
  /** Fixed label decimals; null/undefined = automatic. */
  decimals?: number | null;
  /** Logarithmic vertical scale (only applied when the visible range is strictly positive). */
  log?: boolean;
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
  legend: 'top-right',
  margins: 'normal',
  lineScale: 1,
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
  legend: 'top-right',
  margins: 'normal',
  lineScale: 1,
};

/** Dark background for screens and dark slide templates. */
export const DARK_TECHNICAL: PlotTheme = {
  id: 'dark',
  label: 'Dark technical',
  background: '#0f141c',
  plotBackground: '#121a24',
  axisColor: '#c6cfdb',
  gridMajor: '#8d99ab',
  gridMajorOpacity: 0.3,
  gridMinor: '#8d99ab',
  gridMinorOpacity: 0.1,
  text: '#e6ebf2',
  mutedText: '#a9b4c4',
  fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 12,
  legend: 'top-right',
  margins: 'normal',
  lineScale: 1,
};

/** Large text and thick lines for projection. */
export const PRESENTATION: PlotTheme = {
  id: 'presentation',
  label: 'Presentation',
  background: '#ffffff',
  plotBackground: '#ffffff',
  axisColor: '#1c2330',
  gridMajor: '#8a94a6',
  gridMajorOpacity: 0.35,
  gridMinor: '#8a94a6',
  gridMinorOpacity: 0,
  text: '#111827',
  mutedText: '#374151',
  fontFamily: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  fontSize: 17,
  legend: 'top-right',
  margins: 'normal',
  lineScale: 1.8,
};

export const THEMES: Record<string, PlotTheme> = {
  light: LIGHT_TECHNICAL,
  dark: DARK_TECHNICAL,
  presentation: PRESENTATION,
  minimal: MINIMAL_PUBLICATION,
};

export const FONT_STACKS: Record<'sans' | 'serif' | 'mono', string> = {
  sans: 'Inter, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: '"STIX Two Text", "Times New Roman", Times, serif',
  mono: '"JetBrains Mono", Menlo, Consolas, "Courier New", monospace',
};

/** User overrides on top of a preset (document state, all optional). */
export interface StyleOverrides {
  background?: string | null;
  plotBackground?: string;
  gridColor?: string;
  gridOpacity?: number;
  minorGrid?: boolean;
  font?: 'sans' | 'serif' | 'mono';
  fontSize?: number;
  legend?: LegendPosition;
  margins?: 'compact' | 'normal' | 'wide';
  lineScale?: number;
}

/** Preset + overrides → effective theme. */
export function resolveTheme(presetId: string | undefined, o: StyleOverrides = {}): PlotTheme {
  const base = themeById(presetId);
  const t: PlotTheme = { ...base };
  if (o.background !== undefined) t.background = o.background;
  if (o.plotBackground !== undefined) t.plotBackground = o.plotBackground;
  if (o.gridColor !== undefined) t.gridMajor = t.gridMinor = o.gridColor;
  if (o.gridOpacity !== undefined) {
    t.gridMajorOpacity = o.gridOpacity;
    t.gridMinorOpacity = base.gridMinorOpacity > 0 ? o.gridOpacity / 3 : 0;
  }
  if (o.minorGrid !== undefined) t.gridMinorOpacity = o.minorGrid ? Math.max(0.06, t.gridMajorOpacity / 3) : 0;
  if (o.font) t.fontFamily = FONT_STACKS[o.font];
  if (o.fontSize) t.fontSize = o.fontSize;
  if (o.legend) t.legend = o.legend;
  if (o.margins) t.margins = o.margins;
  if (o.lineScale) t.lineScale = o.lineScale;
  return t;
}

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
  /** Axis presentation: time axis and vertical axes by panel id. */
  axes?: { x?: AxisStyle; y?: Record<string, AxisStyle> };
  /** Labels, arrows and dimension markers. */
  annotations?: Annotation[];
  /** Annotation drawn highlighted (screen only). */
  selectedAnnotation?: string | null;
}

export interface PanelLayout {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  yRange: Range;
  traceIds: string[];
  /** Logarithmic vertical mapping (yRange strictly positive). */
  log: boolean;
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
  const f = p.log
    ? (Math.log10(Math.max(v, 1e-300)) - Math.log10(p.yRange[0])) / (Math.log10(p.yRange[1]) - Math.log10(p.yRange[0]))
    : (v - p.yRange[0]) / (p.yRange[1] - p.yRange[0]);
  const px = p.y + p.h - f * p.h;
  return Math.max(-PX_LIMIT, Math.min(PX_LIMIT, px));
}

export function pxToY(p: PanelLayout, px: number): number {
  const f = (p.y + p.h - px) / p.h;
  if (p.log) return 10 ** (Math.log10(p.yRange[0]) + f * (Math.log10(p.yRange[1]) - Math.log10(p.yRange[0])));
  return p.yRange[0] + f * (p.yRange[1] - p.yRange[0]);
}

/** Margins scale with the font size; the legend can take space on the right. */
export function marginsFor(theme: PlotTheme, legendWidth = 0) {
  const fs = theme.fontSize;
  const m = { left: Math.round(48 + fs * 2.3), right: 16, top: 12, bottom: Math.round(22 + fs * 2) };
  if (theme.margins === 'compact') {
    m.left -= 8;
    m.bottom -= 6;
    m.top = 6;
    m.right = 8;
  } else if (theme.margins === 'wide') {
    m.left += 16;
    m.bottom += 10;
    m.top = 26;
    m.right = 32;
  }
  m.right += legendWidth;
  return m;
}

const LEGEND_ROW = (fs: number) => fs + 6;

/** Legend entries of one panel: shown when the panel holds more than one signal. */
function legendEntries(input: FigureInput, panel: PanelInput | undefined): TraceInput[] {
  if (!panel || input.theme.legend === 'none' || !input.showLegend) return [];
  const all = panel.traces.filter((t) => t.showInLegend !== false);
  return panel.traces.length > 1 && all.length > 0 ? all : [];
}

function legendSize(entries: TraceInput[], fs: number) {
  const textW = Math.max(0, ...entries.map((e) => estimateWidth(e.name, fs * 0.92)));
  return { w: 30 + textW + 10, h: entries.length * LEGEND_ROW(fs) + 8 };
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
  return panelsForGroups(mode, [{ id: 'all', traces }], yRanges);
}

export interface GroupInput<T> {
  id: string;
  name?: string;
  share?: boolean;
  traces: T[];
}

/**
 * Panels for a figure. Overlay: one panel ("overlay"). Stacked: one panel per signal
 * ("stack-<signal id>"), except groups with `share`, drawn as one panel ("group-<group id>").
 * Generic so dialogs can compute the same panel ids from signal definitions.
 */
export function panelsForGroups<T extends { id: string; name: string }>(
  mode: 'overlay' | 'stacked',
  groups: Array<GroupInput<T>>,
  yRanges: Record<string, Range | null | undefined>,
): Array<{ id: string; traces: T[]; yRange: Range | null; title?: string }> {
  if (mode === 'overlay') {
    return [{ id: 'overlay', traces: groups.flatMap((g) => g.traces), yRange: yRanges['overlay'] ?? null }];
  }
  const out: Array<{ id: string; traces: T[]; yRange: Range | null; title?: string }> = [];
  for (const g of groups) {
    if (g.share && g.traces.length > 1) {
      const id = `group-${g.id}`;
      out.push({ id, traces: g.traces, yRange: yRanges[id] ?? null, title: g.name ?? '' });
    } else {
      for (const t of g.traces) {
        const id = `stack-${t.id}`;
        out.push({ id, traces: [t], yRange: yRanges[id] ?? null, title: t.name });
      }
    }
  }
  return out;
}

export function computeLayout(input: FigureInput): FigureLayout {
  const { width, height } = input;
  const th = input.theme;
  const widest = Math.max(0, ...input.panels.map((p) => {
    const e = legendEntries(input, p);
    return e.length ? legendSize(e, th.fontSize).w : 0;
  }));
  const outside = th.legend === 'outside-right' && widest > 0 ? widest + 12 : 0;
  const M = marginsFor(th, outside);
  const plotX = M.left;
  const plotW = Math.max(10, width - M.left - M.right);
  const n = Math.max(1, input.panels.length);
  // Gaps shrink when there are many panels, so the panels always fit the figure.
  const gap = Math.min(Math.round(PANEL_GAP * (th.fontSize / 12)), Math.max(1, Math.floor((height - M.top - M.bottom) / (n * 5))));
  const avail = height - M.top - M.bottom - gap * (n - 1);
  // No minimum: panels always fit the figure (crowded panels get smaller text instead;
  // on screen the plot is given a minimum height per panel and scrolls).
  const h = Math.max(4, avail / n);
  const panels: PanelLayout[] = input.panels.map((p, i) => {
    const wantLog = !!input.axes?.y?.[p.id]?.log;
    let yRange = p.yRange ?? autoYRange(p.traces.map((t) => t.signal));
    let log = false;
    if (wantLog) {
      if (!p.yRange) yRange = autoLogRange(p.traces.map((t) => t.signal), input.xRange) ?? yRange;
      log = yRange[0] > 0 && yRange[1] > yRange[0];
    }
    return { id: p.id, x: plotX, y: M.top + i * (h + gap), w: plotW, h, yRange, traceIds: p.traces.map((t) => t.id), log };
  });
  if (panels.length === 0) {
    panels.push({ id: 'empty', x: plotX, y: M.top, w: plotW, h, yRange: [-1, 1], traceIds: [], log: false });
  }
  return { width, height, xRange: input.xRange, plotX, plotW, panels };
}

/** Automatic positive range for a log axis (null if any visible value is ≤ 0). */
/**
 * Automatic log range. Besides each signal's full range (as for linear axes) it includes
 * the visible time window: on a log axis a decaying tail (e.g. an exponential beyond
 * the 5τ fitting region) is exactly what the reader looks at.
 */
export function autoLogRange(signals: SignalEval[], visible?: Range): Range | null {
  const r = autoYRangeRaw(signals);
  if (!r || !(r[0] > 0)) return null;
  let [lo, hi] = r;
  if (visible) {
    for (const s of signals) {
      const v = rangeOf(s, visible[0], visible[1]);
      if (v && v[0] > 0) {
        lo = Math.min(lo, v[0]);
        hi = Math.max(hi, v[1]);
      }
    }
  }
  return [lo / 1.3, hi * 1.3];
}

function autoYRangeRaw(signals: SignalEval[]): Range | null {
  const lin = autoYRange(signals);
  // Undo the 8 % padding of the linear auto range to get the data range.
  const span = (lin[1] - lin[0]) / 1.16;
  const mid = (lin[0] + lin[1]) / 2;
  return [mid - span / 2, mid + span / 2];
}

export function buildFigure(input: FigureInput): { scene: Scene; layout: FigureLayout } {
  const layout = computeLayout(input);
  const th = input.theme;
  const fs = th.fontSize;
  const items: SceneItem[] = [];
  const clips: Scene['clips'] = [];
  const [t0, t1] = layout.xRange;

  const xs = input.axes?.x;
  const xt = timeTicks(layout, xs);
  const scale = th.lineScale;

  layout.panels.forEach((pl, idx) => {
    const pin = input.panels[idx];
    const traces = pin?.traces ?? [];
    const isLast = idx === layout.panels.length - 1;
    const clipId = `clip-${idx}`;
    clips.push({ id: clipId, x: pl.x, y: pl.y, w: pl.w, h: pl.h });

    items.push({ type: 'rect', x: pl.x, y: pl.y, w: pl.w, h: pl.h, fill: th.plotBackground });

    const units = new Set(traces.map((t) => t.unit));
    const unit = units.size === 1 ? [...units][0]! : '';
    const ys = input.axes?.y?.[pl.id];
    // Text size inside this panel: the theme's size, reduced when panels are short.
    const pfs = Math.max(6.5, Math.min(fs, pl.h / 3.2));
    const yt = pl.log
      ? logTicks(pl.yRange[0], pl.yRange[1], unit)
      : niceTicks(pl.yRange[0], pl.yRange[1], Math.max(2, Math.floor(pl.h / (pfs * 3))), unit, 1e12, {
          step: ys?.tickStep,
          decimals: ys?.decimals,
          minCount: pl.h >= pfs * 4 ? 3 : 2,
        });

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
      const polylines: number[][] = [];
      for (const line of sampled.lines) {
        let flat: number[] = [];
        for (let i = 0; i < line.t.length; i++) {
          const v = line.y[i]!;
          if (pl.log && !(v > 0)) {
            // Non-positive values have no place on a log axis: leave a gap.
            if (flat.length) polylines.push(flat);
            flat = [];
            continue;
          }
          flat.push(tToPx(layout, line.t[i]!), yToPx(pl, v));
        }
        if (flat.length) polylines.push(flat);
      }
      const lw = tr.lineWidth * scale;
      if (tr.highlight) {
        items.push({
          type: 'path',
          polylines,
          stroke: tr.color,
          width: lw + 6,
          dash: 'solid',
          opacity: 0.18,
          clipId,
        });
      }
      items.push({
        type: 'path',
        polylines,
        stroke: tr.color,
        width: lw,
        dash: sampled.mode === 'envelope' ? 'solid' : tr.dash,
        clipId,
        dataId: tr.id,
      });
      drawImpulses(items, tr, pl, layout, clipId, fs);
    }

    // Frame.
    items.push({ type: 'rect', x: pl.x, y: pl.y, w: pl.w, h: pl.h, stroke: th.axisColor, strokeWidth: 1 });

    // Y tick labels and title. In short panels, label only every k-th tick (multiples of
    // k steps, so 0 keeps its label) to keep labels from overlapping.
    const spacing = yt.major.length > 1 ? Math.abs(yToPx(pl, yt.major[1]!) - yToPx(pl, yt.major[0]!)) : Infinity;
    const every = pl.log ? 1 : Math.max(1, Math.ceil((pfs * 1.15) / Math.max(spacing, 1e-9)));
    yt.major.forEach((v, i) => {
      if (every > 1 && Math.round(v / yt.step) % every !== 0) return;
      items.push({
        type: 'text',
        x: pl.x - 6,
        y: yToPx(pl, v),
        text: yt.labels[i]!,
        size: pfs * 0.92,
        fill: th.mutedText,
        anchor: 'end',
        baseline: 'middle',
      });
    });
    const yTitleBase = pin?.title ?? (traces.length === 1 ? traces[0]!.name : '');
    const autoTitle = yt.unitLabel ? (yTitleBase ? `${yTitleBase} (${yt.unitLabel})` : yt.unitLabel) : yTitleBase;
    const yTitle = fitTitle(ys?.title?.trim() ? ys.title : autoTitle, yTitleBase, pl.h, pfs);
    if (yTitle) {
      items.push({
        type: 'text',
        x: Math.max(fs * 1.1, 14),
        y: pl.y + pl.h / 2,
        text: yTitle.text,
        size: yTitle.size,
        fill: th.text,
        anchor: 'middle',
        baseline: 'middle',
        rotate: -90,
      });
    }

    // Legend (overlay mode): corner inside the panel, or outside on the right.
    const entries = legendEntries(input, pin);
    if (entries.length > 0 && legendSize(entries, pfs).h > pl.h - 8 && th.legend !== 'outside-right') {
      // Too short for a column of entries: one row along the top (as many as fit).
      const lfs = pfs * 0.92;
      const rowH = Math.min(LEGEND_ROW(pfs), pl.h - 4);
      const widths = entries.map((e) => 32 + estimateWidth(e.name, lfs) + 10);
      let n = 0;
      let boxW = 0;
      while (n < entries.length && boxW + widths[n]! <= pl.w - 16) boxW += widths[n++]!;
      if (n > 0) {
        const left = th.legend === 'top-left' || th.legend === 'bottom-left';
        const bx = left ? pl.x + 8 : pl.x + pl.w - boxW - 8;
        const by = pl.y + 2;
        items.push({ type: 'rect', x: bx, y: by, w: boxW, h: rowH, fill: th.plotBackground, stroke: th.gridMajor, strokeWidth: 0.8, opacity: 0.92 });
        let x = bx;
        for (let i = 0; i < n; i++) {
          const e = entries[i]!;
          const cy = by + rowH / 2;
          items.push({ type: 'line', x1: x + 8, y1: cy, x2: x + 26, y2: cy, stroke: e.color, width: e.lineWidth * scale, dash: e.dash });
          items.push({ type: 'text', x: x + 32, y: cy, text: e.name, size: lfs, fill: th.text, anchor: 'start', baseline: 'middle' });
          x += widths[i]!;
        }
      }
    } else if (entries.length > 0) {
      const rowH = LEGEND_ROW(fs);
      const { w: boxW, h: boxH } = legendSize(entries, fs);
      const pos = th.legend;
      const bx =
        pos === 'outside-right' ? pl.x + pl.w + 12 : pos === 'top-left' || pos === 'bottom-left' ? pl.x + 8 : pl.x + pl.w - boxW - 8;
      const by = pos === 'bottom-left' || pos === 'bottom-right' ? pl.y + pl.h - boxH - 8 : pl.y + 8;
      items.push({ type: 'rect', x: bx, y: by, w: boxW, h: boxH, fill: th.plotBackground, stroke: th.gridMajor, strokeWidth: 0.8, opacity: 0.92 });
      entries.forEach((e, i) => {
        const cy = by + 4 + rowH * i + rowH / 2;
        items.push({ type: 'line', x1: bx + 8, y1: cy, x2: bx + 26, y2: cy, stroke: e.color, width: e.lineWidth * scale, dash: e.dash });
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
        text: xs?.title?.trim() ? xs.title : `${input.xTitle} (${xt.unitLabel})`,
        size: fs,
        fill: th.text,
        anchor: 'middle',
        baseline: 'bottom',
      });
    }
  });

  if (input.annotations?.length) {
    const unitOf = (id: string) => input.panels.flatMap((p) => p.traces).find((t) => t.id === id)?.unit;
    drawAnnotations(items, resolveAnnotations(input.annotations, layout, unitOf), layout, fs, th.lineScale, input.selectedAnnotation);
  }
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

/**
 * A vertical axis title that fits the panel height: full size, then smaller (down to
 * 75 %), then without the unit, then shortened with an ellipsis; null if nothing fits.
 */
function fitTitle(full: string, base: string, h: number, fs: number): { text: string; size: number } | null {
  if (!full) return null;
  const room = h - 4;
  for (const text of base && base !== full ? [full, base] : [full]) {
    for (const size of [fs, fs * 0.85, fs * 0.75]) if (estimateWidth(text, size) <= room) return { text, size };
  }
  const size = fs * 0.75;
  const plain = plainText(base || full);
  const chars = Math.floor(room / (size * 0.58)) - 1;
  return chars >= 2 ? { text: `${plain.slice(0, chars)}…`, size } : null;
}

/** Time-axis ticks exactly as drawn (shared with snapping so the grid matches). */
export function timeTicks(l: FigureLayout, style?: AxisStyle) {
  return niceTicks(l.xRange[0], l.xRange[1], Math.max(2, Math.floor(l.plotW / 90)), 's', 1, {
    step: style?.tickStep,
    decimals: style?.decimals,
  });
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
