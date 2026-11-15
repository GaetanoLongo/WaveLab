import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { measureInterval } from '../measure/measure';
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
const amp = (s: SignalEval, T: number) => {
  const m = measureInterval(s, 0, T);
  return (m.max - m.min) / 2;
};

describe('second-order filters (RLC)', () => {
  const s50 = gen('sine'); // 50 Hz, 1 V
  for (const [f0, Q] of [[100, 0.707], [50, 5], [25, 2]] as const) {
    it(`sine through f0 = ${f0} Hz, Q = ${Q}: |H| for LP, BP, HP`, () => {
      const r = 50 / f0;
      const D = Math.sqrt((1 - r * r) ** 2 + (r / Q) ** 2);
      expect(amp(expr(`lowpass2(S, ${f0}, ${Q})`, { S: s50 }), 0.02)).toBeCloseTo(1 / D, 6);
      expect(amp(expr(`bandpass2(S, ${f0}, ${Q})`, { S: s50 }), 0.02)).toBeCloseTo(r / Q / D, 6);
      expect(amp(expr(`highpass2(S, ${f0}, ${Q})`, { S: s50 }), 0.02)).toBeCloseTo((r * r) / D, 6);
    });
  }

  it('step response from rest matches the underdamped closed form', () => {
    const one = gen('dc', (d) => d.generator === 'dc' && (d.params.level = 1));
    const f0 = 1000;
    const Q = 3;
    const y = expr(`lowpass2(D, ${f0}, ${Q})`, { D: one });
    const w = 2 * Math.PI * f0;
    const z = 1 / (2 * Q);
    const wd = w * Math.sqrt(1 - z * z);
    for (const t of [0.0002, 0.0007, 0.0015, 0.003]) {
      const exact = 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z / Math.sqrt(1 - z * z)) * Math.sin(wd * t));
      expect(y.value(t)).toBeCloseTo(exact, 9);
    }
    expect(y.value(-1)).toBe(0);
  });

  it('square wave: periodic steady state agrees with brute-force RK4 integration', () => {
    const q = gen('square', (d) => {
      d.timing.frequency = 100;
      if (d.generator === 'square') Object.assign(d.params, { high: 1, low: 0, duty: 0.3 });
    });
    const f0 = 400;
    const Q = 4;
    const y = expr(`lowpass2(Q1, ${f0}, ${Q})`, { Q1: q });
    expect(y.period).toBeCloseTo(0.01, 15);
    // RK4 over many periods from rest converges to the steady state.
    const w = 2 * Math.PI * f0;
    let x1 = 0;
    let x2 = 0;
    const h = 1e-7;
    const u = (t: number) => (((t % 0.01) + 0.01) % 0.01 < 0.003 ? 1 : 0);
    const f = (t: number, a: number, b: number) => [b, w * w * (u(t) - a) - (w / Q) * b];
    let t = 0;
    const N = Math.round(0.2 / h);
    for (let i = 0; i < N; i++) {
      const k1 = f(t, x1, x2);
      const k2 = f(t + h / 2, x1 + (h / 2) * k1[0]!, x2 + (h / 2) * k1[1]!);
      const k3 = f(t + h / 2, x1 + (h / 2) * k2[0]!, x2 + (h / 2) * k2[1]!);
      const k4 = f(t + h, x1 + h * k3[0]!, x2 + h * k3[1]!);
      x1 += (h / 6) * (k1[0]! + 2 * k2[0]! + 2 * k3[0]! + k4[0]!);
      x2 += (h / 6) * (k1[1]! + 2 * k2[1]! + 2 * k3[1]! + k4[1]!);
      t += h;
    }
    expect(y.value(0.2)).toBeCloseTo(x1, 4);
    expect(measureInterval(y, 0, 0.01).mean).toBeCloseTo(0.3, 9); // DC gain 1
  });
});
