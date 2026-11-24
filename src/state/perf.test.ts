/**
 * Performance regressions and the caches that fix them: each test states the cost that used to be
 * paid, checks it is gone, and checks that the cached answer is the same as a fresh computation.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseExpr } from '../core/expr/parse';
import { defaultGenerator } from '../core/model/defaults';
import type { DerivedSignalDef } from '../core/model/project';
import { buildFigure, resolveTheme, type TraceInput } from '../core/plot/layout';
import { rangeOf } from '../core/plot/range';
import { sampleSignal, sampleSignalCached } from '../core/plot/sampler';
import { sceneToSvg } from '../core/plot/svg';
import { autoYRange } from '../core/plot/viewport';
import { BudgetExceeded, guardSignal, setComputeBudget } from '../core/signals/budget';
import { eyeScene } from '../core/plot/views';
import { compileDerived } from '../core/signals/derived';
import { compileGenerator } from '../core/signals/generator';
import type { FeatureQuery, SignalEval } from '../core/signals/types';
import { compiled } from './compiled';
import { actions, commit, editor } from './store';

beforeEach(() => actions.newProject());

const time = (f: () => void) => {
  const t = performance.now();
  f();
  return performance.now() - t;
};

function derivedDef(id: string, expr: string): DerivedSignalDef {
  return {
    id,
    name: id,
    unit: 'V',
    locked: false,
    style: { color: '#000000', lineWidth: 1, dash: 'solid', visible: true, showInLegend: true },
    kind: 'derived',
    expr,
    logicHigh: 1,
    logicLow: 0,
    threshold: 0.5,
    resolution: null,
  };
}

function expr(src: string, inputs: Record<string, SignalEval>): SignalEval {
  const map = new Map(Object.entries(inputs));
  const root = parseExpr(src, (n) => (map.has(n) ? n : null));
  return compileDerived({ root, logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, map);
}

describe('compile cache', () => {
  it('expressions that share inputs are resolved once per project version, not once per path', () => {
    // f_k = f_{k-1} + f_{k-2}: the number of paths from the last signal to the first doubles per layer
    // (30 layers ≈ 10⁶ paths). Each lookup used to walk all of them (0.13 s at 24 layers, on every redraw).
    const ids = [actions.addSignal('sine'), actions.addSignal('square')];
    for (let i = 0; i < 30; i++) {
      const id = `f${i}`;
      const e = `#{${ids[ids.length - 1]}} + #{${ids[ids.length - 2]}}`;
      commit((d) => void d.signals.push(derivedDef(id, e)));
      ids.push(id);
    }
    const p = editor.getState().project;
    const last = p.signals[p.signals.length - 1]!;
    let ev!: SignalEval;
    expect(time(() => (ev = compiled(last, p)))).toBeLessThan(500);
    expect(time(() => p.signals.forEach((s) => compiled(s, p)))).toBeLessThan(50);
    expect(compiled(last, p)).toBe(ev);
    // The last signal is a Fibonacci-weighted sum of the two generators: check one value.
    const sine = compiled(p.signals[0]!, p);
    const sq = compiled(p.signals[1]!, p);
    let wa = [1, 0]; // [weight of sine, weight of square] of the element before last
    let wb = [0, 1]; // … of the last element
    for (let i = 0; i < 30; i++) [wa, wb] = [wb, [wa[0]! + wb[0]!, wa[1]! + wb[1]!]];
    const t = 0.0031;
    expect(ev.value(t)).toBeCloseTo(wb[0]! * sine.value(t) + wb[1]! * sq.value(t), 6);
  });

  it('still recompiles exactly the signals that depend on an edited input', () => {
    const a = actions.addSignal('sine');
    const b = actions.addSignal('square');
    commit((d) => void d.signals.push(derivedDef('sum', `#{${a}} + #{${b}}`), derivedDef('only-b', `2 * #{${b}}`)));
    const p1 = editor.getState().project;
    const sum1 = compiled(p1.signals.find((s) => s.id === 'sum')!, p1);
    const onlyB1 = compiled(p1.signals.find((s) => s.id === 'only-b')!, p1);
    actions.updateGenerator(a, (s) => void (s.generator === 'sine' && (s.params.amplitude = 3)));
    const p2 = editor.getState().project;
    const sum2 = compiled(p2.signals.find((s) => s.id === 'sum')!, p2);
    expect(sum2).not.toBe(sum1);
    expect(compiled(p2.signals.find((s) => s.id === 'only-b')!, p2)).toBe(onlyB1);
    expect(sum2.value(0.005)).toBeCloseTo(3 + 1, 9);
    // Undo returns the previous objects.
    actions.undo();
    const p3 = editor.getState().project;
    expect(compiled(p3.signals.find((s) => s.id === 'sum')!, p3)).toBe(sum1);
  });

  it('a project edited in place (not through Immer) is not answered from a stale index', () => {
    const a = actions.addSignal('sine');
    const p = structuredClone(editor.getState().project);
    const d = derivedDef('late', `#{${a}} * 2`);
    const first = compiled(p.signals[0]!, p);
    p.signals.push(d);
    expect(compiled(d, p).value(0.005)).toBeCloseTo(2 * first.value(0.005), 12);
  });
});

describe('operators on many periods', () => {
  const sine1k = compileGenerator(Object.assign(defaultGenerator('sine'), { timing: { frequency: 1000, phaseDeg: 0, delay: 0 } }));

  it('integral(), abs() and squares merge their zero crossings in linear time', () => {
    // 10 000 periods: the merge searched the whole feature list once per crossing (3 s for integral()).
    for (const src of ['integral(x, 0, 0)', 'abs(x)', 'rms(x, 1m)']) {
      const ev = expr(src, { x: sine1k });
      let q!: FeatureQuery;
      const ms = time(() => (q = ev.features(0, 10, 200_000)));
      expect(ms, src).toBeLessThan(1500);
      expect(q.truncated, src).toBe(false);
      expect(q.features.length, src).toBeGreaterThanOrEqual(19_999);
      for (let i = 1; i < q.features.length; i++) expect(q.features[i]!.t >= q.features[i - 1]!.t).toBe(true);
    }
    // The extrema of the integral (1 − cos ωt)/ω are where the sine crosses zero: every 0.5 ms.
    const I = expr('integral(x, 0, 0)', { x: sine1k });
    const ext = I.features(0, 0.002).features.filter((f) => f.kind === 'max' || f.kind === 'min');
    expect(ext.map((f) => f.kind)).toEqual(['min', 'max', 'min', 'max', 'min']);
    ext.forEach((f, i) => expect(f.t).toBeCloseTo(i * 0.0005, 12));
  });

  it('operators nested inside one expression get the per-period cache of separate signals', () => {
    const sq = compileGenerator(defaultGenerator('square'));
    const src = 'movavg(lowpass(movavg(lowpass(abs(x), 1m), 2m), 1m), 2m)';
    const nested = expr(src, { x: sq });
    nested.features(0, 0.04, 400); // warm the per-period tables
    // Panning asks for a shifted window: answered from one period instead of re-deriving every layer
    // (≈ 0.27 s per redraw before).
    expect(time(() => sampleSignal(nested, 0.0013, 0.0413, 800))).toBeLessThan(150);
    // Same answers as the layers built as separate signals.
    const l1 = expr('lowpass(abs(x), 1m)', { x: sq });
    const l2 = expr('movavg(x, 2m)', { x: l1 });
    const l3 = expr('lowpass(x, 1m)', { x: l2 });
    const l4 = expr('movavg(x, 2m)', { x: l3 });
    for (const t of [0.0007, 0.0101, 0.0333, 1.2345]) expect(nested.value(t)).toBeCloseTo(l4.value(t), 9);
    const fa = nested.features(0.1, 0.14).features;
    const fb = l4.features(0.1, 0.14).features;
    expect(fa.length).toBe(fb.length);
    fa.forEach((f, i) => expect(f.t).toBeCloseTo(fb[i]!.t, 9));
  });
});

describe('redraw caches', () => {
  it('a redraw with the same time window reuses the samples and the path text, and draws the same figure', () => {
    const kinds = ['sine', 'square', 'triangle', 'pulse', 'sawtooth'] as const;
    for (let i = 0; i < 40; i++) actions.addSignal(kinds[i % 5]!);
    const p = editor.getState().project;
    const traces: TraceInput[] = p.signals.map((s) => ({ id: s.id, name: s.name, signal: compiled(s, p), color: s.style.color, lineWidth: 1.6, dash: 'solid', unit: 'V' }));
    const input = (sel: string | null) => ({
      width: 1000,
      height: 700,
      panels: [{ id: 'g', yRange: null, traces: traces.map((t) => ({ ...t, highlight: t.id === sel })) }],
      xRange: [0, 0.04] as const,
      xTitle: 'Time',
      showLegend: true,
      theme: resolveTheme(undefined, {}),
    });
    const first = sceneToSvg(buildFigure(input(null)).scene);
    const again = sceneToSvg(buildFigure(input(null)).scene);
    expect(again).toBe(first);
    const selected = sceneToSvg(buildFigure(input(traces[3]!.id)).scene);
    expect(selected).not.toBe(first);
    expect(selected.length).toBeGreaterThan(first.length); // the highlight adds a path
    // Same text as a figure built from fresh (uncached) signals.
    const fresh = p.signals.map((s) => compileGenerator(s.kind === 'generator' ? s : (null as never)));
    const freshInput = input(null);
    freshInput.panels[0]!.traces = freshInput.panels[0]!.traces.map((t, i) => ({ ...t, signal: fresh[i]! }));
    expect(sceneToSvg(buildFigure(freshInput).scene)).toBe(first);
  });

  it('cached samples equal fresh ones, per window and resolution', () => {
    const s = compileGenerator(defaultGenerator('triangle'));
    for (const [a, b, n] of [[0, 0.04, 800], [0.001, 0.041, 800], [0, 0.04, 400], [0, 0.04, 800]] as const) {
      expect(sampleSignalCached(s, a, b, n)).toEqual(sampleSignal(s, a, b, n));
    }
    expect(sampleSignalCached(s, 0, 0.04, 800)).toBe(sampleSignalCached(s, 0, 0.04, 800));
  });
});

describe('caches never keep an abandoned answer', () => {
  afterEach(() => vi.useRealTimers());

  it('range, automatic range and samples are computed again once a signal is no longer marked heavy', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const base = compileGenerator(defaultGenerator('sine'));
    let overrun = true;
    // Behaves like a signal whose first evaluation runs over the compute budget.
    const slow: SignalEval = {
      ...base,
      value: (t) => base.value(t),
      features: (a, b, m) => {
        if (overrun) {
          overrun = false;
          throw new BudgetExceeded();
        }
        return base.features(a, b, m);
      },
    };
    const check = (label: string, fresh: () => SignalEval, run: (s: SignalEval) => unknown, good: (r: unknown) => boolean) => {
      overrun = true;
      const s = guardSignal(fresh());
      const r1 = run(s); // abandoned: placeholder answer, signal marked heavy for 15 s
      expect(good(r1), `${label}: placeholder`).toBe(false);
      vi.advanceTimersByTime(16_000);
      expect(good(run(s)), `${label}: after the heavy mark expired`).toBe(true);
    };
    const isSineRange = (r: unknown) => Array.isArray(r) && Math.abs((r as number[])[1]! - 1) < 1e-9;
    check('rangeOf', () => ({ ...slow }), (s) => rangeOf(s, 0, 1), isSineRange);
    // Sine ±1 with 8 % padding of the span: [−1.16, 1.16] (the placeholder is [−1, 1]).
    check('autoYRange', () => ({ ...slow }), (s) => autoYRange([s]), (r) => Array.isArray(r) && Math.abs((r as number[])[1]! - 1.16) < 1e-9);
    check('samples', () => ({ ...slow }), (s) => sampleSignalCached(s, 0, 0.04, 200), (r) => (r as { lines: unknown[] }).lines.length > 0);
  });
});

describe('views within the compute budget', () => {
  it('an eye diagram of 2000 long windows of a heavy signal is abandoned within the budget, not left to block the page', () => {
    // A 2 ms moving average of a square, folded 2000 times over 2000 s windows: ≈ 9 s of blocked page before.
    actions.addSignal('square');
    const avg = actions.addDerived((a) => `movavg(${a}, 2m)`, 1, 'Avg')!;
    const p = editor.getState().project;
    const sig = compiled(p.signals.find((s) => s.id === avg)!, p);
    const prev = setComputeBudget(3000);
    try {
      const t0 = performance.now();
      const r = eyeScene({ signal: sig, name: 'Avg', unit: 'V', ui: 2000, t0: 0, traces: 2000, width: 640, height: 460, theme: resolveTheme(undefined, {}), color: '#000' });
      expect(performance.now() - t0).toBeLessThan(7000);
      expect(Number.isNaN(r.height)).toBe(true); // abandoned: drawn without traces, eye "closed / undefined"
    } finally {
      setComputeBudget(prev);
    }
  }, 30000);

  it('an ordinary eye diagram is unaffected', () => {
    const sq = compileGenerator(defaultGenerator('square'));
    const r = eyeScene({ signal: sq, name: 'Sq', unit: 'V', ui: 0.01, t0: 0, traces: 50, width: 640, height: 460, theme: resolveTheme(undefined, {}), color: '#000' });
    expect(r.height).toBeCloseTo(2, 9);
  });
});

