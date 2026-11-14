import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { measureInterval } from '../measure/measure';
import { rangeOf } from '../plot/range';
import { compileGenerator } from './generator';

function gen(kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}) {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
}

describe('exponential', () => {
  it('rises 0 → 1 with 63.2 % at one time constant, from the start time', () => {
    const s = gen('exponential', (d) => (d.timing.delay = 0.002)); // τ = 5 ms
    expect(s.value(0.001)).toBe(0);
    expect(s.value(0.002)).toBe(0);
    expect(s.value(0.007)).toBeCloseTo(1 - Math.exp(-1), 14);
    expect(s.value(1)).toBeCloseTo(1, 12);
    expect(s.features(0, 0.1).features.map((f) => [f.kind, f.t])).toEqual([['kink', 0.002]]);
  });

  it('decay preset 1 → 0 and exact range', () => {
    const s = gen('exponential', (d) => d.generator === 'exponential' && Object.assign(d.params, { initial: 1, final: 0, tau: 0.001 }));
    expect(s.value(0.001)).toBeCloseTo(Math.exp(-1), 14);
    expect(rangeOf(s, 0, 0.003)![0]).toBeCloseTo(Math.exp(-3), 14);
  });
});

describe('damped sinusoid', () => {
  const s = gen('damped', (d) => (d.timing.frequency = 100)); // A = 1, τ = 20 ms
  it('follows A·e^(−t/τ)·sin(ωt)', () => {
    for (const t of [0.0013, 0.0071, 0.033]) expect(s.value(t)).toBeCloseTo(Math.exp(-t / 0.02) * Math.sin(2 * Math.PI * 100 * t), 13);
  });

  it('peaks are exact extrema (derivative zero), alternating max/min, decaying', () => {
    const f = s.features(0, 0.05).features.filter((x) => x.kind === 'max' || x.kind === 'min');
    expect(f.length).toBe(10);
    for (const x of f) {
      const h = 1e-7;
      expect(Math.abs(s.value(x.t + h) - s.value(x.t - h)) / (2 * h)).toBeLessThan(1e-4);
    }
    expect(f.map((x) => x.kind).slice(0, 4)).toEqual(['max', 'min', 'max', 'min']);
    expect(f[2]!.right).toBeLessThan(f[0]!.right);
    // First peak earlier than T/4 because of the decay: ωt = atan(ωτ).
    expect(f[0]!.t).toBeCloseTo(Math.atan(2 * Math.PI * 100 * 0.02) / (2 * Math.PI * 100), 14);
  });

  it('starts with a jump when the phase makes sin(φ) ≠ 0', () => {
    const c = gen('damped', (d) => (d.timing.phaseDeg = 90));
    const j = c.features(-0.001, 0.001).features[0]!;
    expect([j.kind, j.left, j.right]).toEqual(['jump', 0, 1]);
  });
});

describe('piecewise', () => {
  it('linear trapezoid repeats with period = last − first time', () => {
    const s = gen('piecewise'); // (0,0) (2m,1) (8m,1) (10m,0) (20m,0), repeat
    expect(s.value(0.001)).toBeCloseTo(0.5, 14);
    expect(s.value(0.005)).toBe(1);
    expect(s.value(0.009)).toBeCloseTo(0.5, 14);
    expect(s.value(0.021)).toBeCloseTo(0.5, 14);
    expect(s.period).toBeCloseTo(0.02, 15);
    expect(s.features(0, 0.0199).features.map((f) => f.t)).toEqual([0, 0.002, 0.008, 0.01]);
  });

  it('equal times make a vertical step with correct left/right limits', () => {
    const s = gen('piecewise', (d) => {
      if (d.generator === 'piecewise') d.params = { points: [[0, 0], [0.005, 0], [0.005, 3], [0.01, 3]], interp: 'linear', repeat: false };
    });
    expect(s.value(0.005)).toBe(3);
    expect(s.left!(0.005)).toBe(0);
    const j = s.features(0.004, 0.006).features[0]!;
    expect([j.kind, j.left, j.right]).toEqual(['jump', 0, 3]);
    expect(s.value(-1)).toBe(0); // holds the first value before
    expect(s.value(1)).toBe(3); // and the last value after
  });

  it('step interpolation holds each value until the next point', () => {
    const s = gen('piecewise', (d) => {
      if (d.generator === 'piecewise') d.params = { points: [[0, 1], [0.002, 4], [0.006, 2], [0.01, 2]], interp: 'step', repeat: true };
    });
    expect(s.value(0.0019)).toBe(1);
    expect(s.value(0.002)).toBe(4);
    expect(s.value(0.0109)).toBe(1); // next cycle
    const m = measureInterval(s, 0, 0.01);
    expect(m.mean).toBeCloseTo((1 * 2 + 4 * 4 + 2 * 4) / 10, 12);
  });
});

describe('bit sequences', () => {
  const edges = (s: ReturnType<typeof gen>, t1: number) =>
    s
      .features(0, t1)
      .features.filter((f) => f.kind === 'jump')
      .map((f) => [Number((f.t * 1e3).toFixed(6)), f.right > f.left ? '↑' : '↓']);

  it('NRZ "10110010", 1 ms per bit, 0/5 V', () => {
    const s = gen('bits'); // defaults
    expect([0.0005, 0.0015, 0.0025, 0.0035, 0.0045, 0.0055, 0.0065, 0.0075].map((t) => s.value(t))).toEqual([5, 0, 5, 5, 0, 0, 5, 0]);
    expect(edges(s, 0.009)).toEqual([[0, '↑'], [1, '↓'], [2, '↑'], [4, '↓'], [6, '↑'], [7, '↓']]);
    expect(s.value(0.0095)).toBe(0); // idle low after the frame
  });

  it('RZ: ones are high for the first half of the bit only', () => {
    const s = gen('bits', (d) => d.generator === 'bits' && Object.assign(d.params, { bits: '110', encoding: 'rz' }));
    expect(edges(s, 0.004)).toEqual([[0, '↑'], [0.5, '↓'], [1, '↑'], [1.5, '↓']]);
  });

  it('Manchester (IEEE 802.3): 0 = high→low, 1 = low→high at mid-bit', () => {
    const s = gen('bits', (d) => d.generator === 'bits' && Object.assign(d.params, { bits: '10', encoding: 'manchester' }));
    // bit 1: low then high (↑ at 0.5 ms); bit 0: high then low (↓ at 1.5 ms); returns to idle low at 2 ms
    expect(edges(s, 0.003)).toEqual([[0.5, '↑'], [1.5, '↓']]);
    expect(s.value(0.0012)).toBe(5);
  });

  it('repeat makes the frame periodic with exact duty', () => {
    const s = gen('bits', (d) => d.generator === 'bits' && Object.assign(d.params, { bits: '1100', repeat: true }));
    expect(s.period).toBeCloseTo(0.004, 15);
    expect(s.value(0.0045)).toBe(5);
    expect(measureInterval(s, 0, 0.012).duty).toBeCloseTo(0.5, 12);
  });
});
