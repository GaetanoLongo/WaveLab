import { plainText } from '../../core/plot/mathtext';
/** Contextual parameter editor for the selected signal. Every change applies immediately. */

import { useState, type ReactNode } from 'react';
import type { GeneratorSignalDef, LineDash, SignalDef } from '../../core/model/project';
import { isPeriodicKind, phaseToTime, timeToPhase, type SignalWindow } from '../../core/model/signal-defs';
import { formatSI } from '../../core/units/si';
import { phaseDifferenceDeg } from '../../core/signals/phase';
import { actions, editor, findSignal, GENERATOR_LABELS, orderedSignals, useEditor, type AlignKind } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { DerivedProperties } from './DerivedProperties';

type Upd = (recipe: (s: GeneratorSignalDef) => void, key?: string) => void;
export type UpdAny = (recipe: (s: SignalDef) => void, key?: string) => void;

export function PropertiesPanel() {
  const sig = useEditor((s) => findSignal(s.project, s.selectedId));
  if (!sig) {
    return (
      <section className="properties">
        <h2>Properties</h2>
        <p className="empty">Select a signal in the list or click a trace in the plot.</p>
      </section>
    );
  }
  return sig.kind === 'derived' ? <DerivedProperties sig={sig} /> : <GeneratorProperties sig={sig} />;
}

/** Name and unit (shared by generator and derived signals). */
export function GeneralGroup({ sig, upd }: { sig: SignalDef; upd: UpdAny }) {
  return (
    <Group title="General">
      <TextField
        label="Name"
        value={sig.name}
        title="Supports math markup: V_{out}, I^2, \omega"
        validate={(v) => actions.renameSignal(sig.id, v)}
        onCommit={() => {}}
      />
      <TextField
        label="Unit"
        value={sig.unit}
        list="unit-options"
        allowEmpty
        title="Vertical unit, e.g. V, A, W"
        onCommit={(v) => upd((s) => void (s.unit = v))}
      />
      <datalist id="unit-options">
        <option value="V" />
        <option value="A" />
        <option value="W" />
        <option value="Ω" />
      </datalist>
    </Group>
  );
}

function GeneratorProperties({ sig }: { sig: GeneratorSignalDef }) {
  const upd: Upd = (recipe, key) => actions.updateGenerator(sig.id, recipe, key);
  const updAny: UpdAny = (recipe, key) => actions.updateSignal(sig.id, recipe, key);
  const dis = sig.locked;
  const label = sig.generator === 'sawtooth' && sig.params.slope === 'falling' ? 'Inverted sawtooth' : GENERATOR_LABELS[sig.generator];

  return (
    <section className="properties" aria-label="Properties">
      <h2>
        Properties <span className="kind">{label}</span>
      </h2>
      {dis && <p className="locked-note">Locked: unlock the signal in the list to edit it.</p>}
      <fieldset disabled={dis}>
        <GeneralGroup sig={sig} upd={updAny} />

        <WaveformParams sig={sig} upd={upd} disabled={dis} />
        {sig.generator !== 'dc' && <TimingParams sig={sig} upd={upd} disabled={dis} />}
        {sig.generator !== 'dc' && <AlignParams sig={sig} disabled={dis} />}
        {(isPeriodicKind(sig.generator) || sig.generator === 'dc') && <WindowParams sig={sig} upd={upd} disabled={dis} />}
        <StyleParams sig={sig} upd={updAny} disabled={dis} />

        <div className="prop-actions">
          <button onClick={() => actions.invert(sig.id)} title="Mirror the waveform around zero (y → −y)">
            Invert
          </button>
          <button onClick={() => actions.fitSelected()} title="Zoom the time axis to this signal">
            Fit to signal
          </button>
        </div>
      </fieldset>
    </section>
  );
}

export function Group({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="group-body">{children}</div>
    </details>
  );
}

