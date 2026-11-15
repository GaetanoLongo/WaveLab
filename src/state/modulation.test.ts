import { beforeEach, describe, expect, it } from 'vitest';
import { harmonicSpectrum } from '../core/measure/spectrum';
import { compiled } from './compiled';
import { DEFAULT_MODULATION, type ModulationConfig } from './modulation';
import { actions, editor } from './store';

const sig = (name: string) => {
  const p = editor.getState().project;
  const s = p.signals.find((x) => x.name === name);
  if (!s) throw new Error(`no signal ${name}`);
  return compiled(s, p);
};
// Spectrum in harmonics of f_m = 100 Hz: the carrier (1 kHz) is order 10.
const lines = (name: string) => harmonicSpectrum(sig(name), { f1: 100, periods: 1, t0: 0, maxOrder: 16 }).amp;
const make = (patch: Partial<ModulationConfig>) => actions.createModulation({ ...DEFAULT_MODULATION, ...patch });

beforeEach(() => actions.newProject());

describe('Modulation (exact spectra)', () => {
  it('AM: carrier A_c, sidebands A_c·μ/2', () => {
    make({ kind: 'am', mu: 0.5, ac: 2 });
    const a = lines('v_{AM}');
    expect(a[10]).toBeCloseTo(2, 9);
    expect(a[9]).toBeCloseTo(0.5, 9);
    expect(a[11]).toBeCloseTo(0.5, 9);
    expect(a[8]).toBeCloseTo(0, 9);
    expect(sig('e_{+}').value(0.0025)).toBeCloseTo(2 * 1.5, 12);
  });

  it('DSB-SC: no carrier line', () => {
    make({ kind: 'dsb' });
    const a = lines('v_{DSB}');
    expect(a[10]).toBeCloseTo(0, 9);
    expect(a[9]).toBeCloseTo(0.5, 9);
  });

  // J0(1), J1(1), J2(1), J3(1)
  const J = [0.7651976866, 0.4400505857, 0.1149034849, 0.0195633540];
  for (const kind of ['fm', 'pm'] as const) {
    it(`${kind.toUpperCase()} with β = 1: lines A_c·|J_n(1)| at f_c ± n·f_m`, () => {
      make({ kind, deviation: 100, kp: 1 });
      const a = lines(kind === 'fm' ? 'v_{FM}' : 'v_{PM}');
      for (let n = 0; n <= 3; n++) {
        expect(a[10 + n]).toBeCloseTo(J[n]!, 7);
        expect(a[10 - n]).toBeCloseTo(J[n]!, 7);
      }
    });
  }
});
