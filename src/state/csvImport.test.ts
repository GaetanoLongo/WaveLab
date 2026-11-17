import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv, type CsvTable } from '../core/io/csv';
import { compiled } from './compiled';
import { MAX_IMPORT_POINTS, type CsvImportConfig } from './csvImport';
import { actions, editor } from './store';

beforeEach(() => actions.newProject());
const table = (text: string): CsvTable => {
  const t = parseCsv(text);
  if (typeof t === 'string') throw new Error(t);
  return t;
};
const cfg = (patch: Partial<CsvImportConfig> = {}): CsvImportConfig => ({ timeColumn: 0, timeUnit: 's', sampleInterval: 1e-3, startAtZero: false, columns: [1], interp: 'linear', unit: 'V', fileName: 'scope.csv', ...patch });
const sig = (name: string) => {
  const p = editor.getState().project;
  return compiled(p.signals.find((s) => s.name === name)!, p);
};

describe('CSV import', () => {
  it('creates one editable signal per chosen column, scaled to seconds, interpolated linearly', () => {
    const t = table('Time (ms),CH1,CH2\n0,0,10\n1,2,20\n2,4,30\n');
    expect(actions.createCsvImport(t, cfg({ timeUnit: 'ms', columns: [1, 2] }))).toBeNull();
    const p = editor.getState().project;
    expect(p.signals.map((s) => s.name)).toEqual(['CH1', 'CH2']);
    expect(p.signals.every((s) => s.kind === 'generator' && s.generator === 'piecewise')).toBe(true);
    expect(sig('CH1').value(0.0005)).toBeCloseTo(1, 12); // halfway between 0 and 2 V at 0.5 ms
    expect(sig('CH2').value(0.002)).toBeCloseTo(30, 12);
    expect(p.figures[0]!.panels.some((g) => g.name === 'Data · scope')).toBe(true);
    expect(editor.getState().view.xRange[1]).toBeCloseTo(0.002 * 1.02, 9);
  });

  it('start at zero, steps, and evenly spaced samples without a time column', () => {
    const t = table('v\n5\n6\n7\n8\n');
    expect(actions.createCsvImport(t, cfg({ timeColumn: null, columns: [0], sampleInterval: 1e-3, interp: 'step' }))).toBeNull();
    expect(sig('v').value(0.0015)).toBe(6); // held until the next sample
    actions.newProject();
    const t2 = table('t,v\n10,1\n11,2\n12,3\n');
    expect(actions.createCsvImport(t2, cfg({ startAtZero: true }))).toBeNull();
    expect(sig('v').value(1)).toBe(2); // t = 11 became t = 1
  });

  it('refuses unusable choices with a clear message and creates nothing', () => {
    const t = table('t,v\n0,1\n2,2\n1,3\n');
    expect(actions.createCsvImport(t, cfg())).toMatch(/must increase strictly \(row 3/);
    expect(actions.createCsvImport(table('t,v\n0,1\n1,2\n'), cfg({ columns: [] }))).toMatch(/at least one column/);
    expect(actions.createCsvImport(table('v\n1\n2\n'), cfg({ timeColumn: null, columns: [0], sampleInterval: 0 }))).toMatch(/greater than 0/);
    expect(editor.getState().project.signals.length).toBe(0);
  });

  it('names are made safe for expressions (no brackets), and one undo step removes the import', () => {
    expect(actions.createCsvImport(table('t,v[1]\n0,1\n1,2\n'), cfg())).toBeNull();
    expect(editor.getState().project.signals[0]!.name).not.toMatch(/[[\]]/);
    actions.undo();
    expect(editor.getState().project.signals.length).toBe(0);
  });

  it('large files are reduced to a drawable size without losing a spike', () => {
    const n = 400_000;
    const rows = ['t,v'];
    for (let i = 0; i < n; i++) rows.push(`${i * 1e-6},${i === 123456 ? 50 : Math.sin(i / 1000)}`);
    const t = table(rows.join('\n'));
    expect(actions.createCsvImport(t, cfg())).toBeNull();
    const s = editor.getState().project.signals[0]!;
    expect(s.kind === 'generator' && s.generator === 'piecewise' && s.params.points.length).toBeLessThanOrEqual(MAX_IMPORT_POINTS);
    const f = sig('v');
    const t0 = performance.now();
    const q = f.features(0.12, 0.13);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(Math.max(...q.features.map((x) => x.left), ...q.features.map((x) => x.right))).toBe(50);
  }, 60000);
});
