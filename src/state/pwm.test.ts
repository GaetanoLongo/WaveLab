import { beforeEach, describe, expect, it } from 'vitest';
import { measureInterval } from '../core/measure/measure';
import { autoYRange } from '../core/plot/viewport';
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

  it('DC reference (f1 = 0): constant duty, mean value = m·Vdc; refused for three-phase', () => {
    const c = make({ topology: 'full-bipolar', f1: 0, m: 0.5, fc: 1000 });
    // Whole carrier periods: mean of v_AB = m·Vdc.
    const sp = harmonicSpectrum(sig('v_{AB}'), { f1: 1000, periods: 1, t0: 0, maxOrder: 5 });
    expect(sp.dc).toBeCloseTo(expectedFundamental(c).value, 3);
    expect(expectedFundamental(c).label).toMatch(/mean/);
    actions.newProject();
    expect(actions.createPwm({ ...DEFAULT_PWM, topology: 'three-phase', f1: 0 })).toMatch(/DC reference/);
    expect(st().project.signals.length).toBe(0);
  });

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

describe('regression: delayed gate edges are not lost to rounding', () => {
  it('three-phase DPWM with dead time: every dead-time edge is a jump, and the load currents stay fast', () => {
    actions.newProject();
    actions.createPwm({ ...DEFAULT_PWM, topology: 'three-phase', reference: 'dpwm', carrier: 'triangle', load: true, deadTime: 2e-6 });
    const p = st().project;
    const get = (n: string) => compiled(p.signals.find((x) => x.name === n)!, p);
    // The turn-on edge of S_B+ is the gate edge plus the dead time (found by value probing).
    const s = get('S_{B+}');
    const jumps = s.features(0, 0.02).features.filter((f) => f.kind === 'jump');
    // Every change of the sampled value must coincide with a reported jump.
    const edges: number[] = [];
    let prev = s.value(0);
    for (let t = 1e-7; t < 0.02; t += 1e-7) {
      const v = s.value(t);
      if (v !== prev) edges.push(t);
      prev = v;
    }
    expect(edges.length).toBeGreaterThan(10);
    for (const e of edges) expect(jumps.some((j) => Math.abs(j.t - e) < 2e-7)).toBe(true);
    // The load current used to take ~17 s (numerical integration over a hidden step).
    const t0 = performance.now();
    get('i_{c}').features(0, 0.04);
    expect(performance.now() - t0).toBeLessThan(4000);
    // Measuring a load current (RMS, mean, …) used to need ~1 s each: a hidden step in its input
    // forced numerical integration over every segment.
    const t1 = performance.now();
    for (const n of ['i_{a}', 'i_{b}']) measureInterval(get(n), -0.0004, 0.04);
    expect(performance.now() - t1).toBeLessThan(1500);
  }, 30000);

  it('non-commensurate carrier and reference: the automatic vertical range stays cheap', () => {
    actions.newProject();
    actions.createPwm({ ...DEFAULT_PWM, topology: 'three-phase', reference: 'dpwm', carrier: 'triangle', fc: 14, f1: 170.37, load: true, deadTime: 2e-6 });
    const p = st().project;
    const sigs = p.signals.filter((x) => /^i_\{[abc]\}$/.test(x.name)).map((x) => compiled(x, p));
    expect(sigs.length).toBe(3);
    const t0 = performance.now();
    const r = autoYRange(sigs); // used to need ~20 s: the load currents over their natural 1 s window
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(r[1]).toBeGreaterThan(r[0]);
  }, 30000);
});
