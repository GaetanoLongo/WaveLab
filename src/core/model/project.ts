/**
 * Project document model — exactly what is serialized into a .wlab file.
 *
 * Hierarchy:  Project → Figures → Panels → Traces (references to signals)
 *  - Overlay mode  = one panel holding several traces.
 *  - Stacked mode  = several panels, one trace each, all sharing the figure's time axis.
 */

import type { GeneratorDef } from './signal-defs';
import type { AxisStyle, StyleOverrides } from '../plot/layout';

export const SCHEMA_VERSION = 1;
export const FILE_EXTENSION = '.wlab';

export type LineDash = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface SignalStyle {
  color: string;
  lineWidth: number;
  dash: LineDash;
  visible: boolean;
  showInLegend: boolean;
}

export interface SignalMeta {
  id: string;
  name: string;
  /** Physical quantity unit for the vertical axis, e.g. "V" or "A". */
  unit: string;
  locked: boolean;
  style: SignalStyle;
}

/** Signal defined by a waveform generator. */
export type GeneratorSignalDef = SignalMeta & { kind: 'generator' } & GeneratorDef;

/**
 * Signal defined by an expression of other signals (operations, comparators, logic…).
 * `expr` is the stored form: signals are referenced by id as #{id}, so renames are safe.
 */
export interface DerivedParams {
  expr: string;
  /** Output levels when the expression is logic (comparison, and/or/not…). */
  logicHigh: number;
  logicLow: number;
  /** Analog inputs of logic operators count as 1 above this value. */
  threshold: number;
  /** Computational sampling step in seconds; null = automatic (1/64 of the shortest input period). */
  resolution: number | null;
}
export type DerivedSignalDef = SignalMeta & { kind: 'derived' } & DerivedParams;

export type SignalDef = GeneratorSignalDef | DerivedSignalDef;

export interface AxisConfig {
  auto: boolean;
  min: number;
  max: number;
  title: string;
}

export interface Trace {
  signalId: string;
}

/**
 * A group of signals in a figure (shown as a named block in the signal list).
 * In stacked mode a group with `share` is drawn as one panel with all its signals.
 */
export interface Panel {
  id: string;
  traces: Trace[];
  yAxis: AxisConfig;
  /** Group name; undefined for the default unnamed group. */
  name?: string;
  /** Stacked mode: overlay this group's signals in one shared panel. */
  share?: boolean;
  /** Collapsed in the signal list (UI only, saved for convenience). */
  collapsed?: boolean;
}

export interface Figure {
  id: string;
  name: string;
  mode: 'overlay' | 'stacked';
  panels: Panel[];
  /** Shared horizontal (time) axis, seconds. */
  xAxis: AxisConfig;
  /** Style preset id ('light' | 'minimal'; more in M9). Used on screen and for export. */
  stylePreset: string;
  showLegend: boolean;
  /** Overrides on top of the preset (colours, fonts, legend position, margins, line scale). */
  style?: StyleOverrides;
  /** Axis presentation: time axis and vertical axes by panel id ("overlay" or "stack-<signal id>"). */
  axes?: { x?: AxisStyle; y?: Record<string, AxisStyle> };
}

/** Measurement cursors: two time cursors (all panels) and two level cursors (target's panel). */
export interface Cursors {
  t: [number | null, number | null];
  y: [number | null, number | null];
  /** Signal that is measured and whose panel/units the level cursors use (null = selected signal). */
  target: string | null;
}

export const NO_CURSORS: Cursors = { t: [null, null], y: [null, null], target: null };

/** Saved view (zoom/pan, cursors) so a reopened project looks the same. */
export interface SavedView {
  xRange: [number, number];
  /** Manual vertical ranges by panel id (absent = automatic). */
  yRanges: Record<string, [number, number]>;
  cursors?: Cursors;
  /** Views of the other figures, by figure id (zoom and cursors are per figure). */
  byFigure?: Record<string, { xRange: [number, number]; yRanges: Record<string, [number, number]>; cursors?: Cursors }>;
  /** Figure shown when the project was saved. */
  activeFigure?: string;
  /** Figures shown as a grid when the project was saved. */
  gridView?: boolean;
}

/** Grid view of all figures: columns (null = automatic) and time-axis linking. */
export interface GridSettings {
  columns: number | null;
  link: 'none' | 'columns' | 'all';
}

export interface Project {
  schemaVersion: number;
  appVersion: string;
  name: string;
  signals: SignalDef[];
  figures: Figure[];
  grid?: GridSettings;
}

/** Number of grid columns for n figures. */
export function gridColumns(n: number, g?: GridSettings): number {
  return Math.max(1, Math.min(n, g?.columns ?? Math.ceil(Math.sqrt(n))));
}

export function emptyProject(name = 'Untitled'): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: __APP_VERSION__,
    name,
    signals: [],
    figures: [
      {
        id: 'fig-1',
        name: 'Figure 1',
        mode: 'overlay',
        panels: [{ id: 'panel-1', traces: [], yAxis: autoAxis('') }],
        xAxis: { auto: true, min: 0, max: 0.04, title: 'Time' },
        stylePreset: 'light',
        showLegend: true,
      },
    ],
  };
}

export function autoAxis(title: string): AxisConfig {
  return { auto: true, min: -1, max: 1, title };
}
