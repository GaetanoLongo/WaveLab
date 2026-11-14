import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileGenerator } from '../signals/generator';
import {
  buildFigure,
  LIGHT_TECHNICAL,
  panelsForMode,
  pxToT,
  tToPx,
  type TraceInput,
} from './layout';
import { rangeOf } from './range';
import { sampleSignal } from './sampler';
import { niceTicks } from './ticks';
import { autoYRange, fitTimeRange, panRange, zoomRange } from './viewport';

function gen(kind: GeneratorDef['generator'], frequency = 50): ReturnType<typeof compileGenerator> {
  const d = defaultGenerator(kind);
  d.timing.frequency = frequency;
  return compileGenerator(d);
}

function trace(id: string, kind: GeneratorDef['generator'], f: number): TraceInput {
  return { id, name: id, signal: gen(kind, f), color: '#000', lineWidth: 1.5, dash: 'solid', unit: 'V' };
}

describe('niceTicks', () => {
  it('uses 1-2-5 steps and SI-prefixed labels', () => {
    const t = niceTicks(0, 0.04, 8, 's', 1);
    expect(t.step).toBeCloseTo(0.005, 15);
    expect(t.labels).toEqual(['0', '5', '10', '15', '20', '25', '30', '35', '40']);
    expect(t.unitLabel).toBe('ms');
  });

  it('never uses a prefix above the cap (no "ks" for time)', () => {
    expect(niceTicks(0, 5000, 5, 's', 1).unitLabel).toBe('s');
    expect(niceTicks(0, 5000, 5, 'V').unitLabel).toBe('kV');
  });

  it('always gives at least 3 labelled ticks, even in small panels', () => {
    const t = niceTicks(-351, 351, 3, 'V');
    expect(t.major.length).toBeGreaterThanOrEqual(3);
    expect(t.labels).toEqual(['-200', '0', '200']);
  });

  it('handles symmetric ranges without "-0"', () => {
    const t = niceTicks(-400, 400, 8, 'V');
    expect(t.labels).toContain('0');
    expect(t.labels).not.toContain('-0');
  });
});

describe('rangeOf (exact min/max)', () => {
  it('finds sine peaks without sampling', () => {
    const s = gen('sine');
    expect(rangeOf(s, 0, 0.02)).toEqual([-1, 1]);
    const r = rangeOf(s, 0, 0.004)!;
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(Math.sin(2 * Math.PI * 0.2), 12);
  });

  it('catches a narrow pulse inside a wide interval', () => {
    const d = defaultGenerator('pulse');
    if (d.generator === 'pulse') d.params.width = 1e-9;
    d.window = { mode: 'cycles', start: 0.3, cycles: 1, outside: 'zero' };
    expect(rangeOf(compileGenerator(d), 0, 1)).toEqual([0, 1]);
  });
});

describe('sampler', () => {
  it('draws exact vertical edges for a square wave', () => {
    const s = gen('square');
    const { mode, lines } = sampleSignal(s, 0, 0.04, 800);
    expect(mode).toBe('exact');
    expect(lines).toHaveLength(1);
    const { t, y } = lines[0]!;
    // Find the falling edge at 10 ms: two consecutive points at the same t.
    const i = t.findIndex((v, k) => k > 0 && Math.abs(v - 0.01) < 1e-15 && t[k - 1] === v);
    expect(i).toBeGreaterThan(0);
    expect(y[i - 1]).toBe(1);
    expect(y[i]).toBe(-1);
  });

  it('keeps edges vertical at extreme zoom around a transition', () => {
    const s = gen('square');
    const { lines } = sampleSignal(s, 0.01 - 1e-12, 0.01 + 1e-12, 800);
    const { t, y } = lines[0]!;
    // Only flat segments and one vertical jump: no intermediate values.
    expect(new Set(y)).toEqual(new Set([1, -1]));
    const jumpIdx = y.indexOf(-1);
    expect(t[jumpIdx]).toBe(t[jumpIdx - 1]);
  });

  it('switches to an exact min/max envelope for very high frequencies', () => {
    const s = gen('square', 1e6);
    const { mode, lines } = sampleSignal(s, 0, 1, 1000);
    expect(mode).toBe('envelope');
    const ys = lines[0]!.y;
    expect(Math.min(...ys)).toBe(-1);
    expect(Math.max(...ys)).toBe(1);
    expect(ys.length).toBe(2000);
  });

  it('splits polylines at undefined regions', () => {
    const d = defaultGenerator('sine');
    d.window = { mode: 'interval', start: 0.01, end: 0.02, outside: 'undefined' };
    const { lines } = sampleSignal(compileGenerator(d), 0, 0.03, 300);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.t[0]).toBeCloseTo(0.01, 12);
    expect(lines[0]!.t[lines[0]!.t.length - 1]).toBeCloseTo(0.02, 12);
  });
});

