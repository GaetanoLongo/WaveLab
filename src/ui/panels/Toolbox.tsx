/**
 * Left sidebar: waveform generators and presets. Entries not implemented yet are
 * shown disabled with the milestone that delivers them.
 */

import type { GeneratorSignalDef } from '../../core/model/project';
import type { GeneratorKind } from '../../core/model/signal-defs';
import { siLiteral } from '../../core/units/si';
import { actions } from '../../state/store';
import { openPwm } from './PwmDialog';
import { openRectifier } from './RectifierDialog';
import { openModulation } from './ModulationDialog';
import { WaveGlyph } from '../icons';

interface Entry {
  label: string;
  kind: GeneratorKind;
  name?: string;
  customize?: (d: GeneratorSignalDef) => void;
  title: string;
}

const BASIC: Entry[] = [
  { label: 'Sine', kind: 'sine', title: 'A·sin(ωt + φ) + offset' },
  { label: 'Cosine', kind: 'cosine', title: 'A·cos(ωt + φ) + offset' },
  { label: 'Square', kind: 'square', title: 'High/low levels with duty cycle' },
  { label: 'Pulse train', kind: 'pulse', title: 'Trapezoidal pulses: width, rise and fall times' },
  { label: 'Triangle', kind: 'triangle', title: 'Symmetric triangle, minimum at cycle start' },
  { label: 'Sawtooth', kind: 'sawtooth', title: 'Rising ramp with a falling edge each period' },
  {
    label: 'Inverted sawtooth',
    kind: 'sawtooth',
    name: 'Inv. sawtooth',
    customize: (d) => {
      if (d.generator === 'sawtooth') d.params.slope = 'falling';
    },
    title: 'Falling ramp with a rising edge each period',
  },
  { label: 'DC', kind: 'dc', title: 'Constant level' },
  { label: 'Exponential rise', kind: 'exponential', name: 'Exp rise', title: 'First-order rise 0 → 1 with time constant τ' },
  {
    label: 'Exponential decay',
    kind: 'exponential',
    name: 'Exp decay',
    customize: (d) => {
      if (d.generator === 'exponential') Object.assign(d.params, { initial: 1, final: 0 });
    },
    title: 'First-order decay 1 → 0 with time constant τ',
  },
  { label: 'Damped sinusoid', kind: 'damped', title: 'A·e^(−t/τ)·sin(ωt + φ)' },
  { label: 'Custom piecewise', kind: 'piecewise', title: 'Waveform through a table of points (linear or step), optionally repeating' },
  { label: 'Chirp (linear)', kind: 'chirp', name: 'Chirp', title: 'Frequency sweep f₀ → f₁ over a duration, linear in frequency' },
  {
    label: 'Chirp (log)',
    kind: 'chirp',
    name: 'Log sweep',
    customize: (d) => d.generator === 'chirp' && void Object.assign(d.params, { sweep: 'log', f0: 20, f1: 2000, duration: 0.1 }),
    title: 'Logarithmic (exponential) frequency sweep, constant time per octave',
  },
  { label: 'Noise', kind: 'noise', title: 'Seeded pseudo-random noise (Gaussian or uniform), exact mean and RMS, repeatable' },
];

const DIGITAL: Entry[] = [
  {
    label: 'Clock',
    kind: 'square',
    name: 'Clock',
    customize: (d) => {
      d.timing.frequency = 1000;
      if (d.generator === 'square') Object.assign(d.params, { high: 5, low: 0, duty: 0.5 });
    },
    title: '0/5 V, 1 kHz, 50 % clock',
  },
  {
    label: 'Single pulse',
    kind: 'pulse',
    name: 'Single pulse',
    customize: (d) => {
      if (d.generator === 'pulse') Object.assign(d.params, { high: 5, low: 0, width: 0.005 });
      d.window = { mode: 'cycles', start: 0, cycles: 1, outside: 'zero' };
    },
    title: 'One 5 V pulse (a pulse train limited to one cycle)',
  },
  { label: 'NRZ', kind: 'bits', name: 'NRZ', title: 'Bit sequence, non-return-to-zero' },
  {
    label: 'RZ',
    kind: 'bits',
    name: 'RZ',
    customize: (d) => d.generator === 'bits' && void (d.params.encoding = 'rz'),
    title: 'Bit sequence, return-to-zero (a 1 is high for half a bit)',
  },
  {
    label: 'Manchester',
    kind: 'bits',
    name: 'Manchester',
    customize: (d) => d.generator === 'bits' && void (d.params.encoding = 'manchester'),
    title: 'Manchester code (IEEE 802.3: 0 = high→low, 1 = low→high)',
  },
  { label: 'Bit sequence', kind: 'bits', name: 'Bits', title: 'Arbitrary bit sequence: edit bits, bit time, levels and encoding' },
  { label: 'PRBS', kind: 'prbs', name: 'PRBS7', title: 'Pseudo-random binary sequence (maximal-length LFSR, PRBS-3 … PRBS-15)' },
];

