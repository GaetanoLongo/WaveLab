import { describe, expect, it } from 'vitest';
import { decimateMinMax, guessTimeColumn, guessTimeUnit, parseCsv, type CsvTable } from './csv';

const ok = (r: CsvTable | string): CsvTable => {
  if (typeof r === 'string') throw new Error(r);
  return r;
};

describe('parseCsv', () => {
  it('comma separated with a header', () => {
    const t = ok(parseCsv('Time (ms),CH1 (V),CH2\n0,1.5,2\n1,1.6,2.1\n2,1.7,2.2\n'));
    expect(t.header).toEqual(['Time (ms)', 'CH1 (V)', 'CH2']);
    expect(t.delimiter).toBe(',');
    expect(t.rows).toEqual([[0, 1.5, 2], [1, 1.6, 2.1], [2, 1.7, 2.2]]);
    expect(guessTimeColumn(t)).toBe(0);
  });
  it('no header, tab separated, CRLF and a BOM', () => {
    const t = ok(parseCsv('﻿0\t1e-3\r\n1e-6\t2.5E-3\r\n2e-6\t-3\r\n'));
    expect(t.header).toBeNull();
    expect(t.delimiter).toBe('\t');
    expect(t.rows[1]).toEqual([1e-6, 2.5e-3]);
  });
  it('semicolon with decimal commas; spaces; comment lines; trailing delimiters', () => {
    expect(ok(parseCsv('t;v\n0,5;1,25\n1,5;2,5\n')).rows).toEqual([[0.5, 1.25], [1.5, 2.5]]);
    expect(ok(parseCsv('# scope export\n0   1\n1   2\n2   3\n')).rows.length).toBe(3);
    expect(ok(parseCsv('t,v,\n0,1,\n1,2,\n')).columns).toBe(2);
  });
  it('quoted headers; a single column; bad lines are counted, not hidden', () => {
    expect(ok(parseCsv('"Time","Volts"\n0,1\n1,2\n')).header).toEqual(['Time', 'Volts']);
    const one = ok(parseCsv('1\n2\n3\n4\n'));
    expect(one.columns).toBe(1);
    expect(one.rows.length).toBe(4);
    const messy = ok(parseCsv('t,v\n0,1\nbad,line\n1,2\n2\n3,4\n'));
    expect(messy.rows.length).toBe(3);
    expect(messy.skipped).toBe(2);
  });
  it('explains what cannot be used', () => {
    expect(parseCsv('')).toMatch(/two lines/);
    expect(parseCsv('a,b\nc,d\ne,f\n')).toMatch(/Fewer than two rows/);
    expect(parseCsv('x'.repeat(61_000_000))).toMatch(/60 MB/);
  });
  it('rejects numbers that are not numbers (NaN, inf, 1e, 0x10, thousands separators)', () => {
    expect(parseCsv('t,v\nNaN,1\ninf,2\n1e,3\n0x10,4\n')).toMatch(/Fewer than two rows/);
  });
});

describe('time axis and units', () => {
  it('finds the first strictly increasing column; none for noise', () => {
    const t = ok(parseCsv('v,t\n5,0\n3,1\n9,2\n'));
    expect(guessTimeColumn(t)).toBe(1);
    expect(guessTimeColumn(ok(parseCsv('a,b\n1,5\n1,3\n1,9\n')))).toBeNull();
  });
  it('reads the unit from the header', () => {
    expect(guessTimeUnit('Time (ms)')).toBe('ms');
    expect(guessTimeUnit('t [µs]')).toBe('us');
    expect(guessTimeUnit('time_ns')).toBe('ns');
    expect(guessTimeUnit('Time (s)')).toBe('s');
    expect(guessTimeUnit('Seconds')).toBe('s');
    expect(guessTimeUnit('Voltage')).toBe('s');
    expect(guessTimeUnit(undefined)).toBe('s');
  });
});

describe('decimateMinMax', () => {
  it('keeps the peaks, the ends and the order', () => {
    const n = 100000;
    const t = Array.from({ length: n }, (_, i) => i);
    const y = t.map((i) => Math.sin(i / 500));
    y[54321] = 7; // a one-sample spike must survive
    y[12345] = -9;
    const d = decimateMinMax(t, y, 2000);
    expect(d.decimated).toBe(true);
    expect(d.t.length).toBeLessThanOrEqual(2000);
    expect(Math.max(...d.y)).toBe(7);
    expect(Math.min(...d.y)).toBe(-9);
    expect(d.t[0]).toBe(0);
    expect(d.t[d.t.length - 1]).toBe(n - 1);
    for (let i = 1; i < d.t.length; i++) expect(d.t[i]!).toBeGreaterThanOrEqual(d.t[i - 1]!);
  });
  it('leaves small data alone', () => {
    const d = decimateMinMax([0, 1, 2], [5, 6, 7], 10);
    expect(d.decimated).toBe(false);
    expect(d.y).toEqual([5, 6, 7]);
  });
});
