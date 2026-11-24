import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileDerived } from '../signals/derived';
import { compileGenerator } from '../signals/generator';
import { budgeted } from '../signals/budget';
import { harmonicSpectrum } from './spectrum';

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}) => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};
const opts = { f1: 50, periods: 1, t0: 0, maxOrder: 15 };

describe('exact harmonic spectrum', () => {
  it('sine: fundamental only, THD 0, phase −90° (sin = cos − 90°)', () => {
    const s = harmonicSpectrum(gen('sine', (d) => d.generator === 'sine' && Object.assign(d.params, { amplitude: 325, offset: 10 })), opts);
    expect(s.fundamental).toBeCloseTo(325, 9);
    expect(s.dc).toBeCloseTo(10, 9);
    expect(s.phaseDeg[1]).toBeCloseTo(-90, 6);
    expect(Math.max(...s.amp.slice(2))).toBeLessThan(1e-9);
    expect(s.thd).toBeLessThan(1e-6);
    expect(s.exactWindow).toBe(true);
  });

  it('square ±1: A_h = 4/(πh) for odd h, 0 for even; THD = √(π²/8 − 1) = 48.34 %', () => {
    const s = harmonicSpectrum(gen('square'), opts);
    for (let h = 1; h <= 15; h++) {
      expect(s.amp[h]).toBeCloseTo(h % 2 ? 4 / (Math.PI * h) : 0, 12);
    }
    expect(s.thd).toBeCloseTo(Math.sqrt((Math.PI * Math.PI) / 8 - 1), 12);
  });

  it('triangle: 8/(π²h²) odd harmonics; sawtooth: 2/(πh) all harmonics', () => {
    const tri = harmonicSpectrum(gen('triangle'), opts);
    for (const h of [1, 3, 5, 7]) expect(tri.amp[h]).toBeCloseTo(8 / (Math.PI * Math.PI * h * h), 12);
    expect(tri.amp[2]).toBeLessThan(1e-12);
    const saw = harmonicSpectrum(gen('sawtooth'), opts);
    for (const h of [1, 2, 3, 4, 9]) expect(saw.amp[h]).toBeCloseTo(2 / (Math.PI * h), 12);
  });

  it('several periods: bins between harmonics are zero; harmonics unchanged', () => {
    const s = harmonicSpectrum(gen('square'), { ...opts, periods: 3, maxOrder: 5 });
    expect(s.orders[3]).toBe(1);
    expect(s.amp[3]).toBeCloseTo(4 / Math.PI, 12);
    expect(s.amp[1]).toBeLessThan(1e-12); // order 1/3
    expect(s.amp[4]).toBeLessThan(1e-12);
  });

  it('natural-sampling sine–triangle PWM: fundamental = m·(high − low)/2, DC = mid level', () => {
    const carrier = gen('triangle', (d) => (d.timing.frequency = 1050)); // m_f = 21
    const ref = gen('sine', (d) => d.generator === 'sine' && (d.params.amplitude = 0.8));
    const map = new Map([['R', ref], ['C', carrier]]);
    const pwm = compileDerived({ root: parseExpr('R > C', (n) => (map.has(n) ? n : null)), logicHigh: 15, logicLow: 0, threshold: 0.5, resolution: null }, map);
    const s = harmonicSpectrum(pwm, { f1: 50, periods: 1, t0: 0, maxOrder: 60 });
    expect(s.dc).toBeCloseTo(7.5, 6);
    expect(s.fundamental).toBeCloseTo(0.8 * 7.5, 4);
    // Low-order baseband harmonics are (nearly) absent; the energy sits around m_f = 21.
    expect(Math.max(...s.amp.slice(2, 15))).toBeLessThan(0.02);
    expect(Math.max(...s.amp.slice(17, 26))).toBeGreaterThan(1);
  });

  it('derivative impulses are included exactly (deriv of a square)', () => {
    const sq = gen('square');
    const map = new Map([['S', sq]]);
    const d = compileDerived({ root: parseExpr('deriv(S)', (n) => (map.has(n) ? n : null)), logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, map);
    const s = harmonicSpectrum(d, { ...opts, maxOrder: 5 });
    // d/dt of the square series: ω·h·4/(πh) = 4ω/π for odd h.
    expect(s.amp[1]).toBeCloseTo((4 * 2 * Math.PI * 50) / Math.PI, 6);
    expect(s.amp[3]).toBeCloseTo((4 * 2 * Math.PI * 50) / Math.PI, 6);
  });

  it('flags windows that are not a whole number of periods', () => {
    expect(harmonicSpectrum(gen('sine', (d) => (d.timing.frequency = 60)), opts).exactWindow).toBe(false);
  });
});

describe('spectrum within the compute budget', () => {
  it('the largest allowed request (1000 periods × order 2000) is abandoned within its budget instead of freezing', () => {
    // A 1050 Hz square seen through 1000 periods of 50 Hz: 42 000 edges × 2·10⁶ harmonics. The per-harmonic
    // loops had no budget check, so the 8 s budget of the dialog could not stop them (minutes of frozen page).
    const sq = gen('square', (d) => (d.timing.frequency = 1050));
    const t0 = performance.now();
    const r = budgeted(sq, 300, () => harmonicSpectrum(sq, { f1: 50, periods: 1000, t0: 0, maxOrder: 2000 }), () => null);
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r).toBeNull();
  }, 20000);

  it('a window with more features than the argument limit of Math.max still works', () => {
    // 90 000 edges in the window (the feature cap is 10⁵): the scale used to be Math.max(...features).
    const sq = gen('square', (d) => (d.timing.frequency = 45_000));
    const s = harmonicSpectrum(sq, { f1: 1, periods: 1, t0: 0, maxOrder: 3 });
    expect(s.unresolved).toBeUndefined();
    expect(s.dc).toBeCloseTo(0, 6);
  });
});
