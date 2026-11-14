/**
 * Project document model — exactly what is serialized into a .wlab file.
 *
 * Hierarchy:  Project → Figures → Panels → Traces (references to signals)
 *  - Overlay mode  = one panel holding several traces.
 *  - Stacked mode  = several panels, one trace each, all sharing the figure's time axis.
 */

import type { GeneratorDef } from './signal-defs';

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

/** Generator-based signal. Derived (operation) signals are added in milestone M6. */
export type SignalDef = SignalMeta & { kind: 'generator' } & GeneratorDef;

export interface AxisConfig {
  auto: boolean;
  min: number;
  max: number;
  title: string;
}

export interface Trace {
  signalId: string;
}

export interface Panel {
  id: string;
  traces: Trace[];
  yAxis: AxisConfig;
}

export interface Figure {
  id: string;
  name: string;
  mode: 'overlay' | 'stacked';
  panels: Panel[];
  /** Shared horizontal (time) axis, seconds. */
  xAxis: AxisConfig;
}

export interface Project {
  schemaVersion: number;
  appVersion: string;
  name: string;
  signals: SignalDef[];
  figures: Figure[];
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
      },
    ],
  };
}

export function autoAxis(title: string): AxisConfig {
  return { auto: true, min: -1, max: 1, title };
}
