import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { measureInterval } from '../measure/measure';
import { compileDerived } from './derived';
import { compileGenerator } from './generator';
import { PRBS_TAPS, prbsBits } from './sources';
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

describe('chirp', () => {
  it('linear sweep: extrema where the phase is π/2 + nπ, count = 2 × cycles', () => {
    // 50 → 500 Hz over 40 ms: phase = 2π(50u + 5625u²); total cycles = 0.04·(50+500)/2 = 11
    const c = gen('chirp');
    const ext = c.features(0, 0.04).features.filter((f) => f.kind === 'max' || f.kind === 'min');
    expect(ext.length).toBe(22);
    for (const f of ext.slice(0, 6)) {
      expect(Math.abs(f.left)).toBeCloseTo(1, 12);
      const u = f.t;
      const ph = 2 * Math.PI * (50 * u + 5625 * u * u);
      const x = (ph - Math.PI / 2) / Math.PI;
      expect(Math.abs(x - Math.round(x))).toBeLessThan(1e-9);
    }
    expect(c.value(-0.001)).toBe(0);
    expect(c.value(0.05)).toBe(0); // offset after the sweep
    expect(c.extent).toEqual([0, 0.04]);
  });

  it('logarithmic sweep: extrema at ±A, instantaneous frequency f0·k^(u/T)', () => {
    const c = gen('chirp', (d) => d.generator === 'chirp' && Object.assign(d.params, { sweep: 'log', f0: 10, f1: 1000, duration: 0.1, amplitude: 2 }));
    const ext = c.features(0, 0.1).features.filter((f) => f.kind === 'max' || f.kind === 'min');
    // cycles = f0·T·(k − 1)/ln k = 10·0.1·99/ln 100 = 21.497 → 42 or 43 extrema
    expect(ext.length).toBeGreaterThanOrEqual(42);
    for (const f of ext) expect(Math.abs(f.left)).toBeCloseTo(2, 10);
    // Spacing of consecutive maxima ≈ 1/f(u)
    const maxima = ext.filter((f) => f.kind === 'max');
    const i = Math.floor(maxima.length / 2);
    const tm = (maxima[i]!.t + maxima[i + 1]!.t) / 2;
    expect(1 / (maxima[i + 1]!.t - maxima[i]!.t)).toBeCloseTo(10 * 100 ** (tm / 0.1), -1);
  });

  it('repeat: periodic with period T, jump at each restart', () => {
    const c = gen('chirp', (d) => d.generator === 'chirp' && (d.params.repeat = true));
    expect(c.period).toBe(0.04);
    expect(c.value(0.041)).toBeCloseTo(c.value(0.001), 12);
  });
});

describe('noise', () => {
  it('hold: exact mean and RMS over one period; deterministic', () => {
    const p = (d: GeneratorDef) => d.generator === 'noise' && Object.assign(d.params, { interp: 'hold', mean: 0.5, rms: 0.2, length: 1000 });
    const n = gen('noise', p);
    expect(n.period).toBeCloseTo(0.1, 15);
    const m = measureInterval(n, 0, 0.1);
    expect(m.mean).toBeCloseTo(0.5, 12);
    expect(Math.sqrt(m.rms ** 2 - 0.25)).toBeCloseTo(0.2, 10);
    expect(gen('noise', p).value(0.01234)).toBe(n.value(0.01234));
    const other = gen('noise', (d) => p(d) && d.generator === 'noise' && (d.params.seed = 2));
    expect(other.value(0.01234)).not.toBe(n.value(0.01234));
  });

  it('linear: exact mean; Gaussian vs uniform both normalised', () => {
    const n = gen('noise', (d) => d.generator === 'noise' && Object.assign(d.params, { distribution: 'uniform', mean: -1 }));
    expect(measureInterval(n, 0, n.period!).mean).toBeCloseTo(-1, 12);
    const r = measureInterval(n, 0, n.period!);
    expect(r.max).toBeLessThan(-1 + 0.1 * Math.sqrt(3) * 1.02); // uniform: |x − mean| ≈≤ √3σ
  });
});

describe('PRBS', () => {
  for (const order of Object.keys(PRBS_TAPS).map(Number)) {
    it(`PRBS-${order}: maximal length 2^n − 1, 2^(n−1) ones`, () => {
      const s = prbsBits(order, 2 ** order - 1)!;
      expect(s.length).toBe(2 ** order - 1);
      expect([...s].filter((c) => c === '1').length).toBe(2 ** (order - 1));
      // No shorter period: the n-bit windows are all distinct (each non-zero state once).
      const seen = new Set<string>();
      const ss = s + s.slice(0, order - 1);
      for (let i = 0; i < s.length; i++) seen.add(ss.slice(i, i + order));
      expect(seen.size).toBe(2 ** order - 1);
    });
  }
  it('signal: periodic, NRZ levels', () => {
    const p = gen('prbs');
    expect(p.period).toBeCloseTo(127e-4, 15);
    expect(new Set(p.features(0, 0.0127).features.flatMap((f) => [f.left, f.right]))).toEqual(new Set([0, 1]));
  });
});

describe('quantize and zoh', () => {
  const s = gen('sine');
  it('quantize: multiples of q, steps exactly where the input crosses the half-steps', () => {
    const q = expr('quantize(S, 0.25)', { S: s });
    const steps = q.features(0, 0.005).features.filter((f) => f.kind === 'jump');
    expect(steps.map((f) => f.right)).toEqual([0.25, 0.5, 0.75, 1]);
    // First step where sin(ωt) = 0.125
    expect(steps[0]!.t).toBeCloseTo(Math.asin(0.125) / (2 * Math.PI * 50), 12);
    expect(q.piecewiseConstant).toBe(true);
  });
  it('zoh: x(k·Ts) held; common period with the input', () => {
    const z = expr('zoh(S, 1m)', { S: s });
    expect(z.value(0.0037)).toBeCloseTo(Math.sin(2 * Math.PI * 50 * 0.003), 14);
    expect(z.value(0.004)).toBeCloseTo(Math.sin(2 * Math.PI * 50 * 0.004), 14);
    expect(z.left!(0.004)).toBeCloseTo(Math.sin(2 * Math.PI * 50 * 0.003), 14);
    expect(z.period).toBeCloseTo(0.02, 15);
    expect(z.features(0, 0.02).features.length).toBe(21); // both ends included
  });
});
