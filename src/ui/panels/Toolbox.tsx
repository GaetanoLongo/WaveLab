/**
 * Left sidebar: waveform generators and presets. Entries not implemented yet are
 * shown disabled with the milestone that delivers them.
 */

import type { SignalDef } from '../../core/model/project';
import type { GeneratorKind } from '../../core/model/signal-defs';
import { actions } from '../../state/store';
import { WaveGlyph } from '../icons';

interface Entry {
  label: string;
  kind: GeneratorKind;
  name?: string;
  customize?: (d: SignalDef) => void;
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
];

const PLANNED_BASIC = ['Exponential rise', 'Exponential decay', 'Damped sinusoid', 'Custom piecewise'];
const PLANNED_DIGITAL: Array<[string, string]> = [
  ['PWM signal', 'M8'],
  ['PPM', 'Phase 4'],
  ['NRZ', 'Phase 4'],
  ['RZ', 'Phase 4'],
  ['Manchester', 'Phase 4'],
  ['Bit sequence', 'Phase 4'],
];
const PLANNED_OPS = [
  'Add / Subtract',
  'Multiply / Divide',
  'Abs / Negate',
  'Min / Max',
  'Logic AND / OR / XOR / NOT',
  'Comparators',
  'Integration',
  'Differentiation',
  'Moving average / RMS',
  'Rectify / Clip',
  'Delay',
  'Expression…',
];

function EntryButton({ e }: { e: Entry }) {
  return (
    <button className="tool" title={e.title} onClick={() => actions.addSignal(e.kind, e.customize, e.name)}>
      <WaveGlyph kind={e.kind} falling={e.label === 'Inverted sawtooth'} />
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
          {PLANNED_DIGITAL.map(([l, w]) => (
            <Planned key={l} label={l} when={w} />
          ))}
        </div>
      </details>
      <details>
        <summary>Mathematical operations</summary>
        <div className="tools">
          {PLANNED_OPS.map((l) => (
            <Planned key={l} label={l} when="M6–M7" />
          ))}
        </div>
      </details>
    </div>
  );
}
