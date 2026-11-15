/**
 * Rectifiers and phase control: builds editable signals (source, firing reference,
 * output voltage and optionally the load current) for the textbook circuits.
 *
 * Conventions:
 *  - v_s = √2·V_s·sin(ωt) (single phase); three-phase v_a, v_b, v_c at 0°, −120°, +120°
 *    with V_s the RMS phase voltage.
 *  - θ = ωt in degrees, 0…360 (a rising sawtooth in step with v_s); the firing angle α
 *    is measured from the natural commutation point (the zero crossing of v_s for
 *    single-phase circuits, the crossing of two phase voltages for three-phase bridges).
 *  - Ideal devices (no drop, instant commutation, no source inductance).
 *  - R load: the "discontinuous" topologies are exact (current zero while blocked).
 *  - "Continuous" topologies assume a load current that never reaches zero (highly
 *    inductive load); the load current lowpass((v_o − E)/R, L/R) is then exact as long
 *    as it stays positive.
 */

import type { DerivedSignalDef, GeneratorSignalDef } from '../core/model/project';
import { siLiteral } from '../core/units/si';
import { setBuilder, type SignalSet } from './builder';

export type RectifierTopology =
  | 'half-diode'
  | 'full-diode'
  | 'half-scr'
  | 'full-scr'
  | 'full-scr-cont'
  | 'ac-controller'
  | 'three-diode'
  | 'three-scr';

export const RECTIFIER_LABELS: Record<RectifierTopology, string> = {
  'half-diode': 'Half-wave, diode',
  'full-diode': 'Full-wave bridge, diodes',
  'half-scr': 'Half-wave, thyristor (R load)',
  'full-scr': 'Full-wave bridge, thyristors (R load)',
  'full-scr-cont': 'Full-wave bridge, thyristors (continuous current)',
  'ac-controller': 'AC voltage controller (TRIAC, R load)',
  'three-diode': 'Three-phase bridge, diodes',
  'three-scr': 'Three-phase bridge, thyristors (continuous current)',
};

export interface RectifierConfig {
  topology: RectifierTopology;
  /** RMS source (phase) voltage. */
  vs: number;
  f: number;
  /** Firing angle (degrees). */
  alphaDeg: number;
  /** Load current: none, or R-L-E (L = 0 → resistive). */
  load: boolean;
  r: number;
  l: number;
  e: number;
}

export const DEFAULT_RECTIFIER: RectifierConfig = {
  topology: 'full-scr',
  vs: 230,
  f: 50,
  alphaDeg: 60,
  load: false,
  r: 10,
  l: 0.05,
  e: 0,
};

export const usesAlpha = (t: RectifierTopology) => !['half-diode', 'full-diode', 'three-diode'].includes(t);
export const isThreePhase = (t: RectifierTopology) => t === 'three-diode' || t === 'three-scr';