function WaveformParams({ sig, upd, disabled }: { sig: GeneratorSignalDef; upd: Upd; disabled: boolean }) {
  const u = sig.unit;
  switch (sig.generator) {
    case 'sine':
    case 'cosine':
    case 'triangle':
    case 'sawtooth': {
      const p = sig.params;
      return (
        <Group title="Waveform">
          <NumberField
            label="Amplitude"
            title="Zero-to-peak amplitude"
            unit={u}
            value={p.amplitude}
            disabled={disabled}
            onCommit={(v) => upd((s) => void ('amplitude' in s.params && (s.params.amplitude = v)))}
          />
          <NumberField
            label="Offset"
            title="DC offset"
            unit={u}
            value={p.offset}
            disabled={disabled}
            onCommit={(v) => upd((s) => void ('offset' in s.params && (s.params.offset = v)))}
          />
          {sig.generator === 'sawtooth' && (
            <div className="field">
              <label>Slope</label>
              <select
                value={sig.params.slope}
                onChange={(e) =>
                  upd((s) => {
                    if (s.generator === 'sawtooth') s.params.slope = e.target.value as 'rising' | 'falling';
                  })
                }
              >
                <option value="rising">Rising (ramp up)</option>
                <option value="falling">Falling (ramp down)</option>
              </select>
            </div>
          )}
          <Readout items={[['Peak-to-peak', formatSI(2 * Math.abs(p.amplitude), u)], ['RMS (AC part)', formatSI(rmsAc(sig), u)]]} />
        </Group>
      );
    }
    case 'square': {
      const p = sig.params;
      const amp = (p.high - p.low) / 2;
      const off = (p.high + p.low) / 2;
      const set = (high: number, low: number) =>
        upd((s) => {
          if (s.generator === 'square') Object.assign(s.params, { high, low });
        });
      return (
        <Group title="Waveform">
          <NumberField label="High level" unit={u} value={p.high} disabled={disabled} onCommit={(v) => set(v, p.low)} />
          <NumberField label="Low level" unit={u} value={p.low} disabled={disabled} onCommit={(v) => set(p.high, v)} />
          <NumberField
            label="Amplitude"
            title="(high − low) / 2 — editing keeps the offset"
            unit={u}
            value={amp}
            disabled={disabled}
            onCommit={(v) => set(off + v, off - v)}
          />
          <NumberField
            label="Offset"
            title="(high + low) / 2 — editing keeps the amplitude"
            unit={u}
            value={off}
            disabled={disabled}
            onCommit={(v) => set(v + amp, v - amp)}
          />
          <NumberField
            label="Duty cycle"
            unit="%"
            plain
            scale={100}
            min={0}
            max={1}
            value={p.duty}
            disabled={disabled}
            onCommit={(v) => upd((s) => void (s.generator === 'square' && (s.params.duty = v)))}
          />
          <Slider
            min={0}
            max={100}
            step={0.5}
            value={p.duty * 100}
            disabled={disabled}
            label="Duty cycle slider"
            onChange={(v) => upd((s) => void (s.generator === 'square' && (s.params.duty = v / 100)), `duty-${sig.id}`)}
          />
          <Readout
            items={[
              ['High time', formatSI(p.duty / sig.timing.frequency, 's')],
              ['Low time', formatSI((1 - p.duty) / sig.timing.frequency, 's')],
            ]}
          />
        </Group>
      );
    }
    case 'pulse': {
      const p = sig.params;
      const T = 1 / sig.timing.frequency;
      const overflow = p.rise + p.width + p.fall > T * (1 + 1e-12);
      const setP = (k: 'high' | 'low' | 'width' | 'rise' | 'fall') => (v: number) =>
        upd((s) => {
          if (s.generator === 'pulse') s.params[k] = v;
        });
      return (
        <Group title="Waveform">
          <NumberField label="High level" unit={u} value={p.high} disabled={disabled} onCommit={setP('high')} />
          <NumberField label="Low level" unit={u} value={p.low} disabled={disabled} onCommit={setP('low')} />
          <NumberField label="Pulse width" title="Flat top, excluding rise and fall (SPICE convention)" unit="s" min={0} value={p.width} disabled={disabled} onCommit={setP('width')} />
          <NumberField label="Rise time" unit="s" min={0} value={p.rise} disabled={disabled} onCommit={setP('rise')} />
          <NumberField label="Fall time" unit="s" min={0} value={p.fall} disabled={disabled} onCommit={setP('fall')} />
          {overflow && <p className="warn">Rise + width + fall exceed the period ({formatSI(T, 's')}); the pulse is clipped to the period.</p>}
          <Readout items={[['Duty (incl. edges)', `${(Math.min(1, (p.rise + p.width + p.fall) / T) * 100).toPrecision(4)} %`]]} />
        </Group>
      );
    }
    case 'exponential': {
      const p = sig.params;
      const setE = (k: 'initial' | 'final' | 'tau') => (v: number) => upd((s) => void (s.generator === 'exponential' && (s.params[k] = v)));
      return (
        <Group title="Waveform">
          <NumberField label="Initial value" unit={u} value={p.initial} disabled={disabled} onCommit={setE('initial')} />
          <NumberField label="Final value" unit={u} value={p.final} disabled={disabled} onCommit={setE('final')} />
          <NumberField label="Time constant τ" unit="s" positive value={p.tau} disabled={disabled} onCommit={setE('tau')} />
          <Readout
            items={[
              ['10–90 % time', formatSI(p.tau * Math.log(9), 's')],
              ['Settles to 1 %', formatSI(p.tau * Math.log(100), 's')],
            ]}
          />
        </Group>
      );
    }
    case 'damped': {
      const p = sig.params;
      const setD = (k: 'amplitude' | 'offset' | 'tau') => (v: number) => upd((s) => void (s.generator === 'damped' && (s.params[k] = v)));
      return (
        <Group title="Waveform">
          <NumberField label="Amplitude" title="Initial envelope (zero-to-peak)" unit={u} value={p.amplitude} disabled={disabled} onCommit={setD('amplitude')} />
          <NumberField label="Offset" unit={u} value={p.offset} disabled={disabled} onCommit={setD('offset')} />
          <NumberField label="Decay τ" title="Envelope time constant: A·e^(−t/τ)" unit="s" positive value={p.tau} disabled={disabled} onCommit={setD('tau')} />
          <Readout
            items={[
              ['Envelope halves every', formatSI(p.tau * Math.LN2, 's')],
              ['Quality factor Q', (Math.PI * sig.timing.frequency * p.tau).toPrecision(4)],
            ]}
          />
        </Group>
      );
    }
    case 'piecewise':
      return <PiecewiseParams sig={sig} upd={upd} disabled={disabled} />;
    case 'bits':
      return <BitsParamsView sig={sig} upd={upd} disabled={disabled} />;
    case 'chirp':
    case 'noise':
    case 'prbs':
      return <SourceParamsView sig={sig} upd={upd} disabled={disabled} />;
    case 'dc':
      return (
        <Group title="Waveform">
          <NumberField
            label="Level"
            unit={u}
            value={sig.params.level}
            disabled={disabled}
            onCommit={(v) => upd((s) => void (s.generator === 'dc' && (s.params.level = v)))}
          />
        </Group>
      );
  }
}

