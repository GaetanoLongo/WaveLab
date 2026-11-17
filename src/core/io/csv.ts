/**
 * Plain-text measurement data (oscilloscope or logger exports): CSV / TSV / space-separated, with or
 * without a header, decimal point or comma, comment lines. Parsing is tolerant but never guesses
 * silently: unreadable lines are counted and reported.
 */

export interface CsvTable {
  header: string[] | null;
  /** Number of columns. */
  columns: number;
  /** Numeric rows, all with `columns` values. */
  rows: number[][];
  /** Lines that could not be read as numbers (not counting empty and comment lines). */
  skipped: number;
  delimiter: ',' | ';' | '\t' | ' ' | '';
}

export const MAX_CSV_CHARS = 60_000_000;
export const MAX_CSV_ROWS = 2_000_000;

const DELIMS = [',', ';', '\t', ' '] as const;

const splitLine = (line: string, d: string): string[] => (d === ' ' ? line.trim().split(/\s+/) : d === '' ? [line] : line.split(d)).map((f) => f.trim().replace(/^"(.*)"$/, '$1').trim());

function toNumber(f: string, decimalComma: boolean): number {
  if (f === '') return NaN;
  const t = decimalComma ? f.replace(',', '.') : f;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN; // 1e999 overflows to Infinity: not a usable value
}

/** Parse the text; a string result is the reason it cannot be used. */
export function parseCsv(text: string): CsvTable | string {
  if (text.length > MAX_CSV_CHARS) return 'The file is larger than 60 MB.';
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r\n|\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !/^(#|\/\/|%)/.test(l));
  if (lines.length < 2) return 'The file needs at least two lines of data.';

  // Delimiter: the candidate that gives the most columns consistently over the first lines.
  const sample = lines.slice(0, 25);
  let delimiter: CsvTable['delimiter'] = '';
  let bestCols = 1;
  for (const d of DELIMS) {
    const counts = sample.map((l) => splitLine(l, d).filter((f, i, a) => !(i === a.length - 1 && f === '' && a.length > 1)).length);
    const cols = counts[Math.min(1, counts.length - 1)]!; // the second line is never the header
    const consistent = counts.filter((c) => c === cols).length >= 0.8 * counts.length;
    if (cols > bestCols && consistent) (delimiter = d), (bestCols = cols);
  }
  const decimalComma = delimiter !== ',' && delimiter !== '' && sample.some((l) => /(^|[;\t ])-?\d+,\d+([eE][+-]?\d+)?([;\t ]|$)/.test(l));

  const fieldsOf = (l: string) => {
    const f = splitLine(l, delimiter);
    if (f.length > 1 && f[f.length - 1] === '') f.pop(); // trailing delimiter
    return f;
  };
  const first = fieldsOf(lines[0]!);
  const columns = first.length;
  const firstNums = first.map((f) => toNumber(f, decimalComma));
  const hasHeader = firstNums.some((v) => Number.isNaN(v));
  const header = hasHeader ? first : null;

  const rows: number[][] = [];
  let skipped = 0;
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const f = fieldsOf(lines[i]!);
    if (f.length !== columns) {
      skipped++;
      continue;
    }
    const nums = f.map((x) => toNumber(x, decimalComma));
    if (nums.some((v) => Number.isNaN(v))) {
      skipped++;
      continue;
    }
    rows.push(nums);
    if (rows.length > MAX_CSV_ROWS) return `More than ${MAX_CSV_ROWS.toLocaleString('en')} rows: reduce the file first.`;
  }
  if (rows.length < 2) return 'Fewer than two rows could be read as numbers.';
  return { header, columns, rows, skipped, delimiter };
}

/** First column whose values strictly increase (a time axis), or null. */
export function guessTimeColumn(t: CsvTable): number | null {
  for (let c = 0; c < t.columns; c++) {
    let ok = true;
    for (let i = 1; i < t.rows.length; i++)
      if (!(t.rows[i]![c]! > t.rows[i - 1]![c]!)) {
        ok = false;
        break;
      }
    if (ok) return c;
  }
  return null;
}

export const TIME_UNITS = [
  { id: 's', label: 's', scale: 1 },
  { id: 'ms', label: 'ms', scale: 1e-3 },
  { id: 'us', label: 'µs', scale: 1e-6 },
  { id: 'ns', label: 'ns', scale: 1e-9 },
] as const;
export type TimeUnitId = (typeof TIME_UNITS)[number]['id'];

/** Unit written in a header such as “Time (ms)”, “t [us]”, “time_ns”; seconds if there is none. */
export function guessTimeUnit(headerText: string | undefined): TimeUnitId {
  const h = (headerText ?? '').toLowerCase().replace(/[µμ]/g, 'u');
  const m = /(?:\(|\[|_|\s|^)(ns|us|ms|s|sec|seconds?)(?:\)|\]|$|\s)/.exec(h);
  if (!m) return 's';
  const u = m[1]!;
  return u === 'ns' ? 'ns' : u === 'us' ? 'us' : u === 'ms' ? 'ms' : 's';
}

/** Reduce to at most `maxPoints` points, keeping each stretch's minimum and maximum (peaks survive). */
export function decimateMinMax(t: number[], y: number[], maxPoints: number): { t: number[]; y: number[]; decimated: boolean } {
  const n = t.length;
  if (n <= maxPoints) return { t, y, decimated: false };
  const buckets = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const size = n / buckets;
  const ot: number[] = [t[0]!];
  const oy: number[] = [y[0]!];
  for (let b = 0; b < buckets; b++) {
    const lo = Math.max(1, Math.floor(b * size));
    const hi = Math.min(n - 1, Math.floor((b + 1) * size));
    if (hi <= lo) continue;
    let imin = lo;
    let imax = lo;
    for (let i = lo; i < hi; i++) {
      if (y[i]! < y[imin]!) imin = i;
      if (y[i]! > y[imax]!) imax = i;
    }
    const [i1, i2] = imin <= imax ? [imin, imax] : [imax, imin];
    ot.push(t[i1]!);
    oy.push(y[i1]!);
    if (i2 !== i1) (ot.push(t[i2]!), oy.push(y[i2]!));
  }
  ot.push(t[n - 1]!);
  oy.push(y[n - 1]!);
  return { t: ot, y: oy, decimated: true };
}
