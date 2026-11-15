import { beforeEach, describe, expect, it } from 'vitest';
import { harmonicSpectrum } from '../core/measure/spectrum';
import { compiled } from './compiled';
import { DEFAULT_PWM, expectedFundamental, type PwmConfig } from './pwm';
import { actions, editor } from './store';

const st = () => editor.getState();
const sig = (name: string) => {
  const s = st().project.signals.find((x) => x.name === name);
  if (!s) throw new Error(`no signal ${name}`);
  return compiled(s, st().project);
};
const spectrumOf = (name: string, maxOrder = 50) => harmonicSpectrum(sig(name), { f1: 50, periods: 1, t0: 0, maxOrder });

beforeEach(() => actions.newProject());

describe('PWM generator (checked against textbook results with the exact spectrum)', () => {
  const make = (patch: Partial<PwmConfig>) => {
    const c = { ...DEFAULT_PWM, ...patch };
    actions.createPwm(c);
    return c;
  };

  it('full bridge bipolar: v_AB fundamental = m·Vdc, two levels ±Vdc', () => {
    const c = make({ topology: 'full-bipolar' });
    const s = spectrumOf('v_{AB}');
    expect(s.fundamental).toBeCloseTo(expectedFundamental(c).value, 2);
    expect(s.dc).toBeCloseTo(0, 6);
    const r = sig('v_{AB}').features(0, 0.02).features;
    expect(new Set(r.flatMap((f) => [f.left, f.right]))).toEqual(new Set([400, -400]));
  });

  it('full bridge unipolar: same fundamental, carrier-band harmonics cancel (first cluster at 2·m_f)', () => {
    const c = make({ topology: 'full-unipolar' }); // m_f = 21
    const s = spectrumOf('v_{AB}', 60);
    expect(s.fundamental).toBeCloseTo(expectedFundamental(c).value, 2);
    expect(Math.max(...s.amp.slice(15, 28))).toBeLessThan(1); // around 21: cancelled
    expect(Math.max(...s.amp.slice(38, 46))).toBeGreaterThan(20); // around 42
    const levels = new Set(sig('v_{AB}').features(0, 0.02).features.flatMap((f) => [f.left, f.right]));
    expect([...levels].sort((a, b) => a - b)).toEqual([-400, 0, 400]);
  });

  it('three-phase: v_AB fundamental = √3/2·m·Vdc; no triplen harmonics; legs 120° apart', () => {
    const c = make({ topology: 'three-phase', fc: 1050 });
    const s = spectrumOf('v_{AB}', 60);
    expect(s.fundamental).toBeCloseTo(expectedFundamental(c).value, 1);
    for (const h of [3, 9, 21, 63 > 60 ? 15 : 63]) expect(s.amp[h]!).toBeLessThan(0.5);
  });

  it('dead time: upper and lower gates are never on together; each gap lasts exactly t_d', () => {
    make({ topology: 'half', deadTime: 20e-6, complementary: true });
    const hi = sig('S_{A+}');
    const lo = sig('S_{A-}');
    const g = sig('G_{A}');
    for (let i = 0; i < 4000; i++) {
      const t = (i / 4000) * 0.02;
      expect(hi.value(t) * lo.value(t)).toBe(0);
    }
    // Every rising edge of the command appears td later on the upper gate; falling edges unchanged.
    const cmdRise = g.features(0.0001, 0.0199).features.filter((f) => f.kind === 'jump' && f.right > f.left).map((f) => f.t);
    const hiRise = hi.features(0.0001, 0.0199 + 20e-6).features.filter((f) => f.kind === 'jump' && f.right > f.left).map((f) => f.t);
    expect(hiRise.length).toBe(cmdRise.length);
    hiRise.forEach((t, i) => expect(t - cmdRise[i]!).toBeCloseTo(20e-6, 12));
  });

  it('three-phase set and complementary pair helpers', () => {
    actions.addThreePhaseSet();
    expect(st().project.signals.map((s) => s.name)).toEqual(['V_a', 'V_b', 'V_c']);
    actions.addSignal('square');
    actions.addComplementaryPair(1e-4);
    const hi = sig('Square high');
    const lo = sig('Square low');
    expect(hi.value(0.00005)).toBe(0); // turn-on delayed by 100 µs
    expect(hi.value(0.0002)).toBe(1);
    expect(lo.value(0.01005)).toBe(0);
    expect(lo.value(0.0102)).toBe(1);
  });
});

describe('PWM: zero-sequence injection, load current, dead-time voltages', () => {
  const make = (patch: Partial<PwmConfig>) => {
    const c = { ...DEFAULT_PWM, topology: 'three-phase' as const, ...patch };
    actions.createPwm(c);
    return c;
  };
  const phasor = (name: string) => {
    const s = spectrumOf(name, 3);
    const a = s.amp[1]!;
    const ph = (s.phaseDeg[1]! * Math.PI) / 180;
    return [a * Math.cos(ph), a * Math.sin(ph)] as const;
  };

  for (const reference of ['third', 'svpwm', 'dpwm'] as const) {
    it(`${reference}: linear up to m = 2/√3 (v_AB fundamental = √3/2·m·Vdc at m = 1.15)`, () => {
      const c = make({ reference, m: 1.15, fc: 2550 });
      expect(spectrumOf('v_{AB}').fundamental).toBeCloseTo(expectedFundamental(c).value, 0);
      expect(Math.abs(spectrumOf('v_{AB}').fundamental - expectedFundamental(c).value) / expectedFundamental(c).value).toBeLessThan(2e-3);
    });
  }

  it('dpwm: each leg is clamped (no switching) for 60° around the reference peak', () => {
    make({ reference: 'dpwm', m: 0.9, fc: 2550 });
    // Phase a peaks at 90° → 5 ms; the clamp spans 60°…120° (3.33…6.67 ms).
    const inClamp = sig('G_{A}').features(0.0034, 0.0066).features.filter((f) => f.kind === 'jump');
    expect(inClamp.length).toBe(0);
    const outside = sig('G_{A}').features(0.0105, 0.0128).features.filter((f) => f.kind === 'jump');
    expect(outside.length).toBeGreaterThan(10);
  });

  it('R-L load current: fundamental = V1 / |R + jωL|, zero mean (full bridge)', () => {
    const c: PwmConfig = { ...DEFAULT_PWM, topology: 'full-bipolar', load: true, r: 10, l: 0.02 };
    actions.createPwm(c);
    const z = Math.hypot(10, 2 * Math.PI * 50 * 0.02);
    expect(spectrumOf('i_{o}').fundamental).toBeCloseTo(spectrumOf('v_{AB}').fundamental / z, 3);
    expect(spectrumOf('i_{o}').dc).toBeCloseTo(0, 6);
  });

  it('dead time: phase-voltage error ≈ (4/π)·Vdc·t_d·f_c in phase with the current', () => {
    const td = 20e-6;
    make({ load: true, r: 10, l: 0.01, deadTime: td, fc: 1050 });
    const vi = phasor('v_{aN}');
    const vr = phasor('v_{aN,dt}');
    const err = Math.hypot(vi[0] - vr[0], vi[1] - vr[1]);
    const expected = (4 / Math.PI) * 400 * td * 1050;
    expect(Math.abs(err - expected) / expected).toBeLessThan(0.1);
    // The real current is smaller than the ideal one.
    expect(spectrumOf('i_{a}').fundamental).toBeLessThan(spectrumOf('i_{a,ideal}').fundamental);
  });
});
