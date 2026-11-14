/**
 * PWM generator: builds a complete, fully editable set of ordinary signals
 * (carrier, references, gate signals with optional dead time, pole and output
 * voltages) for common carrier-based modulations.
 *
 * Conventions (same as ModulationToy, the author's PWM tool):
 *  - carrier from −1 to +1; triangle centre-aligned (valley at the start of each
 *    carrier period), or rising/falling sawtooth (trailing/leading edge)
 *  - m = reference peak / carrier peak; m_f = f_c / f_1
 *  - half bridge: v_out = v_A0 − V_dc/2 (±V_dc/2)
 *  - full bridge bipolar: leg B = NOT leg A (v_AB = ±V_dc)
 *  - full bridge unipolar: leg B compares −ref with the same carrier (3-level v_AB)
 *  - three-phase: references at 0°, −120°, +120°; pole voltages v_x0 (0/V_dc) and
 *    line-to-line v_AB, v_BC, v_CA
 *  - dead time: both turn-on edges of each complementary pair delayed by t_d,
 *    turn-off edges unchanged:  S_hi = and(G, delay(G, td)), S_lo = and(!G, delay(!G, td))
 *  - voltages are ideal (from the switching commands, ignoring dead time: during
 *    dead time the output depends on the load current's direction).
 */

import { defaultGenerator } from '../core/model/defaults';
import { paletteColor } from '../core/model/palette';
import type { DerivedSignalDef, GeneratorSignalDef, Panel, SignalDef } from '../core/model/project';
import { siLiteral } from '../core/units/si';

export type PwmTopology = 'half' | 'full-bipolar' | 'full-unipolar' | 'three-phase';

export interface PwmConfig {
  topology: PwmTopology;
  carrier: 'triangle' | 'saw-up' | 'saw-down';
  /** Carrier frequency (Hz). */
  fc: number;
  /** Reference (modulating) frequency (Hz). */
  f1: number;
  /** Modulation index (reference peak / carrier peak). */
  m: number;
  /** Reference phase (degrees). */
  phaseDeg: number;
  vdc: number;
  /** Dead time (s); 0 = no complementary pairs with dead time. */
  deadTime: number;
  /** Also create the lower (complementary) gate signals. */
  complementary: boolean;
}

export const DEFAULT_PWM: PwmConfig = {
  topology: 'full-unipolar',
  carrier: 'triangle',
  fc: 1050,
  f1: 50,
  m: 0.8,
  phaseDeg: 0,
  vdc: 400,
  deadTime: 0,
  complementary: true,
};

export interface PwmBuild {
  signals: SignalDef[];
  groups: Panel[];
}

