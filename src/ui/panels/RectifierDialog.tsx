/** Rectifier / phase-control dialog: creates an editable signal set for a textbook circuit. */

import { useState } from 'react';
import { create } from 'zustand';
import { formatSI } from '../../core/units/si';
import {
  DEFAULT_RECTIFIER,
  expectedOutput,
  isThreePhase,
  RECTIFIER_LABELS,
  usesAlpha,
  type RectifierConfig,
  type RectifierTopology,
} from '../../state/rectifier';
import { actions } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

export const useRectifierDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openRectifier = () => useRectifierDialog.setState({ open: true });
const close = () => useRectifierDialog.setState({ open: false });

const KEY = 'wavelab.rectifier.v1';
function load(): RectifierConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_RECTIFIER, ...(JSON.parse(raw) as Partial<RectifierConfig>) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_RECTIFIER };
}

export function RectifierDialog() {
  const open = useRectifierDialog((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const [c, setC] = useState<RectifierConfig>(load);
  const set = (patch: Partial<RectifierConfig>) => setC((p) => ({ ...p, ...patch }));
  const exp = expectedOutput(c);
  const continuous = c.topology === 'full-scr-cont' || c.topology === 'three-scr';
  const create = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    actions.createRectifier(c);
    close();
  };

  return (
    <Modal
      title="Rectifier / phase control"
      onClose={close}
      className="rectifier-dialog pwm-dialog"
      footer={
        <>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={create}>
            Create signals
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <section>
          <h3>Circuit</h3>
          <div className="field">
            <label>Topology</label>
            <select value={c.topology} onChange={(e) => set({ topology: e.target.value as RectifierTopology })}>
              {(Object.keys(RECTIFIER_LABELS) as RectifierTopology[]).map((t) => (
                <option key={t} value={t}>
                  {RECTIFIER_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <NumberField
            label={isThreePhase(c.topology) ? 'Phase voltage (RMS)' : 'Source voltage (RMS)'}
            unit="V"
            positive
            value={c.vs}
            onCommit={(v) => set({ vs: v })}
          />
          <NumberField label="Frequency" unit="Hz" positive value={c.f} onCommit={(v) => set({ f: v })} />
          {usesAlpha(c.topology) && (
            <NumberField
              label="Firing angle α"
              unit="°"
              plain
              min={0}
              max={180}
              value={c.alphaDeg}
              onCommit={(v) => set({ alphaDeg: v })}
              title="Delay from the natural commutation point (zero crossing; crossing of two phases for three-phase bridges)"
            />
          )}
          <h3>Load current</h3>
          <label className="check">
            <input type="checkbox" checked={c.load} onChange={(e) => set({ load: e.target.checked })} />
            Add the load current (R-L-E load)
          </label>
          {c.load && (
            <>
              <NumberField label="R" unit="Ω" positive value={c.r} onCommit={(v) => set({ r: v })} />
              <NumberField label="L" unit="H" min={0} value={c.l} onCommit={(v) => set({ l: v })} title="0 = resistive load" />
              <NumberField label="Back-EMF E" unit="V" value={c.e} onCommit={(v) => set({ e: v })} />
            </>
          )}
        </section>
        <section>
          <h3>Check</h3>
          <dl className="readout">
            <div>
              <dt>{exp.label}</dt>
              <dd>{formatSI(exp.value, 'V')}</dd>
            </div>
            {c.load && c.r > 0 && c.topology !== 'ac-controller' && (
              <div>
                <dt>
                  Mean load current (V<sub>o</sub> − E)/R
                </dt>
                <dd>{formatSI((exp.value - c.e) / c.r, 'A')}</dd>
              </div>
            )}
          </dl>
          {continuous && (
            <p className="hint-text">
              Continuous conduction is assumed (highly inductive load): the output follows the firing pattern whatever the current. With
              a load, check that the computed current stays positive.
            </p>
          )}
          {c.load && !continuous && c.l > 0 && c.topology !== 'full-diode' && c.topology !== 'three-diode' && (
            <p className="warn">
              With an inductive load this circuit conducts beyond the zero crossing (extinction angle), which is not modelled here: the
              output voltage is the resistive-load one. Use a “continuous current” topology for inductive loads.
            </p>
          )}
          <p className="hint-text">
            Creates ordinary editable signals: source, the firing reference θ and gate signals (collapsed group), the output voltage and
            optionally the load current lowpass((v<sub>o</sub> − E)/R, L/R). Ideal devices, no source inductance.
          </p>
        </section>
      </div>
    </Modal>
  );
}
