/**
 * Analog modulation set: message, carrier and the modulated signal as ordinary
 * editable signals.
 *
 *   AM (DSB-FC):  v = (1 + μ·m(t))·A_c sin(ω_c t)          envelope ±A_c(1 + μ·m)
 *   DSB-SC:       v = m(t)·A_c sin(ω_c t)
 *   PM:           v = A_c sin(θ_c + k_p·m(t))                k_p = peak phase deviation (rad)
 *   FM:           v = A_c sin(θ_c + 2π·Δf·∫m dt)             Δf = peak frequency deviation
 *
 * m(t) is normalised to ±1. θ_c = ω_c t is a 0…2π ramp (sawtooth) rather than `t`, so the
 * result stays periodic (period = LCM of the carrier and message periods) and the exact
 * spectrum applies: with a sine message the FM/PM lines are A_c·|J_n(β)| at f_c ± n·f_m.
 */

import { siLiteral } from '../core/units/si';
import { setBuilder, type SignalSet } from './builder';

export type ModulationKind = 'am' | 'dsb' | 'fm' | 'pm';
export const MODULATION_LABELS: Record<ModulationKind, string> = {
  am: 'AM (DSB with carrier)',
  dsb: 'DSB-SC (suppressed carrier)',
  fm: 'FM',
  pm: 'PM',
};

export interface ModulationConfig {
  kind: ModulationKind;
  fc: number;
  ac: number;
  message: 'sine' | 'square' | 'triangle';
  fm: number;
  /** AM modulation index μ. */
  mu: number;
  /** FM peak frequency deviation Δf (Hz). */
  deviation: number;
  /** PM peak phase deviation k_p (rad). */
  kp: number;
}

export const DEFAULT_MODULATION: ModulationConfig = {
  kind: 'am',
  fc: 1000,
  ac: 1,
  message: 'sine',
  fm: 100,
  mu: 0.5,
  deviation: 200,
  kp: 1,
};

export function buildModulation(c: ModulationConfig, newId: (prefix: string) => string, colorStart = 0): SignalSet {
  const B = setBuilder(newId, colorStart);
  const { ref, gen, der, group } = B;
  const L = (v: number) => siLiteral(v, 15);

  const msg =
    c.message === 'sine'
      ? gen('m', '', 'sine', (d) => {
          d.timing.frequency = c.fm;
          Object.assign(d.params, { amplitude: 1, offset: 0 });
        })
      : c.message === 'square'
        ? gen('m', '', 'square', (d) => {
            d.timing.frequency = c.fm;
            Object.assign(d.params, { high: 1, low: -1, duty: 0.5 });
          })
        : gen('m', '', 'triangle', (d) => {
            d.timing.frequency = c.fm;
            Object.assign(d.params, { amplitude: 1, offset: 0 });
          });
  const m = ref(msg);
  const groups = [group('Message', [msg])];

  if (c.kind === 'am' || c.kind === 'dsb') {
    const car = gen('c', 'V', 'sine', (d) => {
      d.timing.frequency = c.fc;
      Object.assign(d.params, { amplitude: c.ac, offset: 0 });
    });
    car.style.visible = false;
    groups.push(group('Carrier', [car], { collapsed: true }));
    if (c.kind === 'am') {
      const env = der('e_{+}', 'V', `${L(c.ac)} * (1 + ${L(c.mu)} * ${m})`);
      const envN = der('e_{-}', 'V', `-${ref(env)}`);
      for (const e of [env, envN]) (e.style.dash = 'dashed'), (e.style.lineWidth = 1.2), (e.style.color = '#5b6577'), (e.style.showInLegend = false);
      const v = der('v_{AM}', 'V', `(1 + ${L(c.mu)} * ${m}) * ${ref(car)}`);
      groups.push(group('Modulated', [v, env, envN], { share: true }));
    } else {
      groups.push(group('Modulated', [der('v_{DSB}', 'V', `${m} * ${ref(car)}`)]));
    }
  } else {
    const theta = gen('\\theta_{c}', 'rad', 'sawtooth', (d) => {
      d.timing.frequency = c.fc;
      Object.assign(d.params, { amplitude: Math.PI, offset: Math.PI, slope: 'rising' });
    });
    theta.style.visible = false;
    groups.push(group('Carrier phase', [theta], { collapsed: true }));
    const dev = c.kind === 'fm' ? `${L(2 * Math.PI * c.deviation)} * integral(${m})` : `${L(c.kp)} * ${m}`;
    groups.push(group('Modulated', [der(c.kind === 'fm' ? 'v_{FM}' : 'v_{PM}', 'V', `${L(c.ac)} * sin(${ref(theta)} + ${dev})`)]));
  }
  return { signals: B.signals, groups };
}

/** Modulation index β (FM: Δf/f_m; PM: k_p) and Carson bandwidth, for the dialog. */
export function modulationFigures(c: ModulationConfig): Array<[string, string]> {
  if (c.kind === 'am') {
    const eta = (c.mu * c.mu) / (2 + c.mu * c.mu);
    return [
      ['Sidebands', `f_c ± f_m`],
      ['Efficiency (sine message)', `${(eta * 100).toPrecision(3)} %`],
      ...(c.mu > 1 ? ([['Note', 'μ > 1: overmodulation (envelope crosses zero)']] as Array<[string, string]>) : []),
    ];
  }
  if (c.kind === 'dsb') return [['Sidebands', 'f_c ± f_m (no carrier line)']];
  const beta = c.kind === 'fm' ? c.deviation / c.fm : c.kp;
  const df = c.kind === 'fm' ? c.deviation : c.kp * c.fm;
  return [
    ['Modulation index β', beta.toPrecision(4)],
    ['Carson bandwidth 2(Δf + f_m)', `${(2 * (df + c.fm)).toPrecision(4)} Hz`],
  ];
}