/** Build the signals and groups for a PWM configuration (ids from `newId`). */
export function buildPwm(c: PwmConfig, newId: (prefix: string) => string, colorStart = 0): PwmBuild {
  const signals: SignalDef[] = [];
  let colour = colorStart;
  const style = (lw = 1.6) => ({ color: paletteColor(colour++), lineWidth: lw, dash: 'solid' as const, visible: true, showInLegend: true });
  const ref = (id: string) => `#{${id}}`;

  const gen = (name: string, unit: string, build: (d: GeneratorSignalDef) => void, kind: 'triangle' | 'sawtooth' | 'sine'): GeneratorSignalDef => {
    const d: GeneratorSignalDef = {
      id: newId('s'),
      name,
      unit,
      locked: false,
      style: style(),
      kind: 'generator',
      ...defaultGenerator(kind),
    };
    build(d);
    signals.push(d);
    return d;
  };
  const der = (name: string, unit: string, expr: string, high = 1, low = 0): DerivedSignalDef => {
    const d: DerivedSignalDef = {
      id: newId('d'),
      name,
      unit,
      locked: false,
      style: style(),
      kind: 'derived',
      expr,
      logicHigh: high,
      logicLow: low,
      threshold: 0.5,
      resolution: null,
    };
    signals.push(d);
    return d;
  };

  // Carrier
  const carrier = gen(
    'Carrier',
    '',
    (d) => {
      d.timing.frequency = c.fc;
      if (d.generator === 'sawtooth') d.params.slope = c.carrier === 'saw-down' ? 'falling' : 'rising';
      if (d.generator === 'triangle' || d.generator === 'sawtooth') Object.assign(d.params, { amplitude: 1, offset: 0 });
    },
    c.carrier === 'triangle' ? 'triangle' : 'sawtooth',
  );

  // References and leg comparisons
  const phases = c.topology === 'three-phase' ? [['a', 0], ['b', -120], ['c', 120]] as const : ([['a', 0]] as const);
  const refs = phases.map(([k, ph]) =>
    gen(
      phases.length > 1 ? `v_{ref,${k}}` : 'v_{ref}',
      '',
      (d) => {
        d.timing.frequency = c.f1;
        d.timing.phaseDeg = c.phaseDeg + ph;
        if (d.generator === 'sine') Object.assign(d.params, { amplitude: c.m, offset: 0 });
      },
      'sine',
    ),
  );

  const legs: Array<{ name: string; gate: DerivedSignalDef }> = [];
  if (c.topology === 'three-phase') {
    phases.forEach(([k], i) => legs.push({ name: k.toUpperCase(), gate: der(`G_{${k.toUpperCase()}}`, '', `${ref(refs[i]!.id)} > ${ref(carrier.id)}`) }));
  } else {
    const gA = der('G_{A}', '', `${ref(refs[0]!.id)} > ${ref(carrier.id)}`);
    legs.push({ name: 'A', gate: gA });
    if (c.topology === 'full-bipolar') legs.push({ name: 'B', gate: der('G_{B}', '', `!${ref(gA.id)}`) });
    if (c.topology === 'full-unipolar') legs.push({ name: 'B', gate: der('G_{B}', '', `-${ref(refs[0]!.id)} > ${ref(carrier.id)}`) });
  }

  // Switch gate signals (upper/lower with dead time)
  const gates: DerivedSignalDef[] = [];
  const td = siLiteral(c.deadTime);
  for (const { name, gate } of legs) {
    const g = ref(gate.id);
    if (c.deadTime > 0) {
      gates.push(der(`S_{${name}+}`, '', `and(${g}, delay(${g}, ${td}))`));
      if (c.complementary) gates.push(der(`S_{${name}-}`, '', `and(!${g}, delay(!${g}, ${td}))`));
    } else if (c.complementary) {
      gates.push(der(`S_{${name}-}`, '', `!${g}`));
    }
  }

  // Ideal pole and output voltages
  const poles = legs.map(({ name, gate }) => der(`v_{${name}0}`, 'V', `${ref(gate.id)} * ${siLiteral(c.vdc)}`));
  const outputs: DerivedSignalDef[] = [];
  if (c.topology === 'half') outputs.push(der('v_{out}', 'V', `${ref(poles[0]!.id)} - ${siLiteral(c.vdc / 2)}`));
  if (c.topology === 'full-bipolar' || c.topology === 'full-unipolar') outputs.push(der('v_{AB}', 'V', `${ref(poles[0]!.id)} - ${ref(poles[1]!.id)}`));
  if (c.topology === 'three-phase') {
    const [a, b, cc] = poles;
    outputs.push(der('v_{AB}', 'V', `${ref(a!.id)} - ${ref(b!.id)}`));
    outputs.push(der('v_{BC}', 'V', `${ref(b!.id)} - ${ref(cc!.id)}`));
    outputs.push(der('v_{CA}', 'V', `${ref(cc!.id)} - ${ref(a!.id)}`));
  }

  // Leg commands are intermediate signals: kept (and listed) but hidden by default.
  for (const l of legs) l.gate.style.visible = false;
  const axis = { auto: true, min: -1, max: 1, title: '' };
  const groups: Panel[] = [
    { id: newId('g'), name: 'Modulation', share: true, traces: [carrier, ...refs].map((s) => ({ signalId: s.id })), yAxis: axis },
    { id: newId('g'), name: 'Leg commands', share: false, collapsed: true, traces: legs.map((l) => ({ signalId: l.gate.id })), yAxis: axis },
  ];
  if (gates.length) groups.push({ id: newId('g'), name: c.deadTime > 0 ? 'Gates (dead time)' : 'Gates', share: false, traces: gates.map((g) => ({ signalId: g.id })), yAxis: axis });
  groups.push({ id: newId('g'), name: 'Voltages', share: false, traces: [...poles, ...outputs].map((s) => ({ signalId: s.id })), yAxis: axis });
  return { signals, groups };
}

/** Expected fundamental amplitude of the main output for m ≤ 1 (linear range). */
export function expectedFundamental(c: PwmConfig): { label: string; value: number } {
  switch (c.topology) {
    case 'half':
      return { label: 'v_out fundamental (peak)', value: (c.m * c.vdc) / 2 };
    case 'full-bipolar':
    case 'full-unipolar':
      return { label: 'v_AB fundamental (peak)', value: c.m * c.vdc };
    case 'three-phase':
      return { label: 'v_AB fundamental (peak)', value: (Math.sqrt(3) / 2) * c.m * c.vdc };
  }
}
