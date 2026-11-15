/** AM / DSB-SC / FM / PM dialog: creates message, carrier and modulated signal. */

import { useState } from 'react';
import { create } from 'zustand';
import { DEFAULT_MODULATION, MODULATION_LABELS, modulationFigures, type ModulationConfig, type ModulationKind } from '../../state/modulation';
import { actions } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

export const useModulationDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openModulation = () => useModulationDialog.setState({ open: true });
const close = () => useModulationDialog.setState({ open: false });

const KEY = 'wavelab.modulation.v1';
function load(): ModulationConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_MODULATION, ...(JSON.parse(raw) as Partial<ModulationConfig>) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_MODULATION };
}

export function ModulationDialog() {
  const open = useModulationDialog((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const [c, setC] = useState<ModulationConfig>(load);
  const set = (patch: Partial<ModulationConfig>) => setC((p) => ({ ...p, ...patch }));
  const create = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    actions.createModulation(c);
    close();
  };
  return (
    <Modal
      title="Modulation (AM / FM / PM)"
      onClose={close}
      className="modulation-dialog pwm-dialog"
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
          <h3>Modulation</h3>
          <div className="field">
            <label>Type</label>
            <select value={c.kind} onChange={(e) => set({ kind: e.target.value as ModulationKind })}>
              {(Object.keys(MODULATION_LABELS) as ModulationKind[]).map((k) => (
                <option key={k} value={k}>
                  {MODULATION_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <NumberField label="Carrier f_c" unit="Hz" positive value={c.fc} onCommit={(v) => set({ fc: v })} />
          <NumberField label="Carrier amplitude A_c" unit="V" positive value={c.ac} onCommit={(v) => set({ ac: v })} />
          {c.kind === 'am' && <NumberField label="Modulation index μ" plain min={0} max={10} value={c.mu} onCommit={(v) => set({ mu: v })} />}
          {c.kind === 'fm' && <NumberField label="Frequency deviation Δf" unit="Hz" min={0} value={c.deviation} onCommit={(v) => set({ deviation: v })} />}
          {c.kind === 'pm' && <NumberField label="Phase deviation k_p" unit="rad" plain min={0} max={1000} value={c.kp} onCommit={(v) => set({ kp: v })} />}
          <h3>Message m(t) (±1)</h3>
          <div className="field">
            <label>Shape</label>
            <select value={c.message} onChange={(e) => set({ message: e.target.value as ModulationConfig['message'] })}>
              <option value="sine">Sine</option>
              <option value="square">Square</option>
              <option value="triangle">Triangle</option>
            </select>
          </div>
          <NumberField label="Message f_m" unit="Hz" positive value={c.fm} onCommit={(v) => set({ fm: v })} />
        </section>
        <section>
          <h3>Check</h3>
          <dl className="readout">
            {modulationFigures(c).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          {c.fc / c.fm < 4 && <p className="warn">The carrier is not much faster than the message: the result is hard to read.</p>}
          <p className="hint-text">
            Creates ordinary editable signals: the message, the carrier (or its phase ramp θ_c for FM/PM, collapsed group) and the modulated
            signal{c.kind === 'am' ? ' with its envelope' : ''}. Use Spectrum… on the result: with a sine message the FM/PM lines follow the
            Bessel functions J_n(β).
          </p>
        </section>
      </div>
    </Modal>
  );
}
