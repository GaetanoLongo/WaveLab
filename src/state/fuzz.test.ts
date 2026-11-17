/**
 * Fuzz tests: random expressions and mutated project files must never throw an unexpected error,
 * hang, or break the save/load round trip. Deterministic (seeded) so failures are reproducible.
 */

import { describe, expect, it } from 'vitest';
import { ExprError, FUNCTIONS, parseExpr } from '../core/expr/parse';
import { defaultGenerator } from '../core/model/defaults';
import type { GeneratorDef, GeneratorKind } from '../core/model/signal-defs';
import { parseProjectFile, ProjectFileError, serializeProject } from '../core/io/project-file';
import { sampleSignal } from '../core/plot/sampler';
import { compileDerived } from '../core/signals/derived';
import { compileGenerator } from '../core/signals/generator';
import type { SignalEval } from '../core/signals/types';
import { compiled } from './compiled';
import { DEFAULT_MODULATION } from './modulation';
import { DEFAULT_PROTOCOL } from './protocols';
import { DEFAULT_PWM } from './pwm';
import { actions, editor } from './store';

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(a: readonly T[]): T => a[Math.floor(next() * a.length)]! };
}

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}): SignalEval => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};

describe('expression fuzz', () => {
  const R = rng(20260117);
  const names = ['A', 'B', 'C', 'D'];
  const inputs = new Map<string, SignalEval>([
    ['A', gen('sine')],
    ['B', gen('square', (d) => (d.timing.frequency = 130))],
    ['C', gen('triangle', (d) => (d.timing.frequency = 1050))],
    ['D', gen('pulse')],
  ]);
  const fnNames = Object.keys(FUNCTIONS);
  const constants = ['1', '0', '0.5', '2', '1m', '1u', '100', '1e-9', '50', '0.707', '5m', '-1', '1e6'];
  const ops = ['+', '-', '*', '/', '>', '<', '>=', '<=', '&&', '||', '^'];

  const atom = (): string => (R.next() < 0.7 ? R.pick(names) : R.pick(constants));
  const expr = (depth: number): string => {
    if (depth <= 0 || R.next() < 0.25) return atom();
    const roll = R.next();
    if (roll < 0.35) return `(${expr(depth - 1)} ${R.pick(ops)} ${expr(depth - 1)})`;
    if (roll < 0.42) return `-${expr(depth - 1)}`;
    if (roll < 0.47) return `!${expr(depth - 1)}`;
    const fn = R.pick(fnNames);
    const spec = FUNCTIONS[fn]!;
    const n = spec.min + R.int(Math.min(spec.max, spec.min + 1) - spec.min + 1);
    const args: string[] = [];
    for (let i = 0; i < n; i++) args.push(spec.constFrom !== undefined && i >= spec.constFrom ? R.pick(constants) : expr(depth - 1));
    return `${fn}(${args.join(', ')})`;
  };

  it('random expressions compile and evaluate without unexpected errors or long stalls', () => {
    const slow: string[] = [];
    const broken: string[] = [];
    for (let i = 0; i < 160; i++) {
      const src = expr(3);
      let root;
      try {
        root = parseExpr(src, (n) => (inputs.has(n) ? n : null));
      } catch (e) {
        if (!(e instanceof ExprError)) broken.push(`${src}: parse threw ${String(e)}`);
        continue;
      }
      const t0 = performance.now();
      try {
        const s = compileDerived({ root, logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, inputs);
        for (const t of [0, 1e-4, 0.0123, 0.5, -0.01]) s.value(t);
        // As the app asks: the drawing and the automatic range cap the number of features they want.
        for (const [a, b] of [[0, 0.04], [0.001, 0.0012], [0, 1]] as const) s.features(a, b, 400);
        s.features(0, 0.04); // and the measurements want all of a short window
        sampleSignal(s, 0, 0.04, 400);
      } catch (e) {
        broken.push(`${src}: ${String(e)}`);
      }
      const dt = performance.now() - t0;
      // Known: arguments at the allowed extremes (1e6 s windows, 1 s over a 1 kHz signal) cost 3-10 s.
      // This guards against real hangs, not against those.
      if (dt > 15000) slow.push(`${src}: ${dt.toFixed(0)} ms`);
    }
    expect(broken).toEqual([]);
    expect(slow).toEqual([]);
  }, 240000);
});

describe('builders keep the project consistent', () => {
  it('every generated project has each signal in at most one group per figure, and no dangling traces', () => {
    const problems: string[] = [];
    const check = (label: string) => {
      const p = editor.getState().project;
      const ids = new Set(p.signals.map((x) => x.id));
      for (const f of p.figures) {
        const seen = new Set<string>();
        for (const g of f.panels) for (const t of g.traces) {
          if (!ids.has(t.signalId)) problems.push(`${label}: dangling trace in "${g.name}"`);
          if (seen.has(t.signalId)) problems.push(`${label}: signal listed twice (group "${g.name}")`);
          seen.add(t.signalId);
        }
      }
    };
    for (const topology of ['half', 'full-bipolar', 'full-unipolar', 'three-phase'] as const)
      for (const reference of topology === 'three-phase' ? (['sine', 'third', 'svpwm', 'dpwm'] as const) : (['sine'] as const))
        for (const [load, deadTime, complementary] of [[false, 0, true], [true, 0, true], [true, 2e-6, true], [false, 2e-6, true], [true, 2e-6, false]] as const) {
          actions.newProject();
          actions.createPwm({ ...DEFAULT_PWM, topology, reference, load, deadTime, complementary });
          check(`PWM ${topology}/${reference}/load=${load}/dead=${deadTime}/compl=${complementary}`);
        }
    for (const kind of ['am', 'dsb', 'fm', 'pm'] as const) {
      actions.newProject();
      actions.createModulation({ ...DEFAULT_MODULATION, kind });
      check(`modulation ${kind}`);
    }
    for (const protocol of ['uart', 'spi', 'i2c'] as const) {
      actions.newProject();
      actions.createProtocol({ ...DEFAULT_PROTOCOL, protocol });
      check(`protocol ${protocol}`);
    }
    expect(problems).toEqual([]);
  }, 120000);
});

describe('project file fuzz', () => {
  function sampleProject(): string {
    actions.newProject();
    actions.createPwm({ ...DEFAULT_PWM, topology: 'three-phase', reference: 'svpwm', load: true });
    actions.createModulation({ ...DEFAULT_MODULATION });
    actions.createProtocol({ ...DEFAULT_PROTOCOL });
    actions.addFigure();
    return serializeProject(editor.getState().project);
  }

  it('save → load → save is stable', () => {
    const text = sampleProject();
    const again = serializeProject(parseProjectFile(text).project);
    const strip = (t: string) => {
      const o = JSON.parse(t) as { savedAt?: string };
      delete o.savedAt; // the only field that legitimately differs
      return o;
    };
    expect(strip(again)).toEqual(strip(text));
  });

  it('mutated files are either rejected with a clear error or load into a project that can be evaluated', () => {
    const base = JSON.parse(sampleProject()) as unknown;
    const R = rng(777);
    const paths = (v: unknown, p: Array<string | number> = [], out: Array<Array<string | number>> = []) => {
      if (v && typeof v === 'object') {
        out.push(p);
        for (const [k, c] of Object.entries(v as Record<string, unknown>)) paths(c, [...p, Array.isArray(v) ? Number(k) : k], out);
      } else out.push(p);
      return out;
    };
    const all = paths(base);
    const values: unknown[] = [null, 'x', '', -1, 0, 1e308, -1e308, 1e-300, 0.5, [], {}, true, 'NaN', 1e15, 3];
    const unexpected: string[] = [];
    let loaded = 0;
    let rejected = 0;
    const slow: string[] = [];
    for (let i = 0; i < 400; i++) {
      const doc = structuredClone(base) as Record<string, unknown>;
      const nMut = 1 + R.int(3);
      const desc: string[] = [];
      for (let m = 0; m < nMut; m++) {
        const path = R.pick(all);
        if (path.length === 0) continue;
        let parent: any = doc;
        for (const k of path.slice(0, -1)) parent = parent?.[k];
        const key = path[path.length - 1]!;
        if (parent === undefined || parent === null || typeof parent !== 'object') continue;
        if (R.next() < 0.25) {
          if (Array.isArray(parent)) parent.splice(Number(key), 1);
          else delete parent[key as string];
          desc.push(`delete ${path.join('.')}`);
        } else {
          const v = R.pick(values);
          parent[key] = v;
          desc.push(`${path.join('.')} = ${JSON.stringify(v)}`);
        }
      }
      let project;
      try {
        project = parseProjectFile(JSON.stringify(doc)).project;
        loaded++;
      } catch (e) {
        if (e instanceof ProjectFileError) rejected++;
        else unexpected.push(`${desc.join('; ')} → parse threw ${String(e)}`);
        continue;
      }
      const t0 = performance.now();
      try {
        for (const s of project.signals) {
          const f = compiled(s, project);
          f.value(0.003);
          f.features(0, 0.01);
        }
      } catch (e) {
        unexpected.push(`${desc.join('; ')} → evaluation threw ${String(e)}`);
      }
      const dt = performance.now() - t0;
      if (dt > 4000) slow.push(`${desc.join('; ')} → ${dt.toFixed(0)} ms`);
    }
    expect(unexpected).toEqual([]);
    expect(slow).toEqual([]);
    expect(loaded + rejected).toBeGreaterThan(300);
  }, 280000);
});

describe('CSV import fuzz', () => {
  it('random text never throws in the parser or the import; usable tables import into valid projects', async () => {
    const { parseCsv, guessTimeColumn } = await import('../core/io/csv');
    const R = rng(4242);
    const pieces = ['0', '1', '-1', '1e-3', '2.5E+2', '1,5', '', ' ', '\t', ';', ',', 'abc', 'NaN', 'inf', '"x"', '#c', '1e999', '0x10', '--', '.5', '5.', '\r', '\n', '\n', '\n', '  ', 'Time (ms)', 'V'];
    const unexpected: string[] = [];
    let usable = 0;
    for (let i = 0; i < 400; i++) {
      let text = '';
      const n = R.int(60);
      for (let k = 0; k < n; k++) text += R.pick(pieces);
      try {
        const t = parseCsv(text);
        if (typeof t === 'string') continue;
        usable++;
        const tc = guessTimeColumn(t);
        actions.newProject();
        const cols = Array.from({ length: t.columns }, (_, c) => c).filter((c) => c !== tc);
        const err = actions.createCsvImport(t, { timeColumn: tc, timeUnit: R.pick(['s', 'ms', 'us', 'ns'] as const), sampleInterval: R.pick([1e-3, 0, -1, 1e-9]), startAtZero: R.next() < 0.5, columns: cols.length ? cols : [0], interp: R.pick(['linear', 'step'] as const), unit: 'V', fileName: 'f.csv' });
        if (err === null) {
          const p = editor.getState().project;
          for (const s of p.signals) {
            const f = compiled(s, p);
            f.value(0);
            f.features(-1, 10, 400);
          }
          // an imported project must also survive save / load
          parseProjectFile(serializeProject(p));
        }
      } catch (e) {
        unexpected.push(`${JSON.stringify(text).slice(0, 80)} → ${String(e)}`);
      }
    }
    expect(unexpected).toEqual([]);
    expect(usable).toBeGreaterThan(5);
  }, 120000);
});

describe('share link fuzz', () => {
  it('projects built by the generators survive encode → decode → parse unchanged', async () => {
    const { encodeShare, decodeShare } = await import('../core/io/share');
    const R = rng(99);
    const kinds: GeneratorKind[] = ['sine', 'square', 'pulse', 'triangle', 'chirp', 'noise', 'prbs', 'bits', 'piecewise'];
    for (let i = 0; i < 25; i++) {
      actions.newProject();
      for (let k = 0; k < 1 + R.int(8); k++) actions.addSignal(R.pick(kinds));
      if (R.next() < 0.5) actions.createPwm({ ...DEFAULT_PWM, topology: R.pick(['half', 'three-phase'] as const) });
      const text = serializeProject(editor.getState().project);
      const back = await decodeShare(await encodeShare(text));
      expect(JSON.parse(back)).toEqual(JSON.parse(text));
      expect(parseProjectFile(back).project.signals.length).toBe(editor.getState().project.signals.length);
    }
  }, 120000);
});
