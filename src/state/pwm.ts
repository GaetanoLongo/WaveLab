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

/**
 * Three-phase modulating signals: sinusoidal, or sinusoid + a common zero-sequence term
 * (cancels in the line-to-line voltages, extends the linear range to m = 2/√3):
 *  - third: v₀ = (m/6)·sin 3θ (third-harmonic injection, optimum 1/6)
 *  - svpwm: v₀ = −(max + min)/2 (min-max injection, equivalent to space-vector PWM)
 *  - dpwm:  v₀ = 1 − max if max + min ≥ 0, else −1 − min (DPWM1: each phase clamped to a
 *    DC rail for 60° around its peak, so it does not switch there)
 */
export type PwmReference = 'sine' | 'third' | 'svpwm' | 'dpwm';
export const PWM_REFERENCE_LABELS: Record<PwmReference, string> = {
  sine: 'Sinusoidal (SPWM)',
  third: 'Third-harmonic injection (1/6)',
  svpwm: 'Space vector (min-max injection)',
  dpwm: 'Discontinuous (DPWM1, 60° clamping)',
};

export interface PwmConfig {
  topology: PwmTopology;
  carrier: 'triangle' | 'saw-up' | 'saw-down';
  /** Carrier frequency (Hz). */
  fc: number;
  /** Reference (modulating) frequency (Hz). 0 = a DC reference (single-phase topologies only): the output is then a constant-duty pulse train. */
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
  /** Three-phase modulating signals. */
  reference: PwmReference;
  /** Load current from an R-L(-E) load (series for single-phase, balanced star for three-phase). */
  load: boolean;
  r: number;
  l: number;
  /** Back-EMF (single-phase loads). */
  e: number;
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
  reference: 'sine',
  load: false,
  r: 10,
  l: 0.01,
  e: 0,
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

