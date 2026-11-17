import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileDerived } from '../signals/derived';
import { compileGenerator } from '../signals/generator';
import type { SignalEval } from '../signals/types';
import { edgeMetrics } from './edges';

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}): SignalEval => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};
const expr = (src: string, inputs: Record<string, SignalEval>): SignalEval => {
  const map = new Map(Object.entries(inputs));
  return compileDerived({ root: parseExpr(src, (n) => (map.has(n) ? n : null)), logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, map);
};

describe('edge and pulse measurements', () => {
  it('ideal square 0/5 V, 30 % duty at 50 Hz: vertical edges, widths 6 ms / 14 ms, no overshoot', () => {
    const sq = gen('square', (d) => {
      if (d.generator === 'square') Object.assign(d.params, { high: 5, low: 0, duty: 0.3 });
    });
    const m = edgeMetrics(sq, 0, 0.1)!;
    expect(m.twoLevel).toBe(true);
    expect(m.base).toBeCloseTo(0, 9);
    expect(m.top).toBeCloseTo(5, 9);
    expect(m.rise!.value).toBeCloseTo(0, 9);
    expect(m.fall!.value).toBeCloseTo(0, 9);
    expect(m.posWidth!.value).toBeCloseTo(0.006, 6);
    expect(m.negWidth!.value).toBeCloseTo(0.014, 6);
    expect(m.overshoot).toBeUndefined();
    expect(m.undershoot).toBeUndefined();
  });

  it('RC step: 10–90 % rise time = τ·ln 9', () => {
    const tau = 1e-3;
    const y = expr('lowpass(Q, 1m)', { Q: gen('square') });
    const m = edgeMetrics(y, 0.02, 0.1)!;
    expect(m.twoLevel).toBe(true);
    expect(Math.abs(m.rise!.value / (tau * Math.log(9)) - 1)).toBeLessThan(0.005); // 2.197 ms
    expect(Math.abs(m.fall!.value / (tau * Math.log(9)) - 1)).toBeLessThan(0.005);
    expect(m.rise!.count).toBeGreaterThanOrEqual(3);
  });

  it('second-order low-pass, Q = 2 (ζ = 0.25): overshoot exp(−πζ/√(1−ζ²)) = 44.4 %, settling ≈ 4/(ζω₀)', () => {
    const y = expr('lowpass2(Q, 1k, 2)', { Q: gen('square', (d) => (d.timing.frequency = 25)) });
    const m = edgeMetrics(y, 0, 0.08)!;
    const zeta = 0.25;
    expect(m.overshoot!).toBeCloseTo(100 * Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta)), 0);
    const ts = 4 / (zeta * 2 * Math.PI * 1000);
    expect(m.settling!).toBeGreaterThan(0.6 * ts);
    expect(m.settling!).toBeLessThan(1.3 * ts);
    expect(m.undershoot!).toBeGreaterThan(0); // the falling edge rings below base as well
  });

  it('a sine has no two levels: min/max are used and its 10–90 % rise is (2·asin 0.8)/ω', () => {
    const m = edgeMetrics(gen('sine'), 0, 0.1)!;
    expect(m.twoLevel).toBe(false);
    expect(m.base).toBeCloseTo(-1, 6);
    expect(m.top).toBeCloseTo(1, 6);
    expect(m.rise!.value).toBeCloseTo((2 * Math.asin(0.8)) / (2 * Math.PI * 50), 4);
  });

  it('constant signals, empty windows and dense windows are reported, not guessed', () => {
    expect(edgeMetrics(gen('dc'), 0, 1)!.note).toMatch(/constant/);
    expect(edgeMetrics(gen('sine'), 1, 1)).toBeNull();
    const dense = gen('square', (d) => (d.timing.frequency = 1e6));
    expect(edgeMetrics(dense, 0, 1)!.note).toMatch(/zoom in/);
  });
});
