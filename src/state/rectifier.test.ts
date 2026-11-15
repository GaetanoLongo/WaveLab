import { beforeEach, describe, expect, it } from 'vitest';
import { measureInterval } from '../core/measure/measure';
import { compiled } from './compiled';
import { DEFAULT_RECTIFIER, expectedOutput, type RectifierConfig, type RectifierTopology } from './rectifier';
import { actions, editor } from './store';

const st = () => editor.getState();
const sig = (name: string) => {
  const s = st().project.signals.find((x) => x.name === name);
  if (!s) throw new Error(`no signal ${name}`);
  return compiled(s, st().project);
};

beforeEach(() => actions.newProject());

describe('Rectifiers and phase control (textbook averages)', () => {
  const cases: Array<[RectifierTopology, number]> = [
    ['half-diode', 0],
    ['full-diode', 0],
    ['half-scr', 45],
    ['full-scr', 60],
    ['full-scr-cont', 30],
    ['full-scr-cont', 120],
    ['three-diode', 0],
    ['three-scr', 30],
    ['three-scr', 75],
  ];
  for (const [topology, alphaDeg] of cases) {
    it(`${topology}, α = ${alphaDeg}°`, () => {
      const c: RectifierConfig = { ...DEFAULT_RECTIFIER, topology, alphaDeg };
      actions.createRectifier(c);
      const out = sig(topology.startsWith('three') ? 'v_{dc}' : 'v_o');
      const m = measureInterval(out, 0, 0.02);
      expect(m.mean).toBeCloseTo(expectedOutput(c).value, 6);
    });
  }

  it('AC voltage controller: RMS formula', () => {
    const c: RectifierConfig = { ...DEFAULT_RECTIFIER, topology: 'ac-controller', alphaDeg: 90 };
    actions.createRectifier(c);
    const m = measureInterval(sig('v_o'), 0, 0.02);
    expect(m.rms).toBeCloseTo(expectedOutput(c).value, 6);
    expect(expectedOutput(c).value).toBeCloseTo(230 / Math.SQRT2, 9);
    expect(m.mean).toBeCloseTo(0, 9);
  });

  it('R-L load current: mean = mean(v_o)/R, smooth (lowpass)', () => {
    const c: RectifierConfig = { ...DEFAULT_RECTIFIER, topology: 'full-scr-cont', alphaDeg: 30, load: true, r: 10, l: 0.1, e: 0 };
    actions.createRectifier(c);
    const i = measureInterval(sig('i_o'), 0, 0.01);
    expect(i.mean).toBeCloseTo(expectedOutput(c).value / 10, 6);
    expect(i.min).toBeGreaterThan(0); // continuous conduction holds for this load
  });
});