  const gen = (name: string, unit: string, build: (d: GeneratorSignalDef) => void, kind: 'triangle' | 'sawtooth' | 'sine' | 'dc'): GeneratorSignalDef => {
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
        if (d.generator === 'dc') {
          d.params.level = c.m;
          return;
        }
        d.timing.frequency = c.f1;
        d.timing.phaseDeg = c.phaseDeg + ph;
        if (d.generator === 'sine') Object.assign(d.params, { amplitude: c.m, offset: 0 });
      },
      c.f1 > 0 ? 'sine' : 'dc',
    ),
  );

  // Three-phase zero-sequence injection: the comparators use v_ref,k + v₀.
  const ref3 = c.topology === 'three-phase' && c.reference !== 'sine' ? c.reference : null;
  let mods: Array<GeneratorSignalDef | DerivedSignalDef> = refs;
  let zero: GeneratorSignalDef | DerivedSignalDef | null = null;
  if (ref3) {
    refs.forEach((r, i) => (r.name = `v_{${phases[i]![0]}}`));
    const [ra, rb, rc] = refs.map((r) => ref(r.id)) as [string, string, string];
    const mx = `max(${ra}, ${rb}, ${rc})`;
    const mn = `min(${ra}, ${rb}, ${rc})`;
    if (ref3 === 'third') {
      zero = gen(
        'v_{0}',
        '',
        (d) => {
          d.timing.frequency = 3 * c.f1;
          d.timing.phaseDeg = 3 * c.phaseDeg;
          if (d.generator === 'sine') Object.assign(d.params, { amplitude: c.m / 6, offset: 0 });
        },
        'sine',
      );
    } else if (ref3 === 'svpwm') {
      zero = der('v_{0}', '', `-(${mx} + ${mn}) / 2`);
    } else {
      // Rails at ±(1 + 1e-6): a clamped reference must not touch the carrier peak, or the
      // comparator would emit zero-width pulses there. The pole stays on the rail either way.
      zero = der('v_{0}', '', `step(${mx} + ${mn}) * (1.000001 - ${mx}) + (1 - step(${mx} + ${mn})) * (-1.000001 - ${mn})`);
    }
    zero.style.dash = 'dashed';
    mods = phases.map(([k], i) => der(`v_{ref,${k}}`, '', `${ref(refs[i]!.id)} + ${ref(zero!.id)}`));
  }

  const legs: Array<{ name: string; gate: DerivedSignalDef }> = [];
  if (c.topology === 'three-phase') {
    phases.forEach(([k], i) => legs.push({ name: k.toUpperCase(), gate: der(`G_{${k.toUpperCase()}}`, '', `${ref(mods[i]!.id)} > ${ref(carrier.id)}`) }));
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
    } else {
      // Without dead time the upper switch follows the leg command; listed for symmetry.
      gates.push(der(`S_{${name}+}`, '', g));
      if (c.complementary) gates.push(der(`S_{${name}-}`, '', `!${g}`));
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

  const axis0 = { auto: true, min: -1, max: 1, title: '' };
  // Load currents (ideal voltages), and with dead time the realistic pole voltages.
  const vdc = siLiteral(c.vdc);
  const tauL = siLiteral(c.l / c.r, 15);
  const currentOf = (v: string, name: string, withE: boolean) => {
    const drive = withE && c.e !== 0 ? `(${v} - ${siLiteral(c.e)}) / ${siLiteral(c.r)}` : `${v} / ${siLiteral(c.r)}`;
    return der(name, 'A', c.l > 0 ? `lowpass(${drive}, ${tauL})` : drive);
  };
  /** Load voltage(s) from pole voltages: v_out, v_AB, or the star phase voltages v_xN. */
  const loadVoltages = (pv: DerivedSignalDef[], suffix: string): DerivedSignalDef[] => {
    if (c.topology === 'half') return [der(`v_{out${suffix}}`, 'V', `${ref(pv[0]!.id)} - ${siLiteral(c.vdc / 2)}`)];
    if (c.topology !== 'three-phase') return [der(`v_{AB${suffix}}`, 'V', `${ref(pv[0]!.id)} - ${ref(pv[1]!.id)}`)];
    const [a, b, cc] = pv.map((x) => ref(x.id)) as [string, string, string];
    return [
      der(`v_{aN${suffix}}`, 'V', `(2 * ${a} - ${b} - ${cc}) / 3`),
      der(`v_{bN${suffix}}`, 'V', `(2 * ${b} - ${cc} - ${a}) / 3`),
      der(`v_{cN${suffix}}`, 'V', `(2 * ${cc} - ${a} - ${b}) / 3`),
    ];
  };
  const loadGroups: Panel[] = [];
  const hidden: DerivedSignalDef[] = [];
  if (c.load && c.r > 0) {
    const three = c.topology === 'three-phase';
    const realistic = c.deadTime > 0 && c.complementary;
    const curName = (k: number, suffix = '') => (three ? `i_{${'abc'[k]}${suffix}}` : `i_{o${suffix}}`);
    // Leg currents (positive out of the leg) for each load current.
    const legCurrent = (cur: DerivedSignalDef[], i: number) =>
      three ? ref(cur[i]!.id) : i === 0 ? ref(cur[0]!.id) : `-${ref(cur[0]!.id)}`;
    const vIdeal = three ? loadVoltages(poles, '') : outputs;
    if (three) hidden.push(...vIdeal);
    const iIdeal = vIdeal.map((v, k) => currentOf(ref(v.id), curName(k, realistic ? ',ideal' : ''), !three));
    if (!realistic) {
      loadGroups.push({ id: newId('g'), name: 'Load current', share: iIdeal.length > 1, traces: iIdeal.map((s) => ({ signalId: s.id })), yAxis: axis0 });
      if (three) loadGroups.unshift({ id: newId('g'), name: 'Load phase voltages', share: false, collapsed: true, traces: vIdeal.map((s) => ({ signalId: s.id })), yAxis: axis0 });
    } else {
      // During dead time both switches are off and the current flows through a diode:
      // the pole goes to V_dc if the leg current is negative, to 0 if positive. The
      // current direction is taken from the ideal-voltage current (first-order model).
      hidden.push(...iIdeal);
      const S = (leg: string, sign: '+' | '-') => gates.find((g) => g.name === `S_{${leg}${sign}}`)!;
      const realPoles = legs.map(({ name }, i) =>
        der(
          `v_{${name}0,dt}`,
          'V',
          `${vdc} * (${ref(S(name, '+').id)} + (1 - ${ref(S(name, '+').id)} - ${ref(S(name, '-').id)}) * (${legCurrent(iIdeal, i)} < 0))`,
        ),
      );
      const vReal = loadVoltages(realPoles, ',dt');
      const iReal = vReal.map((v, k) => currentOf(ref(v.id), curName(k), !three));
      loadGroups.push({ id: newId('g'), name: 'Voltages with dead time', share: false, traces: [...realPoles, ...vReal].map((s) => ({ signalId: s.id })), yAxis: axis0 });
      loadGroups.push({ id: newId('g'), name: 'Load current', share: iReal.length > 1, traces: iReal.map((s) => ({ signalId: s.id })), yAxis: axis0 });
    }
  }

  // Leg commands are intermediate signals: kept (and listed) but hidden by default.
  for (const l of legs) l.gate.style.visible = false;
  for (const h of hidden) h.style.visible = false;
  const axis = axis0;
  const groups: Panel[] = [
    { id: newId('g'), name: 'Modulation', share: true, traces: [carrier, ...mods, ...(zero ? [zero] : [])].map((s) => ({ signalId: s.id })), yAxis: axis },
    ...(ref3 ? [{ id: newId('g'), name: 'Sinusoidal references', share: true, collapsed: true, traces: refs.map((s) => ({ signalId: s.id })), yAxis: axis }] : []),
    { id: newId('g'), name: 'Leg commands', share: false, collapsed: true, traces: legs.map((l) => ({ signalId: l.gate.id })), yAxis: axis },
  ];
  // A signal belongs to one group per figure: those already listed in a load group stay there.
  const inLoadGroups = new Set(loadGroups.flatMap((g) => g.traces.map((t) => t.signalId)));
  const hiddenOnly = hidden.filter((s) => !inLoadGroups.has(s.id));
  if (hiddenOnly.length) groups.push({ id: newId('g'), name: 'Intermediate (ideal)', share: false, collapsed: true, traces: hiddenOnly.map((s) => ({ signalId: s.id })), yAxis: axis });
  if (gates.length) groups.push({ id: newId('g'), name: c.deadTime > 0 ? 'Gates (dead time)' : 'Gates', share: false, traces: gates.map((g) => ({ signalId: g.id })), yAxis: axis });
  groups.push({ id: newId('g'), name: c.load && c.deadTime > 0 && c.complementary ? 'Voltages (ideal)' : 'Voltages', share: false, traces: [...poles, ...outputs].map((s) => ({ signalId: s.id })), yAxis: axis });
  groups.push(...loadGroups);
  for (const r of ref3 ? refs : []) r.style.visible = false;
  return { signals, groups };
}

/** Largest m in the linear range: 1, or 2/√3 with zero-sequence injection (three-phase). */
export function linearLimit(c: PwmConfig): number {
  return c.topology === 'three-phase' && c.reference !== 'sine' ? 2 / Math.sqrt(3) : 1;
}

/** Expected fundamental amplitude of the main output for m ≤ 1 (linear range). */
export function expectedFundamental(c: PwmConfig): { label: string; value: number } {
  // (valid for m ≤ linearLimit(c))
  const what = c.f1 > 0 ? 'fundamental (peak)' : 'mean value';
  switch (c.topology) {
    case 'half':
      return { label: `v_out ${what}`, value: (c.m * c.vdc) / 2 };
    case 'full-bipolar':
    case 'full-unipolar':
      return { label: `v_AB ${what}`, value: c.m * c.vdc };
    case 'three-phase':
      return { label: `v_AB ${what}`, value: (Math.sqrt(3) / 2) * c.m * c.vdc };
  }
}
