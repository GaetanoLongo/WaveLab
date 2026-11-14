import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { rangeOf } from '../plot/range';
import { compileDerived } from './derived';
import { compileGenerator } from './generator';
import type { SignalEval } from './types';

function gen(kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}): SignalEval {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
}

function expr(src: string, inputs: Record<string, SignalEval>): SignalEval {
  const map = new Map(Object.entries(inputs));
  const root = parseExpr(src, (n) => (map.has(n) ? n : null));
  return compileDerived({ root, logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, map);
}

const W = 2 * Math.PI * 50;

describe('Acceptance Test 4 — integrating a square wave', () => {
  // 50 Hz square, ±10 V, 50 %: the integral is a triangle 0 → 0.05 V·s → 0 every 20 ms.
  const sq = gen('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: 10, low: -10 }));

  it('is piecewise linear with the expected values and slopes', () => {
    const I = expr('integral(Sq)', { Sq: sq });
    expect(I.value(0)).toBe(0);
    expect(I.value(0.005)).toBeCloseTo(0.05, 13);
    expect(I.value(0.01)).toBeCloseTo(0.1, 13);
    expect(I.value(0.015)).toBeCloseTo(0.05, 13);
    expect(I.value(0.02)).toBeCloseTo(0, 13);
    expect(I.value(1000.005)).toBeCloseTo(0.05, 9); // no drift far away
  });

  it('honours the initial condition and start time', () => {
    const I = expr('integral(Sq, 0.005, 2)', { Sq: sq });
    expect(I.value(0.005)).toBeCloseTo(2, 13);
    expect(I.value(0.01)).toBeCloseTo(2.05, 13);
    expect(I.value(0)).toBeCloseTo(1.95, 13); // before t0: integral runs backwards
  });

  it('has its peaks exactly at the square edges and is periodic', () => {
    const I = expr('integral(Sq)', { Sq: sq });
    const f = I.features(0.001, 0.039).features;
    const kinds = f.map((x) => [x.kind, Number(x.t.toFixed(9))]);
    expect(kinds).toEqual([['max', 0.01], ['min', 0.02], ['max', 0.03]]);
    expect(I.period).toBeCloseTo(0.02, 15);
    expect(rangeOf(I, 0, 0.02)).toEqual([0, expect.closeTo(0.1, 13)]);
  });

  it('a square with a DC component ramps (not periodic)', () => {
    const sq2 = gen('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: 10, low: 0 }));
    const I = expr('integral(Sq)', { Sq: sq2 });
    expect(I.value(0.02)).toBeCloseTo(0.1, 13);
    expect(I.value(0.2)).toBeCloseTo(1, 12);
    expect(I.period).toBeUndefined();
  });
});

describe('integral of smooth and aperiodic signals', () => {
  it('sine: (1 − cos ωt)/ω', () => {
    const I = expr('integral(S)', { S: gen('sine') });
    for (const t of [0.001, 0.0077, 0.013]) expect(I.value(t)).toBeCloseTo((1 - Math.cos(W * t)) / W, 13);
  });

  it('DC over long times (chunked tables)', () => {
    const dc = gen('dc', (d) => d.generator === 'dc' && (d.params.level = 3));
    const I = expr('integral(D, 0.5)', { D: dc });
    expect(I.value(10.5)).toBeCloseTo(30, 9);
    expect(I.value(0)).toBeCloseTo(-1.5, 12);
  });
});

describe('derivatives', () => {
  it('deriv(sine) = ω cos ωt with high accuracy', () => {
    const d = expr('deriv(S)', { S: gen('sine') });
    for (const t of [0.0003, 0.005, 0.0131]) expect(d.value(t) / W).toBeCloseTo(Math.cos(W * t), 8);
  });

  it('deriv(square) is zero with impulse markers at the edges (never a finite spike)', () => {
    const d = expr('deriv(Sq)', { Sq: gen('square') });
    expect(d.value(0.01)).toBe(0);
    expect(rangeOf(d, 0, 0.02)).toEqual([0, 0]);
    const imp = d.impulses!(0, 0.02);
    expect(imp.map((i) => [Number(i.t.toFixed(9)), i.weight])).toEqual([[0, 2], [0.01, -2], [0.02, 2]]);
  });

  it('deriv(triangle) is ±4A/T, piecewise constant with exact jumps', () => {
    const d = expr('deriv(T)', { T: gen('triangle') });
    expect(d.value(0.003)).toBeCloseTo(200, 6);
    expect(d.value(0.013)).toBeCloseTo(-200, 6);
    const jumps = d.features(0.001, 0.019).features.filter((f) => f.kind === 'jump');
    expect(jumps).toHaveLength(1);
    expect(jumps[0]!.t).toBeCloseTo(0.01, 12);
    expect(jumps[0]!.left).toBeCloseTo(200, 6);
    expect(jumps[0]!.right).toBeCloseTo(-200, 6);
  });

  it('impulses scale through linear operations and integral(deriv(x)) recovers x', () => {
    const sq = gen('square');
    expect(expr('-3 * deriv(Sq)', { Sq: sq }).impulses!(0.005, 0.015)[0]!.weight).toBe(6);
    const back = expr('integral(deriv(Sq))', { Sq: sq });
    // x(t) − x(0⁺) with x = ±1: 0 in the high half, −2 in the low half.
    expect(back.value(0.005)).toBeCloseTo(0, 12);
    expect(back.value(0.015)).toBeCloseTo(-2, 12);
  });

  it('warns instead of silently dropping impulses through non-linear operations', () => {
    const a = expr('abs(deriv(Sq))', { Sq: gen('square') });
    expect(a.warnings?.[0]).toMatch(/cannot pass through abs/);
  });

  it('dfinite spreads each edge over the rise time: rectangle J/tr', () => {
    const d = expr('dfinite(Sq, 1m)', { Sq: gen('square') });
    expect(d.value(0.01)).toBeCloseTo(-2000, 6);
    expect(d.value(0.0104)).toBeCloseTo(-2000, 6);
    expect(d.value(0.0106)).toBeCloseTo(0, 6);
    const jumps = d.features(0.005, 0.015).features.filter((f) => f.kind === 'jump').map((f) => f.t);
    expect(jumps[0]).toBeCloseTo(0.0095, 12);
    expect(jumps[1]).toBeCloseTo(0.0105, 12);
  });

  it('dnum is the plain central difference (rectangles of height J/h at edges)', () => {
    const d = expr('dnum(Sq, 0.1m)', { Sq: gen('square') });
    expect(d.value(0.01)).toBeCloseTo(-20000, 6);
    const s = expr('dnum(S, 1u)', { S: gen('sine') });
    expect(s.value(0.002) / W).toBeCloseTo(Math.cos(W * 0.002), 6);
  });
});

describe('moving average and RMS', () => {
  it('moving average over one period gives the DC value', () => {
    const sq = gen('square', (d) => d.generator === 'square' && (d.params.duty = 0.3));
    const m = expr('movavg(Sq, 20m)', { Sq: sq });
    for (const t of [0.0213, 0.031, 0.05]) expect(m.value(t)).toBeCloseTo(-0.4, 12);
    expect(expr('movavg(S, 20m)', { S: gen('sine') }).value(0.0371)).toBeCloseTo(0, 12);
  });

  it('RMS over one period: 325 V sine → 229.81 V; ±1 square → 1', () => {
    const s = gen('sine', (d) => d.generator === 'sine' && (d.params.amplitude = 325));
    expect(expr('rms(S, 20m)', { S: s }).value(0.0277)).toBeCloseTo(325 / Math.SQRT2, 9);
    expect(expr('rms(Sq, 20m)', { Sq: gen('square') }).value(0.0331)).toBeCloseTo(1, 12);
  });

  it('a short window follows the signal (moving average of a square ramps at edges)', () => {
    const m = expr('movavg(Sq, 2m)', { Sq: gen('square') });
    expect(m.value(0.005)).toBeCloseTo(1, 12);
    expect(m.value(0.011)).toBeCloseTo(0, 12); // half of the window after the falling edge
    const f = m.features(0.009, 0.013).features.map((x) => Number(x.t.toFixed(9)));
    expect(f).toContain(0.01);
    expect(f).toContain(0.012);
  });
});