function PiecewiseParams({ sig, upd, disabled }: { sig: GeneratorSignalDef; upd: Upd; disabled: boolean }) {
  if (sig.generator !== 'piecewise') return null;
  const p = sig.params;
  const setPoints = (pts: Array<[number, number]>) =>
    upd((s) => {
      if (s.generator !== 'piecewise') return;
      // Keep the table sorted by time (stable, so equal times keep their order = vertical steps).
      s.params.points = pts.map((q, i) => [q, i] as const).sort((a, b) => a[0][0] - b[0][0] || a[1] - b[1]).map((x) => x[0]);
    });
  const span = p.points.length ? p.points[p.points.length - 1]![0] - p.points[0]![0] : 0;
  return (
    <Group title="Points">
      <table className="points">
        <thead>
          <tr>
            <th>Time</th>
            <th>Value</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {p.points.map(([t, y], i) => (
            <tr key={i}>
              <td>
                <NumberField label="" unit="s" value={t} disabled={disabled} onCommit={(v) => setPoints(p.points.map((q, j) => (j === i ? [v, q[1]] : q)))} />
              </td>
              <td>
                <NumberField label="" unit={sig.unit} value={y} disabled={disabled} onCommit={(v) => setPoints(p.points.map((q, j) => (j === i ? [q[0], v] : q)))} />
              </td>
              <td>
                <button
                  className="icon"
                  aria-label={`Remove point ${i + 1}`}
                  disabled={disabled || p.points.length <= 2}
                  onClick={() => setPoints(p.points.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        disabled={disabled}
        onClick={() => {
          const last = p.points[p.points.length - 1] ?? [0, 0];
          const prev = p.points[p.points.length - 2] ?? [last[0] - 1e-3, 0];
          const dt = last[0] - prev[0] > 0 ? last[0] - prev[0] : 1e-3;
          setPoints([...p.points, [last[0] + dt, last[1]]]);
        }}
      >
        + Add point
      </button>
      <p className="hint-text">Two points with the same time make a vertical step. Times are relative to the start time.</p>
      <div className="field">
        <label>Interpolation</label>
        <select value={p.interp} disabled={disabled} onChange={(e) => upd((s) => void (s.generator === 'piecewise' && (s.params.interp = e.target.value as 'linear' | 'step')))}>
          <option value="linear">Linear</option>
          <option value="step">Step (hold)</option>
        </select>
      </div>
      <label className="check">
        <input type="checkbox" checked={p.repeat} disabled={disabled} onChange={(e) => upd((s) => void (s.generator === 'piecewise' && (s.params.repeat = e.target.checked)))} />
        Repeat (period = {formatSI(span, 's')})
      </label>
    </Group>
  );
}

function BitsParamsView({ sig, upd, disabled }: { sig: GeneratorSignalDef; upd: Upd; disabled: boolean }) {
  if (sig.generator !== 'bits') return null;
  const p = sig.params;
  const set = <K extends keyof typeof p>(k: K, v: (typeof p)[K]) => upd((s) => void (s.generator === 'bits' && (s.params[k] = v)));
  return (
    <Group title="Bit sequence">
      <TextField
        label="Bits"
        value={p.bits}
        title="Only 0 and 1 (spaces are removed)"
        validate={(v) => {
          const ok = /^[01]+$/.test(v.replace(/\s+/g, ''));
          if (!ok) editor.setState({ notice: 'Bits may contain only 0 and 1.' });
          return ok;
        }}
        onCommit={(v) => set('bits', v.replace(/\s+/g, ''))}
      />
      <div className="field">
        <label>Encoding</label>
        <select value={p.encoding} disabled={disabled} onChange={(e) => set('encoding', e.target.value as typeof p.encoding)}>
          <option value="nrz">NRZ (non-return-to-zero)</option>
          <option value="rz">RZ (return-to-zero)</option>
          <option value="manchester">Manchester (IEEE 802.3)</option>
        </select>
      </div>
      <NumberField label="Bit time" unit="s" positive value={p.bitTime} disabled={disabled} onCommit={(v) => set('bitTime', v)} />
      <NumberField label="High level" unit={sig.unit} value={p.high} disabled={disabled} onCommit={(v) => set('high', v)} />
      <NumberField label="Low level" unit={sig.unit} value={p.low} disabled={disabled} onCommit={(v) => set('low', v)} />
      <label className="check">
        <input type="checkbox" checked={p.repeat} disabled={disabled} onChange={(e) => set('repeat', e.target.checked)} />
        Repeat the frame
      </label>
      <div className="field">
        <label>Idle level</label>
        <select value={p.idle ?? 'low'} disabled={disabled || p.repeat} onChange={(e) => set('idle', e.target.value as 'low' | 'high')} title="Line level before and after the frame">
          <option value="low">Low</option>
          <option value="high">High (UART, I²C)</option>
        </select>
      </div>
      <Readout
        items={[
          ['Bit rate', formatSI(1 / p.bitTime, 'bit/s')],
          ['Frame length', `${p.bits.length} bits · ${formatSI(p.bits.length * p.bitTime, 's')}`],
        ]}
      />
      <p className="hint-text">
        {p.encoding === 'manchester' && 'IEEE 802.3: 0 = high→low and 1 = low→high at mid-bit (G. E. Thomas uses the opposite).'}
        {p.encoding === 'rz' && 'A 1 is high for the first half of its bit; a 0 stays low.'}
        {p.encoding === 'nrz' && 'Each bit holds its level for the whole bit time.'}
      </p>
    </Group>
  );
}

/** Chirp, noise and PRBS parameters. */
function SourceParamsView({ sig, upd, disabled }: { sig: GeneratorSignalDef; upd: Upd; disabled: boolean }) {
  const u = sig.unit;
  if (sig.generator === 'chirp') {
    const p = sig.params;
    const set = <K extends keyof typeof p>(k: K) => (v: (typeof p)[K]) => upd((s) => void (s.generator === 'chirp' && (s.params[k] = v)));
    const cycles = p.sweep === 'log' && p.f1 !== p.f0 ? (p.f0 * p.duration * (p.f1 / p.f0 - 1)) / Math.log(p.f1 / p.f0) : ((p.f0 + p.f1) / 2) * p.duration;
    return (
      <Group title="Frequency sweep">
        <NumberField label="Amplitude" unit={u} value={p.amplitude} disabled={disabled} onCommit={set('amplitude')} />
        <NumberField label="Offset" unit={u} value={p.offset} disabled={disabled} onCommit={set('offset')} />
        <NumberField label="Start frequency f₀" unit="Hz" positive value={p.f0} disabled={disabled} onCommit={set('f0')} />
        <NumberField label="End frequency f₁" unit="Hz" positive value={p.f1} disabled={disabled} onCommit={set('f1')} />
        <NumberField label="Duration" unit="s" positive value={p.duration} disabled={disabled} onCommit={set('duration')} />
        <div className="field">
          <label>Sweep</label>
          <select value={p.sweep} disabled={disabled} onChange={(e) => set('sweep')(e.target.value as typeof p.sweep)}>
            <option value="linear">Linear (constant Hz/s)</option>
            <option value="log">Logarithmic (constant time per octave)</option>
          </select>
        </div>
        <NumberField label="Initial phase" unit="°" plain value={p.phaseDeg} disabled={disabled} onCommit={set('phaseDeg')} />
        <label className="check">
          <input type="checkbox" checked={p.repeat} disabled={disabled} onChange={(e) => set('repeat')(e.target.checked)} />
          Repeat the sweep
        </label>
        <Readout
          items={[
            ['Sweep rate', p.sweep === 'log' ? `${(Math.log2(p.f1 / p.f0) / p.duration).toPrecision(4)} oct/s` : formatSI((p.f1 - p.f0) / p.duration, 'Hz/s')],
            ['Cycles in the sweep', cycles.toPrecision(5)],
          ]}
        />
      </Group>
    );
  }
  if (sig.generator === 'noise') {
    const p = sig.params;
    const set = <K extends keyof typeof p>(k: K) => (v: (typeof p)[K]) => upd((s) => void (s.generator === 'noise' && (s.params[k] = v)));
    return (
      <Group title="Noise">
        <NumberField label="Mean" unit={u} value={p.mean} disabled={disabled} onCommit={set('mean')} />
        <NumberField label="Std deviation σ" title="Of the samples (= AC RMS in hold mode); negative = inverted" unit={u} value={p.rms} disabled={disabled} onCommit={set('rms')} />
        <div className="field">
          <label>Distribution</label>
          <select value={p.distribution} disabled={disabled} onChange={(e) => set('distribution')(e.target.value as typeof p.distribution)}>
            <option value="gaussian">Gaussian</option>
            <option value="uniform">Uniform</option>
          </select>
        </div>
        <NumberField label="Sample time" unit="s" positive value={p.sampleTime} disabled={disabled} onCommit={set('sampleTime')} />
        <div className="field">
          <label>Between samples</label>
          <select value={p.interp} disabled={disabled} onChange={(e) => set('interp')(e.target.value as typeof p.interp)}>
            <option value="linear">Straight lines</option>
            <option value="hold">Held (steps)</option>
          </select>
        </div>
        <NumberField label="Length" plain min={2} max={1_000_000} value={p.length} disabled={disabled} onCommit={(v) => set('length')(Math.round(v))} title="Samples before the sequence repeats" />
        <NumberField label="Seed" plain value={p.seed} disabled={disabled} onCommit={(v) => set('seed')(Math.round(v))} title="Same seed = same signal" />
        <Readout
          items={[
            ['Bandwidth ≈', formatSI(1 / (2 * p.sampleTime), 'Hz')],
            ['Repeats every', formatSI(p.length * p.sampleTime, 's')],
          ]}
        />
      </Group>
    );
  }
  if (sig.generator === 'prbs') {
    const p = sig.params;
    const set = <K extends keyof typeof p>(k: K) => (v: (typeof p)[K]) => upd((s) => void (s.generator === 'prbs' && (s.params[k] = v)));
    const n = 2 ** p.order - 1;
    return (
      <Group title="PRBS">
        <div className="field">
          <label>Sequence</label>
          <select
            value={p.order}
            disabled={disabled}
            onChange={(e) => {
              const order = Number(e.target.value);
              upd((s) => void (s.generator === 'prbs' && Object.assign(s.params, { order, seed: 2 ** order - 1 })));
            }}
          >
            {Array.from({ length: 13 }, (_, i) => i + 3).map((o) => (
              <option key={o} value={o}>
                PRBS-{o} ({2 ** o - 1} bits)
              </option>
            ))}
          </select>
        </div>
        <NumberField label="Bit time" unit="s" positive value={p.bitTime} disabled={disabled} onCommit={set('bitTime')} />
        <NumberField label="High level" unit={u} value={p.high} disabled={disabled} onCommit={set('high')} />
        <NumberField label="Low level" unit={u} value={p.low} disabled={disabled} onCommit={set('low')} />
        <NumberField label="Initial state" plain min={1} max={n} value={p.seed} disabled={disabled} onCommit={(v) => set('seed')(Math.round(v))} title={`LFSR starting register, 1 … ${n}. The sequence is deterministic: the same sequence length and initial state always give the same bits (not random on each run). Change the initial state to start at a different point of the cycle.`} />
        <p className="hint-text">Deterministic: the same length and initial state always give the same bits.</p>
        <Readout
          items={[
            ['Bit rate', formatSI(1 / p.bitTime, 'bit/s')],
            ['Period', `${n} bits · ${formatSI(n * p.bitTime, 's')}`],
          ]}
        />
      </Group>
    );
  }
  return null;
}

/** RMS of the AC component (offset excluded) for the shapes with a closed form. */
function rmsAc(sig: GeneratorSignalDef): number {
  if (!('amplitude' in sig.params)) return NaN;
  const A = Math.abs(sig.params.amplitude);
  return sig.generator === 'sine' || sig.generator === 'cosine' ? A / Math.SQRT2 : A / Math.sqrt(3);
}

function TimingParams({ sig, upd, disabled }: { sig: GeneratorSignalDef; upd: Upd; disabled: boolean }) {
  const [phaseUnit, setPhaseUnit] = useState<'deg' | 'rad'>('deg');
  const f = sig.timing.frequency;
  const setT = (k: 'frequency' | 'phaseDeg' | 'delay', key?: string) => (v: number) =>
    upd((s) => void (s.timing[k] = v), key);
  const lead = phaseToTime(sig.timing.phaseDeg, f);
  const rawNet = sig.timing.delay - lead;
  // Hide floating-point residue (e.g. after alignment): below 1e-9 of a period counts as 0.
  const net = Math.abs(rawNet) < 1e-9 / f ? 0 : rawNet;

  if (!isPeriodicKind(sig.generator) && sig.generator !== 'damped') {
    return (
      <Group title="Timing">
        <NumberField
          label="Start time"
          title="Where the waveform starts on the global timeline (drag the trace to move it)"
          unit="s"
          value={sig.timing.delay}
          disabled={disabled}
          onCommit={setT('delay')}
        />
      </Group>
    );
  }

  return (
    <Group title="Timing">
      <NumberField label="Frequency" unit="Hz" positive value={f} disabled={disabled} onCommit={setT('frequency')} />
      <NumberField label="Period" unit="s" positive value={1 / f} disabled={disabled} onCommit={(v) => setT('frequency')(1 / v)} />
      <div className="field-row">
        {phaseUnit === 'deg' ? (
          <NumberField
            label="Phase"
            title="+φ leads (the waveform moves earlier)"
            unit="°"
            plain
            value={sig.timing.phaseDeg}
            disabled={disabled}
            onCommit={setT('phaseDeg')}
          />
        ) : (
          <NumberField
            label="Phase"
            title="+φ leads (the waveform moves earlier)"
            unit="rad"
            plain
            value={(sig.timing.phaseDeg * Math.PI) / 180}
            disabled={disabled}
            onCommit={(v) => setT('phaseDeg')((v * 180) / Math.PI)}
          />
        )}
        <select className="unit-select" value={phaseUnit} onChange={(e) => setPhaseUnit(e.target.value as 'deg' | 'rad')} aria-label="Phase unit">
          <option value="deg">deg</option>
          <option value="rad">rad</option>
        </select>
      </div>
      <Slider
        min={-180}
        max={180}
        step={1}
        value={wrap180(sig.timing.phaseDeg)}
        disabled={disabled}
        label="Phase slider"
        onChange={setT('phaseDeg', `phase-${sig.id}`)}
      />
      <NumberField
        label="Phase as time"
        title="The phase expressed as a time lead at the current frequency"
        unit="s"
        value={lead}
        disabled={disabled}
        onCommit={(v) => setT('phaseDeg')(timeToPhase(v, f))}
      />
      <NumberField
        label={sig.generator === 'damped' ? 'Start time' : 'Delay'}
        title="Position on the global timeline; positive shifts right (later)"
        unit="s"
        value={sig.timing.delay}
        disabled={disabled}
        onCommit={setT('delay')}
      />
      <Readout
        items={[
          [
            'Net time shift',
            net === 0 ? '0 (reference)' : `${formatSI(Math.abs(net), 's')} ${net > 0 ? 'later' : 'earlier'} (${formatDeg(timeToPhase(-net, f))})`,
          ],
        ]}
      />
    </Group>
  );
}

const ALIGN_BUTTONS: Array<[AlignKind, string, string]> = [
  ['rise', 'Rising edges', '↑ edge'],
  ['fall', 'Falling edges', '↓ edge'],
  ['max', 'Positive peaks', '+ peak'],
  ['min', 'Negative peaks', '− peak'],
  ['zero-up', 'Rising zero crossings', '0 ↑'],
];

function AlignParams({ sig, disabled }: { sig: GeneratorSignalDef; disabled: boolean }) {
  const project = useEditor((s) => s.project);
  // Any signal can be the alignment reference (features); phase difference needs a generator.
  const others = orderedSignals(project).filter((s) => s.id !== sig.id);
  const [refId, setRefId] = useState('');
  const ref = others.find((o) => o.id === refId) ?? others[0];
  const say = (m: string) => editor.setState({ notice: m });

  if (!ref) {
    return (
      <Group title="Alignment" defaultOpen={false}>
        <p className="hint-text">Add another signal to align against.</p>
      </Group>
    );
  }
  const diff = ref.kind === 'generator' ? phaseDifferenceDeg(sig, ref) : null;
  const f = sig.timing.frequency;
  return (
    <Group title="Alignment">
      <div className="field">
        <label>Reference</label>
        <select value={ref.id} onChange={(e) => setRefId(e.target.value)}>
          {others.map((o) => (
            <option key={o.id} value={o.id}>
              {plainText(o.name)}
            </option>
          ))}
        </select>
      </div>
      <div className="align-buttons" role="group" aria-label="Align features to reference">
        {ALIGN_BUTTONS.map(([k, title, short]) => (
          <button key={k} disabled={disabled} title={`Align ${title.toLowerCase()} to the reference (moves the delay)`} onClick={() => say(actions.alignFeature(sig.id, ref.id, k))}>
            {short}
          </button>
        ))}
      </div>
      <Readout
        items={[
          [
            'Phase vs ref.',
            diff === null
              ? 'n/a (needs the same frequency)'
              : diff === 0
                ? 'in phase (0°)'
                : `${diff > 0 ? 'leads' : 'lags'} by ${Math.abs(Number(diff.toPrecision(6)))}° (${formatSI(Math.abs(phaseToTime(diff, f)), 's')})`,
          ],
        ]}
      />
      <NumberField
        label="Set difference"
        title="Phase by which this signal leads the reference (fundamental component). Changes the phase parameter."
        unit="°"
        plain
        value={diff ?? 0}
        disabled={disabled || diff === null}
        onCommit={(v) => say(actions.setPhaseDifference(sig.id, ref.id, v))}
      />
    </Group>
  );
}

function wrap180(deg: number): number {
  const w = ((((deg + 180) % 360) + 360) % 360) - 180;
  return w;
}

function formatDeg(d: number): string {
  return `${d >= 0 ? '+' : ''}${Number(d.toPrecision(5))}°`;
}

function WindowParams({ sig, upd, disabled }: { sig: GeneratorSignalDef; upd: Upd; disabled: boolean }) {
  const w = sig.window;
  const f = sig.generator === 'dc' ? 1 : sig.timing.frequency;
  const setW = (next: SignalWindow) => upd((s) => void (s.window = next));
  return (
    <Group title="Time window" defaultOpen={w.mode !== 'infinite'}>
      <div className="field">
        <label>Extent</label>
        <select
          value={w.mode}
          disabled={disabled}
          onChange={(e) => {
            const mode = e.target.value as SignalWindow['mode'];
            const outside = w.mode === 'infinite' ? 'zero' : w.outside;
            if (mode === 'infinite') setW({ mode });
            else if (mode === 'interval') setW({ mode, start: 0, end: 2 / f, outside });
            else setW({ mode, start: 0, cycles: 2, outside });
          }}
        >
          <option value="infinite">Repeats forever</option>
          <option value="interval">Start / end time</option>
          {sig.generator !== 'dc' && <option value="cycles">Number of cycles</option>}
        </select>
      </div>
      {w.mode !== 'infinite' && (
        <>
          <NumberField
            label="Start time"
            title="Relative to the signal's delay"
            unit="s"
            value={w.start}
            disabled={disabled}
            onCommit={(v) => setW({ ...w, start: v })}
          />
          {w.mode === 'interval' ? (
            <NumberField label="End time" unit="s" min={w.start} value={w.end} disabled={disabled} onCommit={(v) => setW({ ...w, end: v })} />
          ) : (
            <NumberField label="Cycles" plain positive value={w.cycles} disabled={disabled} onCommit={(v) => setW({ ...w, cycles: v })} />
          )}
          <div className="field">
            <label>Outside window</label>
            <select value={w.outside} disabled={disabled} onChange={(e) => setW({ ...w, outside: e.target.value as 'zero' | 'undefined' })}>
              <option value="zero">Zero</option>
              <option value="undefined">Undefined (not drawn)</option>
            </select>
          </div>
        </>
      )}
    </Group>
  );
}

export function StyleParams({ sig, upd, disabled }: { sig: SignalDef; upd: UpdAny; disabled: boolean }) {
  return (
    <Group title="Appearance">
      <div className="field">
        <label>Colour</label>
        <input
          type="color"
          value={sig.style.color}
          disabled={disabled}
          onChange={(e) => upd((s) => void (s.style.color = e.target.value), `color-${sig.id}`)}
        />
      </div>
      <NumberField
        label="Line width"
        unit="px"
        plain
        min={0.25}
        max={12}
        value={sig.style.lineWidth}
        disabled={disabled}
        onCommit={(v) => upd((s) => void (s.style.lineWidth = v))}
      />
      <div className="field">
        <label>Line style</label>
        <select value={sig.style.dash} disabled={disabled} onChange={(e) => upd((s) => void (s.style.dash = e.target.value as LineDash))}>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
          <option value="dashdot">Dash-dot</option>
        </select>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={sig.style.showInLegend}
          disabled={disabled}
          onChange={(e) => upd((s) => void (s.style.showInLegend = e.target.checked))}
        />
        Show in legend
      </label>
    </Group>
  );
}

export function Readout({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="readout">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Slider(p: { min: number; max: number; step: number; value: number; disabled: boolean; label: string; onChange(v: number): void }) {
  return (
    <input
      type="range"
      className="slider"
      aria-label={p.label}
      min={p.min}
      max={p.max}
      step={p.step}
      value={p.value}
      disabled={p.disabled}
      onChange={(e) => p.onChange(Number(e.target.value))}
    />
  );
}

export function TextField(p: {
  label: string;
  value: string;
  list?: string;
  title?: string;
  allowEmpty?: boolean;
  /** Return false to reject the text (the field then shows the stored value again). */
  validate?(v: string): boolean;
  onCommit(v: string): void;
}) {
  const [key, setKey] = useState(0);
  const commit = (raw: string) => {
    const v = raw.trim();
    if ((v || p.allowEmpty) && v !== p.value && (p.validate?.(v) ?? true)) p.onCommit(v);
    else setKey((k) => k + 1); // reset to the stored value
  };
  return (
    <div className="field">
      <label title={p.title}>{p.label}</label>
      <input
        key={`${p.value}-${key}`}
        defaultValue={p.value}
        list={p.list}
        title={p.title}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            e.currentTarget.value = p.value;
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}
