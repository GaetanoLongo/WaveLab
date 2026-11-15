import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileGenerator } from '../signals/generator';
import { measureInterval } from './measure';
import { powerMetrics } from './power';

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}) => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};

describe('crest and form factors', () => {
  it('sine √2 and π/(2√2); square 1 and 1; triangle √3 and 2/√3', () => {
    const s = measureInterval(gen('sine'), 0, 0.02);
    expect(s.crest).toBeCloseTo(Math.SQRT2, 10);
    expect(s.form).toBeCloseTo(Math.PI / (2 * Math.SQRT2), 10);
    const q = measureInterval(gen('square'), 0, 0.02);
    expect(q.crest).toBeCloseTo(1, 12);
    expect(q.form).toBeCloseTo(1, 12);
    const t = measureInterval(gen('triangle'), 0, 0.02);
    expect(t.crest).toBeCloseTo(Math.sqrt(3), 10);
    expect(t.form).toBeCloseTo(2 / Math.sqrt(3), 10);
  });
});

describe('power metrics', () => {
  const v = gen('sine', (d) => d.generator === 'sine' && (d.params.amplitude = 325));
  it('sinusoids, current lagging 30°: P = VI cos φ, Q₁ = VI sin φ > 0, PF = DPF', () => {
    const i = gen('sine', (d) => {
      if (d.generator === 'sine') d.params.amplitude = 10;
      d.timing.phaseDeg = -30;
    });
    const m = powerMetrics(v, i, 0, 0.02, { f1: 50, periods: 1, t0: 0 });
    const VI = (325 / Math.SQRT2) * (10 / Math.SQRT2);
    expect(m.s).toBeCloseTo(VI, 9);
    expect(m.p).toBeCloseTo(VI * Math.cos(Math.PI / 6), 8);
    expect(m.q1).toBeCloseTo(VI * Math.sin(Math.PI / 6), 8);
    expect(m.n).toBeCloseTo(m.q1, 7);
    expect(m.pf).toBeCloseTo(Math.cos(Math.PI / 6), 10);
    expect(m.dpf).toBeCloseTo(Math.cos(Math.PI / 6), 10);
    expect(m.phi1Deg).toBeCloseTo(30, 8);
  });

  it('square-wave current in phase: PF = 2√2/π (distortion), DPF = 1', () => {
    const i = gen('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: 10, low: -10 }));
    const m = powerMetrics(v, i, 0, 0.02, { f1: 50, periods: 1, t0: 0 });
    expect(m.pf).toBeCloseTo((2 * Math.SQRT2) / Math.PI, 9);
    expect(m.dpf).toBeCloseTo(1, 9);
    expect(m.q1).toBeCloseTo(0, 6);
    expect(m.n).toBeGreaterThan(0);
  });
});
