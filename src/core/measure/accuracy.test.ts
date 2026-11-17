/**
 * Measurement accuracy against closed-form results: the numbers the app shows (mean, RMS, pk-pk,
 * duty, frequency, THD, power, rise time…) for waveforms whose answer is known exactly.
 */

import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileGenerator } from '../signals/generator';
import type { SignalEval } from '../signals/types';
import { edgeMetrics } from './edges';
import { measureInterval } from './measure';
import { powerMetrics } from './power';
import { harmonicSpectrum } from './spectrum';

const gen = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}): SignalEval => {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
};
const close = (a: number, b: number, rel = 1e-8) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(b)));

describe('interval measurements over whole periods', () => {
  const T = 0.02; // 50 Hz
  it('sine with offset', () => {
    const A = 3;
    const c = 1.5;
    const m = measureInterval(gen('sine', (d) => d.generator === 'sine' && Object.assign(d.params, { amplitude: A, offset: c })), 0, 2 * T);
    close(m.mean, c);
    close(m.rms, Math.sqrt(c * c + (A * A) / 2));
    close(m.peakToPeak, 2 * A);
    close(m.max, c + A);
    close(m.min, c - A);
    close(m.frequency, 50, 1e-6);
    close(m.duty, 0.5, 1e-6);
    close(m.crest, (c + A) / Math.sqrt(c * c + (A * A) / 2));
  });
  for (const duty of [0.1, 0.3, 0.5, 0.8]) {
    it(`square 5 V / −2 V, duty ${duty}`, () => {
      const H = 5;
      const L = -2;
      const m = measureInterval(gen('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: H, low: L, duty })), 0, 3 * T);
      close(m.mean, L + duty * (H - L));
      close(m.rms, Math.sqrt(duty * H * H + (1 - duty) * L * L));
      close(m.peakToPeak, H - L);
      close(m.duty, duty, 1e-7);
      close(m.frequency, 50, 1e-6);
    });
  }
  it('triangle and sawtooth (±A about an offset): rms = √(offset² + A²/3)', () => {
    for (const kind of ['triangle', 'sawtooth'] as const) {
      const m = measureInterval(gen(kind, (d) => (d as { params: object }).params && Object.assign((d as { params: object }).params, { amplitude: 4, offset: 1 })), 0, T);
      close(m.mean, 1);
      close(m.rms, Math.sqrt(1 + 16 / 3));
      close(m.peakToPeak, 8);
    }
  });
  it('constant (DC) signal', () => {
    const m = measureInterval(gen('dc', (d) => d.generator === 'dc' && (d.params.level = 2.5)), 0, 1);
    close(m.mean, 2.5);
    close(m.rms, 2.5);
    close(m.peakToPeak, 0);
  });
});

describe('interval measurements over partial periods (the window is not a whole number of periods)', () => {
  it('sine: mean and RMS of [a, b] from the antiderivatives', () => {
    const A = 2;
    const w = 2 * Math.PI * 50;
    const a = 0.003;
    const b = 0.0137;
    const m = measureInterval(gen('sine', (d) => d.generator === 'sine' && Object.assign(d.params, { amplitude: A, offset: 0 })), a, b);
    close(m.mean, (A * (Math.cos(w * a) - Math.cos(w * b))) / (w * (b - a)));
    close(m.rms, Math.sqrt((A * A) / 2 - (A * A * (Math.sin(2 * w * b) - Math.sin(2 * w * a))) / (4 * w * (b - a))));
  });
  it('the result does not depend on where the window starts for a whole number of periods', () => {
    const s = gen('sine');
    const ref = measureInterval(s, 0, 0.04).rms;
    for (const t0 of [0.0013, 0.0071, 0.0199, 0.123]) close(measureInterval(s, t0, t0 + 0.04).rms, ref, 1e-9);
  });
});

describe('harmonic distortion of the textbook waveforms', () => {
  const thd = (kind: GeneratorDef['generator'], patch: (d: GeneratorDef) => void = () => {}) => harmonicSpectrum(gen(kind, patch), { f1: 50, periods: 1, t0: 0, maxOrder: 4000 });
  it('sine: no distortion', () => {
    expect(thd('sine').thd).toBeLessThan(1e-9);
  });
  it('square 50 %: THD = √(π²/8 − 1) = 48.34 %', () => {
    const s = thd('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: 1, low: -1, duty: 0.5 }));
    expect(s.thd).toBeCloseTo(Math.sqrt((Math.PI * Math.PI) / 8 - 1), 3);
    expect(s.fundamental).toBeCloseTo(4 / Math.PI, 9); // peak of the fundamental of a ±1 square wave
  });
  it('triangle: THD = √(π⁴/96 − 1) = 12.1 %', () => {
    expect(thd('triangle').thd).toBeCloseTo(Math.sqrt(Math.PI ** 4 / 96 - 1), 4);
  });
  it('sawtooth: THD = √(π²/6 − 1) = 80.3 %', () => {
    expect(thd('sawtooth').thd).toBeCloseTo(Math.sqrt((Math.PI * Math.PI) / 6 - 1), 3);
  });
  it('Parseval: rms² = dc² + Σ aₖ²/2 for a duty-30 % square wave', () => {
    const s = thd('square', (d) => d.generator === 'square' && Object.assign(d.params, { high: 4, low: 0, duty: 0.3 }));
    let sum = s.amp[0]! ** 2;
    for (let k = 1; k < s.amp.length; k++) sum += (s.amp[k]! ** 2) / 2;
    expect(Math.sqrt(sum)).toBeCloseTo(s.rms, 2);
    expect(s.dc).toBeCloseTo(1.2, 10);
    expect(s.rms).toBeCloseTo(Math.sqrt(0.3 * 16), 8);
  });
});

describe('power', () => {
  it('sinusoidal voltage and current with a phase angle φ: P = VI cos φ / 2, PF = cos φ, Q₁ = VI sin φ / 2', () => {
    const V = 10;
    const I = 2;
    const phi = 35;
    const v = gen('sine', (d) => d.generator === 'sine' && Object.assign(d.params, { amplitude: V, offset: 0 }));
    const i = gen('sine', (d) => {
      if (d.generator === 'sine') Object.assign(d.params, { amplitude: I, offset: 0 });
      d.timing.phaseDeg = -phi; // the current lags
    });
    const pm = powerMetrics(v, i, 0, 0.04, { f1: 50, periods: 2, t0: 0 });
    const c = Math.cos((phi * Math.PI) / 180);
    close(pm.p, (V * I * c) / 2, 1e-7);
    close(pm.s, (V * I) / 2, 1e-7);
    close(pm.pf, c, 1e-7);
    close(Math.abs(pm.q1), (V * I * Math.sin((phi * Math.PI) / 180)) / 2, 1e-6);
    close(Math.abs(pm.phi1Deg), phi, 1e-5);
    close(pm.dpf, c, 1e-7);
  });
  it('resistive load: P = S, PF = 1; quadrature: P = 0', () => {
    const v = gen('sine');
    const pm = powerMetrics(v, v, 0, 0.02);
    close(pm.pf, 1, 1e-9);
    const q = gen('sine', (d) => (d.timing.phaseDeg = 90));
    expect(Math.abs(powerMetrics(v, q, 0, 0.02).p)).toBeLessThan(1e-9);
  });
});

describe('edge measurements on a trapezoidal pulse (SPICE-style rise / width / fall)', () => {
  it('10–90 % rise = 0.8·tr, fall = 0.8·tf, width at 50 % = width + (tr + tf)/2', () => {
    const tr = 2e-3;
    const tf = 1e-3;
    const width = 5e-3;
    const p = gen('pulse', (d) => d.generator === 'pulse' && Object.assign(d.params, { high: 1, low: 0, width, rise: tr, fall: tf }));
    const m = edgeMetrics(p, 0, 0.1)!;
    expect(m.twoLevel).toBe(true);
    close(m.rise!.value, 0.8 * tr, 1e-4);
    close(m.fall!.value, 0.8 * tf, 1e-4);
    close(m.posWidth!.value, tr / 2 + width + tf / 2, 1e-4);
    expect(m.overshoot).toBeUndefined();
  });
});