const PLANNED_BASIC: string[] = [];
const PLANNED_DIGITAL: Array<[string, string]> = [['PPM', 'later']];
type Template = (a: string, b: string, ctx: { periodA?: number }) => string;
const OPS: Array<[label: string, glyph: string, name: string, arity: 1 | 2, tpl: Template, title: string, unit?: (u: string) => string]> = [
  ['Add', '+', 'Sum', 2, (a, b) => `${a} + ${b}`, 'A + B'],
  ['Subtract', '−', 'Difference', 2, (a, b) => `${a} - ${b}`, 'A − B'],
  ['Multiply', '×', 'Product', 2, (a, b) => `${a} * ${b}`, 'A × B (e.g. power = voltage × current)'],
  ['Divide', '÷', 'Quotient', 2, (a, b) => `${a} / ${b}`, 'A ÷ B (undefined where B = 0)'],
  ['Absolute value', '|x|', 'Abs', 1, (a) => `abs(${a})`, '|A|'],
  ['Negate', '−x', 'Negated', 1, (a) => `-${a}`, '−A'],
  ['Minimum', 'min', 'Min', 2, (a, b) => `min(${a}, ${b})`, 'min(A, B)'],
  ['Maximum', 'max', 'Max', 2, (a, b) => `max(${a}, ${b})`, 'max(A, B)'],
  ['Compare A > B', '>', 'Comparison', 2, (a, b) => `${a} > ${b}`, 'Logic signal: high where A > B (e.g. PWM = Reference > Carrier)'],
  ['Logic AND', '&', 'AND', 2, (a, b) => `and(${a}, ${b})`, 'Logic AND (analog inputs use the threshold)'],
  ['Logic OR', '≥1', 'OR', 2, (a, b) => `or(${a}, ${b})`, 'Logic OR'],
  ['Logic XOR', '=1', 'XOR', 2, (a, b) => `xor(${a}, ${b})`, 'Logic exclusive OR'],
  ['Logic NOT', '¬', 'NOT', 1, (a) => `not(${a})`, 'Logic NOT'],
  ['Half-wave rectify', '⌒', 'Half-wave', 1, (a) => `max(${a}, 0)`, 'max(A, 0)'],
  ['Full-wave rectify', '⌒⌒', 'Full-wave', 1, (a) => `abs(${a})`, '|A|'],
  ['Clip / saturate', '⊓', 'Clipped', 1, (a) => `clip(${a}, -1, 1)`, 'clip(A, −1, 1) — edit the limits in the expression'],
  ['Delay', '→t', 'Delayed', 1, (a) => `delay(${a}, 1m)`, 'A shifted 1 ms later — edit the time in the expression'],
  ['Integration', '∫', 'Integral', 1, (a) => `integral(${a}, 0, 0)`, '∫ A dt from t0 = 0 with initial value 0 (editable)', (u) => (u ? `${u}·s` : 's')],
  ['Differentiation', 'd/dt', 'Derivative', 1, (a) => `deriv(${a})`, 'dA/dt — ideal edges are shown as impulse markers', (u) => (u ? `${u}/s` : '1/s')],
  ['Moving average', 'x̄', 'Average', 1, (a, _b, c) => `movavg(${a}, ${siLiteral(c.periodA ?? 1e-3)})`, 'Average over a trailing window (default: one period of A)'],
  [
    'Low-pass (RC)',
    'τ',
    'Lowpass',
    1,
    (a, _b, c) => `lowpass(${a}, ${siLiteral((c.periodA ?? 1e-2) / 4)})`,
    'First-order lag τ·y′ + y = A (RC filter, R-L load current); periodic steady state. τ defaults to a quarter period of A',
  ],
  [
    'Quantize',
    'q',
    'Quantized',
    1,
    (a) => `quantize(${a}, 0.1)`,
    'Rounds A to multiples of a step (ideal ADC levels); edit the step in the expression',
  ],
  [
    'Sample & hold',
    'ZOH',
    'Sampled',
    1,
    (a, _b, c) => `zoh(${a}, ${siLiteral((c.periodA ?? 1e-2) / 20)})`,
    'Samples A at multiples of Ts and holds the value (zero-order hold); Ts defaults to 1/20 of A’s period',
  ],
  ['RMS (moving)', 'rms', 'RMS', 1, (a, _b, c) => `rms(${a}, ${siLiteral(c.periodA ?? 1e-3)})`, 'RMS over a trailing window (default: one period of A)'],
  ['Expression…', 'ƒ', 'Expression', 1, (a) => a, 'Free expression, starting from A'],
];

