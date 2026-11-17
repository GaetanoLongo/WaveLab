import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { measureInterval } from '../measure/measure';
import { rangeOf } from '../plot/range';
import { compileDerived } from './derived';
import { compileGenerator } from './generator';
import type { SignalEval } from './types';

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}): SignalEval => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};
const expr = (src: string, inputs: Record<string, SignalEval>): SignalEval => {
  const map = new Map(Object.entries(inputs));
  return compileDerived({ root: parseExpr(src, (n) => (map.has(n) ? n : null)), logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, map);
};

describe('lowpass (first-order lag)', () => {
  const sq = gen('square'); // 50 Hz, ±1 V, high first

  it('square input: periodic steady state peaks at tanh(h / 2τ)', () => {
    const tau = 4e-3;
    const y = expr('lowpass(Q, 4m)', { Q: sq });
    expect(y.period).toBeCloseTo(0.02, 15);
    const peak = Math.tanh(0.01 / (2 * tau));
    expect(y.value(0.01)).toBeCloseTo(peak, 12);
    expect(y.value(0)).toBeCloseTo(-peak, 12);
    expect(y.value(1000.01)).toBeCloseTo(peak, 9); // no drift far away
    const r = rangeOf(y, 0, 0.02)!;
    expect(r[1]).toBeCloseTo(peak, 10);
    expect(r[0]).toBeCloseTo(-peak, 10);
  });

  it('sine input: amplitude 1/√(1+(ωτ)²) and phase lag atan(ωτ)', () => {
    const s = gen('sine');
    const tau = 2e-3;
    const w = 2 * Math.PI * 50;
    const y = expr('lowpass(S, 2m)', { S: s });
    const A = 1 / Math.sqrt(1 + (w * tau) ** 2);
    const phi = Math.atan(w * tau);
    for (const t of [0, 0.003, 0.0111, 0.017]) expect(y.value(t)).toBeCloseTo(A * Math.sin(w * t - phi), 10);
    expect(rangeOf(y, 0, 0.02)![1]).toBeCloseTo(A, 8);
  });

  it('step from rest: 1 − e^(−t/τ); y0 before t0', () => {
    const one = gen('dc', (d) => d.generator === 'dc' && (d.params.level = 1));
    const y = expr('lowpass(D, 1m, 0, 0)', { D: one });
    expect(y.value(-1)).toBe(0);
    for (const t of [0.0005, 0.001, 0.004]) expect(y.value(t)).toBeCloseTo(1 - Math.exp(-t / 1e-3), 12);
    const y2 = expr('lowpass(D, 1m, 2m, 3)', { D: one });
    expect(y2.value(0)).toBe(3);
    expect(y2.value(0.003)).toBeCloseTo(1 + 2 * Math.exp(-1), 12);
  });

  it('start-up transient on a periodic input converges to the steady state', () => {
    const ss = expr('lowpass(Q, 4m)', { Q: sq });
    const tr = expr('lowpass(Q, 4m, 0, 0)', { Q: sq });
    expect(tr.value(0)).toBe(0);
    expect(tr.period).toBeUndefined();
    expect(Math.abs(tr.value(0.2005) - ss.value(0.2005))).toBeLessThan(1e-9);
    // Exact check of the first half-period: 1 − e^(−t/τ)
    expect(tr.value(0.005)).toBeCloseTo(1 - Math.exp(-0.005 / 4e-3), 12);
  });

  it('aperiodic input far from t = 0 is computed from a bounded history (no page-freezing walk from 0)', () => {
    // Two incommensurate squares: dense, never-repeating edges.
    const q1 = gen('square');
    const q2 = gen('square', (d) => (d.timing.frequency = 50 * Math.SQRT2 * 3));
    const x = expr('Q1 * Q2', { Q1: q1, Q2: q2 });
    expect(x.period).toBeUndefined();
    const far = expr('lowpass(X, 1m)', { X: x });
    const t0 = performance.now();
    const v = far.value(300.0021);
    expect(performance.now() - t0).toBeLessThan(2000);
    // Reference: the same filter started from rest 0.5 s earlier (the start-up transient has decayed by e^-500).
    const ref = expr('lowpass(X, 1m, 299.5, 0)', { X: x });
    expect(v).toBeCloseTo(ref.value(300.0021), 10);
    // Near 0 the exact walk and the bounded one agree too.
    const near = expr('lowpass(X, 1m, 1.5, 0)', { X: x });
    expect(far.value(2.0003)).toBeCloseTo(near.value(2.0003), 10);
  });

  it('R-L load: mean current = mean voltage / R; ripple from the exact solution', () => {
    // 1 kHz 0/48 V square, 25 % duty, R = 2 Ω, L = 1 mH → τ = 0.5 ms
    const v = gen('square', (d) => {
      d.timing.frequency = 1000;
      if (d.generator === 'square') Object.assign(d.params, { high: 48, low: 0, duty: 0.25 });
    });
    const i = expr('lowpass(V / 2, 1m / 2)', { V: v });
    const m = measureInterval(i, 0, 0.001);
    expect(m.mean).toBeCloseTo(12 / 2, 9);
    const E1 = Math.exp(-0.25e-3 / 0.5e-3);
    const E2 = Math.exp(-0.75e-3 / 0.5e-3);
    const imin = (24 * (1 - E1) * E2) / (1 - E1 * E2);
    expect(m.min).toBeCloseTo(imin, 9);
    expect(m.max).toBeCloseTo(24 - (24 - imin) * E1, 9);
  });

  it('rejects bad arguments', () => {
    expect(() => expr('lowpass(Q, 0)', { Q: sq })).toThrow('positive time');
    expect(() => expr('lowpass(Q, 1m, 0)', { Q: sq })).toThrow('lowpass() takes');
  });
});