export function buildRectifier(c: RectifierConfig, newId: (prefix: string) => string, colorStart = 0): SignalSet {
  const B = setBuilder(newId, colorStart);
  const { ref, gen, der, group } = B;
  const vm = Math.SQRT2 * c.vs;
  const a = siLiteral(c.alphaDeg);
  const sine = (name: string, phaseDeg: number) =>
    gen(name, 'V', 'sine', (d) => {
      d.timing.frequency = c.f;
      d.timing.phaseDeg = phaseDeg;
      d.params.amplitude = vm;
      d.params.offset = 0;
    });

  const groups = [];
  let out: DerivedSignalDef;
  const firing: Array<GeneratorSignalDef | DerivedSignalDef> = [];

  if (!isThreePhase(c.topology)) {
    const vs = sine('v_s', 0);
    vs.style.dash = 'dashed';
    vs.style.lineWidth = 1.2;
    const s = ref(vs);
    let theta: GeneratorSignalDef | null = null;
    if (usesAlpha(c.topology)) {
      // θ = 0…360° in step with v_s (rising sawtooth starts at its minimum).
      theta = gen('\\theta', '°', 'sawtooth', (d) => {
        d.timing.frequency = c.f;
        d.params.amplitude = 180;
        d.params.offset = 180;
        d.params.slope = 'rising';
      });
      firing.push(theta);
    }
    const th = theta ? ref(theta) : '';
    // Conduction intervals in θ (degrees).
    const pos = `and(${th} >= ${a}, ${th} < 180)`; // positive half, fired at α
    const both = `or(${pos}, ${th} >= 180 + ${a})`; // both halves, fired at α and 180° + α
    switch (c.topology) {
      case 'half-diode':
        out = der('v_o', 'V', `max(${s}, 0)`);
        break;
      case 'full-diode':
        out = der('v_o', 'V', `abs(${s})`);
        break;
      case 'half-scr': {
        const g = der('G_{T}', '', pos);
        firing.push(g);
        out = der('v_o', 'V', `${s} * ${ref(g)}`);
        break;
      }
      case 'full-scr': {
        const g = der('G_{T}', '', both);
        firing.push(g);
        out = der('v_o', 'V', `abs(${s}) * ${ref(g)}`);
        break;
      }
      case 'full-scr-cont': {
        // T1/T2 conduct from α to 180° + α, T3/T4 for the rest of the cycle.
        const g = der('G_{T1,T2}', '', `and(${th} >= ${a}, ${th} < 180 + ${a})`);
        firing.push(g);
        out = der('v_o', 'V', `${s} * (2 * ${ref(g)} - 1)`);
        break;
      }
      case 'ac-controller': {
        const g = der('G_{T}', '', both);
        firing.push(g);
        out = der('v_o', 'V', `${s} * ${ref(g)}`);
        break;
      }
      default:
        throw new Error('unreachable');
    }
    for (const g of firing) g.style.visible = false;
    groups.push(group('Voltages', [vs, out], { share: true }));
  } else {
    const ph = [sine('v_a', 0), sine('v_b', -120), sine('v_c', 120)];
    const [va, vb, vc] = ph.map(ref) as [string, string, string];
    let vp: DerivedSignalDef;
    let vn: DerivedSignalDef;
    if (c.topology === 'three-diode') {
      vp = der('v_{P}', 'V', `max(${va}, ${vb}, ${vc})`);
      vn = der('v_{N}', 'V', `min(${va}, ${vb}, ${vc})`);
    } else {
      // Continuous conduction: each thyristor conducts for 120° starting α after its natural
      // commutation point (30° for T1 = phase a, top group; 210° for T4 = phase a, bottom group;
      // +120° for b, +240° for c). The conduction windows depend only on the angle θ, so they
      // are built from θ (exact instants; comparing phase voltages would leave instants where
      // no phase is selected).
      const theta = gen('\\theta', '°', 'sawtooth', (d) => {
        d.timing.frequency = c.f;
        d.params.amplitude = 180;
        d.params.offset = 180;
        d.params.slope = 'rising';
      });
      firing.push(theta);
      const th = ref(theta);
      const win = (startDeg: number) => {
        const lo = (((startDeg % 360) + 360) % 360);
        const hi = lo + 120;
        const L = siLiteral(lo, 15);
        return hi <= 360 ? `and(${th} >= ${L}, ${th} < ${siLiteral(hi, 15)})` : `or(${th} >= ${L}, ${th} < ${siLiteral(hi - 360, 15)})`;
      };
      const k = ['a', 'b', 'c'];
      const p = k.map((x, i) => der(`T_{${x}+}`, '', win(30 + c.alphaDeg + 120 * i)));
      const n = k.map((x, i) => der(`T_{${x}-}`, '', win(210 + c.alphaDeg + 120 * i)));
      firing.push(...p, ...n);
      for (const g of firing) g.style.visible = false;
      vp = der('v_{P}', 'V', `${va} * ${ref(p[0]!)} + ${vb} * ${ref(p[1]!)} + ${vc} * ${ref(p[2]!)}`);
      vn = der('v_{N}', 'V', `${va} * ${ref(n[0]!)} + ${vb} * ${ref(n[1]!)} + ${vc} * ${ref(n[2]!)}`);
    }
    for (const v of [vp, vn]) (v.style.color = '#1c2330'), (v.style.lineWidth = 2);
    for (const v of ph) v.style.lineWidth = 1.2;
    out = der('v_{dc}', 'V', `${ref(vp)} - ${ref(vn)}`);
    groups.push(group('Phase voltages', [...ph, vp, vn], { share: true }));
    groups.push(group('Output voltage', [out]));
  }

  if (firing.length) groups.splice(1, 0, group('Firing', firing, { collapsed: true }));
  if (c.load && c.r > 0) {
    const drive = c.e !== 0 ? `(${ref(out)} - ${siLiteral(c.e)}) / ${siLiteral(c.r)}` : `${ref(out)} / ${siLiteral(c.r)}`;
    const i = der('i_o', 'A', c.l > 0 ? `lowpass(${drive}, ${siLiteral(c.l / c.r, 15)})` : drive);
    groups.push(group('Load current', [i]));
  }
  return { signals: B.signals, groups };
}

/** Textbook average (or RMS for the AC controller) of the output voltage. */
export function expectedOutput(c: RectifierConfig): { label: string; value: number } {
  const vm = Math.SQRT2 * c.vs;
  const al = (c.alphaDeg * Math.PI) / 180;
  switch (c.topology) {
    case 'half-diode':
      return { label: 'Mean output V_m/π', value: vm / Math.PI };
    case 'full-diode':
      return { label: 'Mean output 2V_m/π', value: (2 * vm) / Math.PI };
    case 'half-scr':
      return { label: 'Mean output V_m(1 + cos α)/2π', value: (vm * (1 + Math.cos(al))) / (2 * Math.PI) };
    case 'full-scr':
      return { label: 'Mean output V_m(1 + cos α)/π', value: (vm * (1 + Math.cos(al))) / Math.PI };
    case 'full-scr-cont':
      return { label: 'Mean output 2V_m cos α/π', value: ((2 * vm) / Math.PI) * Math.cos(al) };
    case 'ac-controller':
      return { label: 'RMS output V_s√(1 − α/π + sin 2α/2π)', value: c.vs * Math.sqrt(Math.max(0, 1 - al / Math.PI + Math.sin(2 * al) / (2 * Math.PI))) };
    case 'three-diode':
      return { label: 'Mean output 3√3·V_m/π', value: (3 * Math.sqrt(3) * vm) / Math.PI };
    case 'three-scr':
      return { label: 'Mean output 3√3·V_m cos α/π', value: ((3 * Math.sqrt(3) * vm) / Math.PI) * Math.cos(al) };
  }
}
