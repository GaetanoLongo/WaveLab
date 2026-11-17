/** Measured data (CSV) → ordinary editable signals (piecewise-linear or stepped), one per column. */

import { decimateMinMax, TIME_UNITS, type CsvTable, type TimeUnitId } from '../core/io/csv';
import { setBuilder, type SignalSet } from './builder';

/** Most points one imported trace keeps (more are reduced, keeping every peak). */
export const MAX_IMPORT_POINTS = 150_000;

export interface CsvImportConfig {
  /** Column holding the time, or null for evenly spaced samples. */
  timeColumn: number | null;
  timeUnit: TimeUnitId;
  /** Spacing in seconds when there is no time column. */
  sampleInterval: number;
  /** Shift so the first sample is at t = 0. */
  startAtZero: boolean;
  /** Columns to import (value columns). */
  columns: number[];
  interp: 'linear' | 'step';
  unit: string;
  fileName: string;
}

export interface CsvSet extends SignalSet {
  duration: number;
  points: number;
  decimated: boolean;
}

const clean = (s: string) => s.replace(/[[\]]/g, '|').trim();

export function buildCsvImport(table: CsvTable, cfg: CsvImportConfig, newId: (p: string) => string, colorStart = 0): CsvSet | string {
  if (cfg.columns.length === 0) return 'Choose at least one column to import.';
  const scale = TIME_UNITS.find((u) => u.id === cfg.timeUnit)?.scale ?? 1;
  const n = table.rows.length;
  let t: number[];
  if (cfg.timeColumn === null) {
    if (!(cfg.sampleInterval > 0) || !Number.isFinite(cfg.sampleInterval)) return 'The sample interval must be greater than 0.';
    t = Array.from({ length: n }, (_, i) => i * cfg.sampleInterval);
  } else {
    t = table.rows.map((r) => r[cfg.timeColumn!]! * scale);
    for (let i = 1; i < n; i++) if (!(t[i]! > t[i - 1]!)) return `The time column must increase strictly (row ${i + 1} does not).`;
  }
  if (cfg.startAtZero && t[0]! !== 0) {
    const t0 = t[0]!;
    t = t.map((x) => x - t0);
  }
  const B = setBuilder(newId, colorStart);
  let decimated = false;
  let points = 0;
  const made = cfg.columns.map((c) => {
    const y = table.rows.map((r) => r[c]!);
    const d = decimateMinMax(t, y, MAX_IMPORT_POINTS);
    decimated ||= d.decimated;
    points = Math.max(points, d.t.length);
    const name = clean(table.header?.[c] ?? '') || `CSV ${c + 1}`;
    return B.gen(name, cfg.unit, 'piecewise', (g) => {
      g.params = { points: d.t.map((x, i) => [x, d.y[i]!] as [number, number]), interp: cfg.interp, repeat: false };
    });
  });
  const base = cfg.fileName.replace(/\.[^.]+$/, '');
  return {
    signals: B.signals,
    groups: [B.group(`Data · ${clean(base) || 'CSV'}`, made)],
    duration: t[n - 1]! - t[0]!,
    points,
    decimated,
  };
}
