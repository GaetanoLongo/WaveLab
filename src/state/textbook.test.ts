/** Converter builders against hard-coded textbook values (independent of the app's own formulas). */

import { beforeEach, describe, expect, it } from 'vitest';
import { measureInterval } from '../core/measure/measure';
import { harmonicSpectrum } from '../core/measure/spectrum';
import { compiled } from './compiled';
import { DEFAULT_MODULATION } from './modulation';
import { DEFAULT_RECTIFIER, type RectifierTopology } from './rectifier';
import { actions, editor } from './store';

const sig = (name: string) => {
  const p = editor.getState().project;
  const s = p.signals.find((x) => x.name === name);
  if (!s) throw new Error(`no signal ${name}`);
  return compiled(s, p);
};
beforeEach(() => actions.newProject());

// Source: 230 V rms (phase), 50 Hz → peak 325.269 V; three-phase output = bridge DC voltage.
describe('rectifiers: output voltage of the standard circuits (Vs = 230 V rms)', () => {
  const cases: Array<[RectifierTopology, number, 'mean' | 'rms', number, string]> = [
    ['half-diode', 0, 'mean', 103.537, 'Vm/π'],
    ['half-diode', 0, 'rms', 162.635, 'Vm/2'],
    ['full-diode', 0, 'mean', 207.073, '2Vm/π'],
    ['full-diode', 0, 'rms', 230, 'Vm/√2'],
    ['half-scr', 60, 'mean', 77.653, 'Vm(1+cos α)/2π'],
    ['full-scr', 60, 'mean', 155.305, 'Vm(1+cos α)/π'],
    ['full-scr-cont', 30, 'mean', 179.328, '2Vm·cos α/π'],
    ['ac-controller', 90, 'rms', 162.635, 'Vs·√(1 − α/π + sin2α/2π) at α = 90°'],
    ['three-diode', 0, 'mean', 537.99, '3√3·Vm/π'],
    ['three-scr', 30, 'mean', 465.914, '3√3·Vm·cos α/π'],
  ];
  for (const [topology, alphaDeg, what, want, formula] of cases) {
    it(`${topology}, α = ${alphaDeg}°: ${what} = ${formula} = ${want} V`, () => {
      actions.createRectifier({ ...DEFAULT_RECTIFIER, topology, alphaDeg });
      const m = measureInterval(sig(topology.startsWith('three') ? 'v_{dc}' : 'v_o'), 0, 0.02);
      expect(Math.abs(m[what] - want)).toBeLessThan(0.01);
    });
  }
});

describe('AM and FM: the spectrum lines of the textbook', () => {
  const spectrum = (name: string) => harmonicSpectrum(sig(name), { f1: 100, periods: 1, t0: 0, maxOrder: 40 }); // carrier 1 kHz = order 10

  it('AM, μ = 0.5: carrier Ac, two sidebands μ·Ac/2 each, envelope Ac(1 ± μ)', () => {
    actions.createModulation({ ...DEFAULT_MODULATION, kind: 'am', mu: 0.5 });
    const s = spectrum('v_{AM}');
    expect(s.amp[10]).toBeCloseTo(1, 6);
    expect(s.amp[9]).toBeCloseTo(0.25, 6);
    expect(s.amp[11]).toBeCloseTo(0.25, 6);
    expect(s.amp[8]).toBeLessThan(1e-6);
    const m = measureInterval(sig('v_{AM}'), 0, 0.01);
    // The envelope peak 1.5 is reached only if a carrier peak falls on the message peak (here it nearly does).
    expect(m.max).toBeGreaterThan(1.49);
    expect(m.max).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(m.min).toBeLessThan(-1.49);
  });

  it('FM, β = Δf/fm = 2: the lines are Ac·Jₙ(2) = 0.2239, 0.5767, 0.3528, 0.1289, constant amplitude', () => {
    actions.createModulation({ ...DEFAULT_MODULATION, kind: 'fm', deviation: 200, fm: 100 });
    const s = spectrum('v_{FM}');
    expect(s.amp[10]).toBeCloseTo(0.22389, 4);
    expect(s.amp[11]).toBeCloseTo(0.57672, 4);
    expect(s.amp[12]).toBeCloseTo(0.35283, 4);
    expect(s.amp[13]).toBeCloseTo(0.12894, 4);
    expect(s.amp[9]).toBeCloseTo(0.57672, 4); // symmetric sidebands
    expect(measureInterval(sig('v_{FM}'), 0, 0.01).rms).toBeCloseTo(1 / Math.SQRT2, 6); // constant envelope
  });
});