describe('viewport helpers', () => {
  it('zooms around an anchor point', () => {
    const r = zoomRange([0, 10], 0.5, 2);
    expect(r).toEqual([1, 6]);
  });

  it('auto vertical range does not depend on the visible window', () => {
    const r = autoYRange([gen('square', 150)]);
    expect(r[0]).toBeCloseTo(-1.16, 12);
    expect(r[1]).toBeCloseTo(1.16, 12);
  });

  it('fits two periods of the slowest periodic signal', () => {
    expect(fitTimeRange([gen('sine', 50), gen('sine', 1000)])).toEqual([0, 0.04]);
  });
});

describe('Acceptance Test 6 — stacked plots share the time axis', () => {
  const traces = [trace('A', 'sine', 50), trace('B', 'square', 150), trace('C', 'triangle', 1000)];

  const build = (xRange: [number, number]) =>
    buildFigure({
      width: 900,
      height: 600,
      panels: panelsForMode('stacked', traces, {}),
      xRange,
      xTitle: 'Time',
      showLegend: true,
      theme: LIGHT_TECHNICAL,
    });

  it('creates three panels with an identical horizontal mapping', () => {
    const { layout } = build([0, 0.04]);
    expect(layout.panels).toHaveLength(3);
    for (const p of layout.panels) {
      expect(p.x).toBe(layout.plotX);
      expect(p.w).toBe(layout.plotW);
    }
    // Panels do not overlap and are stacked top to bottom.
    for (let i = 1; i < 3; i++) {
      expect(layout.panels[i]!.y).toBeGreaterThan(layout.panels[i - 1]!.y + layout.panels[i - 1]!.h);
    }
  });

  it('stays synchronized after zoom and pan: an edge maps to the same x in every panel', () => {
    let range = zoomRange([0, 0.04], 0.25, 0.01);
    range = panRange(range, 0.0013);
    const { layout, scene } = build([range[0], range[1]]);
    const xEdge = tToPx(layout, 0.01); // 150 Hz square falls at 1.5·T = 10 ms (view: 8.8–18.8 ms)
    expect(pxToT(layout, xEdge)).toBeCloseTo(0.01, 15);

    // The square trace contains a vertical segment exactly at that x.
    const path = scene.items.find((it) => it.type === 'path' && it.dataId === 'B');
    expect(path && path.type === 'path').toBe(true);
    if (path?.type !== 'path') return;
    const pts = path.polylines[0]!;
    let found = false;
    for (let i = 2; i < pts.length; i += 2) {
      if (Math.abs(pts[i]! - xEdge) < 1e-9 && pts[i - 2] === pts[i] && pts[i + 1] !== pts[i - 1]) found = true;
    }
    expect(found).toBe(true);
  });

  it('draws time tick labels only once, under the bottom panel', () => {
    const { scene, layout } = build([0, 0.04]);
    const bottom = layout.panels[2]!;
    const xLabels = scene.items.filter(
      (it) => it.type === 'text' && it.baseline === 'top' && it.anchor === 'middle',
    );
    expect(xLabels.length).toBeGreaterThan(0);
    for (const l of xLabels) if (l.type === 'text') expect(l.y).toBeGreaterThan(bottom.y + bottom.h);
  });
});

describe('SVG text with math markup', () => {
  it('renders subscripts as tspans and leaves plain labels untouched', async () => {
    const { sceneToSvg } = await import('./svg');
    const svg = sceneToSvg({
      width: 100,
      height: 50,
      background: null,
      fontFamily: 'Inter',
      clips: [],
      items: [
        { type: 'text', x: 10, y: 20, text: 'V_{out} (V)', size: 12, fill: '#000', anchor: 'start', baseline: 'bottom' },
        { type: 'text', x: 10, y: 40, text: 'Time (ms)', size: 12, fill: '#000', anchor: 'start', baseline: 'bottom' },
      ],
    });
    expect(svg).toContain('<tspan>V</tspan><tspan dy="3.36" font-size="8.64">out</tspan><tspan dy="-3.36"> (V)</tspan>');
    expect(svg).toContain('>Time (ms)</text>');
    expect(svg).not.toContain('dominant-baseline');
  });
});