function EntryButton({ e }: { e: Entry }) {
  return (
    <button className="tool" title={e.title} onClick={() => actions.addSignal(e.kind, e.customize, e.name)}>
      <WaveGlyph kind={e.kind} variant={e.label} />
      <span>{e.label}</span>
    </button>
  );
}

function Planned({ label, when }: { label: string; when: string }) {
  return (
    <button className="tool planned" disabled title={`Not available yet — planned for ${when}`}>
      <span className="glyph-placeholder" />
      <span>{label}</span>
      <span className="when">{when}</span>
    </button>
  );
}

export function Toolbox() {
  return (
    <div className="toolbox-inner">
      <details open>
        <summary>Basic waveforms</summary>
        <div className="tools">
          {BASIC.map((e) => (
            <EntryButton key={e.label} e={e} />
          ))}
          {PLANNED_BASIC.map((l) => (
            <Planned key={l} label={l} when="Phase 4" />
          ))}
        </div>
      </details>
      <details open>
        <summary>Digital &amp; communication</summary>
        <div className="tools">
          {DIGITAL.map((e) => (
            <EntryButton key={e.label} e={e} />
          ))}
          <button className="tool" title="AM, DSB-SC, FM or PM of a sine, square or triangle message (editable signals)" onClick={openModulation}>
            <WaveGlyph kind="chirp" variant="Chirp (linear)" />
            <span>AM / FM / PM…</span>
          </button>
          {PLANNED_DIGITAL.map(([l, w]) => (
            <Planned key={l} label={l} when={w} />
          ))}
        </div>
      </details>
      <details open>
        <summary>Power electronics</summary>
        <div className="tools">
          <button className="tool" title="Carrier-based PWM: half/full bridge (bipolar, unipolar) or three-phase, with optional dead time" onClick={openPwm}>
            <WaveGlyph kind="bits" variant="PWM" />
            <span>PWM generator…</span>
          </button>
          <button className="tool" title="Diode and thyristor rectifiers, AC voltage controller, three-phase bridges; firing angle α and optional R-L-E load" onClick={openRectifier}>
            <span className="op-glyph">α</span>
            <span>Rectifier / phase control…</span>
          </button>
          <button className="tool" title="Three sines 120° apart in a shared panel (uses the selected sine's frequency and amplitude)" onClick={() => actions.addThreePhaseSet()}>
            <span className="op-glyph">3~</span>
            <span>Three-phase set</span>
          </button>
          <button className="tool" title="Upper/lower gate pair from the selected logic signal, turn-on edges delayed by the dead time" onClick={() => actions.addComplementaryPair()}>
            <span className="op-glyph">⊓⊔</span>
            <span>Complementary + dead time</span>
          </button>
        </div>
      </details>
      <details open>
        <summary>Mathematical operations</summary>
        <p className="tools-hint">A = selected signal, B = next signal in the list. The result is a new signal; inputs are never changed.</p>
        <div className="tools">
          {OPS.map(([label, glyph, name, arity, tpl, title, unit]) => (
            <button key={label} className="tool" title={title} onClick={() => actions.addDerived(tpl, arity, name, unit)}>
              <span className="op-glyph">{glyph}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
