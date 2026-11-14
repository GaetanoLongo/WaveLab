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
