import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileGenerator } from '../signals/generator';
import { measureInterval } from './measure';

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}) => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};

describe('interval measurements (exact)', () => {
  it('sine 325 V over 2 periods: peaks, mean 0, RMS 229.81 V, 50 Hz', () => {
    const m = measureInterval(gen('sine', (d) => d.generator === 'sine' && (d.params.amplitude = 325)), 0, 0.04);
    expect(m.max).toBeCloseTo(325, 9);
    expect(m.min).toBeCloseTo(-325, 9);
    expect(m.peakToPeak).toBeCloseTo(650, 9);
    expect(m.mean).toBeCloseTo(0, 9);
    expect(m.rms).toBeCloseTo(325 / Math.SQRT2, 9);
    expect(m.duty).toBeCloseTo(0.5, 12);
    expect(m.frequency).toBeCloseTo(50, 9); // rising crossings sit on the interval ends → falling ones (10, 30 ms) are used
  });

  it('square 0/5 V, 30 % duty over 3 periods: duty 0.3, mean 1.5 V, RMS sqrt(7.5)', () => {
    const s = gen('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: 5, low: 0, duty: 0.3 }));
    const m = measureInterval(s, 0.001, 0.061);
    expect(m.duty).toBeCloseTo(0.3, 12);
    expect(m.mean).toBeCloseTo(1.5, 12);
    expect(m.rms).toBeCloseTo(Math.sqrt(7.5), 12);
    expect(m.threshold).toBe(2.5);
    expect(m.frequency).toBeCloseTo(50, 9);
    expect(m.risingCrossings).toBe(3);
  });

  it('partial interval of a triangle: exact max inside the interval', () => {
    const m = measureInterval(gen('triangle'), 0.002, 0.007);
    expect(m.max).toBeCloseTo(0.4, 12); // triangle −1 at 0 → +1 at 10 ms: value at 7 ms = 0.4
    expect(m.min).toBeCloseTo(-0.6, 12);
    expect(m.mean).toBeCloseTo(-0.1, 12);
  });

  it('reversed interval is normalized; zero-length gives NaN', () => {
    const s = gen('sine');
    expect(measureInterval(s, 0.02, 0).rms).toBeCloseTo(1 / Math.SQRT2, 9);
    expect(measureInterval(s, 0.01, 0.01).mean).toBeNaN();
  });

  it('flat signal: duty and frequency undefined', () => {
    const m = measureInterval(gen('dc'), 0, 1);
    expect(m.mean).toBe(1);
    expect(m.duty).toBeNaN();
    expect(m.frequency).toBeNaN();
  });
});
