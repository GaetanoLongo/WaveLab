/** PWM generator dialog: creates an editable signal set for a carrier-based modulation. */

import { useState } from 'react';
import { create } from 'zustand';
import { formatSI } from '../../core/units/si';
import { DEFAULT_PWM, expectedFundamental, type PwmConfig, type PwmTopology } from '../../state/pwm';
import { actions } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

export const usePwmDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openPwm = () => usePwmDialog.setState({ open: true });
const close = () => usePwmDialog.setState({ open: false });

const KEY = 'wavelab.pwm.v1';
function load(): PwmConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PWM, ...(JSON.parse(raw) as Partial<PwmConfig>) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_PWM };
}

export function PwmDialog() {
  const open = usePwmDialog((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const [c, setC] = useState<PwmConfig>(load);
  const set = (patch: Partial<PwmConfig>) => setC((p) => ({ ...p, ...patch }));
  const mf = c.fc / c.f1;
  const exp = expectedFundamental(c);
  const create = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    actions.createPwm(c);
    close();
  };

  return (
    <Modal
      title="PWM generator"
      onClose={close}
      className="pwm-dialog"
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
          <h3>Converter</h3>
          <div className="field">
            <label>Topology</label>
            <select value={c.topology} onChange={(e) => set({ topology: e.target.value as PwmTopology })}>
              <option value="half">Half bridge (one leg)</option>
              <option value="full-bipolar">Full bridge, bipolar</option>
              <option value="full-unipolar">Full bridge, unipolar</option>
              <option value="three-phase">Three-phase bridge</option>
            </select>
          </div>
          <NumberField label="DC bus V_dc" unit="V" positive value={c.vdc} onCommit={(v) => set({ vdc: v })} />
          <h3>Modulation</h3>
          <NumberField label="Modulation index m" plain min={0} max={2} value={c.m} onCommit={(v) => set({ m: v })} title="Reference peak / carrier peak" />
          <NumberField label="Reference f₁" unit="Hz" positive value={c.f1} onCommit={(v) => set({ f1: v })} />
          <NumberField label="Reference phase" unit="°" plain value={c.phaseDeg} onCommit={(v) => set({ phaseDeg: v })} />
          <div className="field">
            <label>Carrier</label>
            <select value={c.carrier} onChange={(e) => set({ carrier: e.target.value as PwmConfig['carrier'] })}>
              <option value="triangle">Triangle (centre-aligned)</option>
              <option value="saw-up">Rising sawtooth (trailing edge)</option>
              <option value="saw-down">Falling sawtooth (leading edge)</option>
            </select>
          </div>
          <NumberField label="Carrier f_c" unit="Hz" positive value={c.fc} onCommit={(v) => set({ fc: v })} />
        </section>
        <section>
          <h3>Gates</h3>
          <label className="check">
            <input type="checkbox" checked={c.complementary} onChange={(e) => set({ complementary: e.target.checked })} />
            Lower (complementary) switches
          </label>
          <NumberField
            label="Dead time t_d"
            unit="s"
            min={0}
            value={c.deadTime}
            onCommit={(v) => set({ deadTime: v })}
            title="Both turn-on edges of each pair delayed by t_d; turn-off edges unchanged (0 = none)"
          />
          <h3>Check</h3>
          <dl className="readout">
            <div>
              <dt>m_f = f_c / f₁</dt>
              <dd>{Number(mf.toPrecision(6))}</dd>
            </div>
            <div>
              <dt>{exp.label}</dt>
              <dd>{c.m <= 1 ? formatSI(exp.value, 'V') : 'nonlinear (m > 1)'}</dd>
            </div>
            {c.topology === 'full-unipolar' && (
              <div>
                <dt>Output ripple frequency</dt>
                <dd>{formatSI(2 * c.fc, 'Hz')} (2·f_c)</dd>
              </div>
            )}
          </dl>
          {c.m > 1 && <p className="warn">Overmodulation (m &gt; 1): pulses are dropped and low-order harmonics appear.</p>}
          {Math.abs(mf - Math.round(mf)) > 1e-9 && (
            <p className="hint-text">Non-integer m_f: the pattern repeats only after several reference periods (the spectrum dialog handles this with more periods).</p>
          )}
          <p className="hint-text">
            Creates ordinary editable signals in new groups: carrier and references (shared panel), leg commands, gate signals and ideal
            pole/output voltages. Output voltages ignore dead time: during dead time the real output depends on the load current direction.
          </p>
        </section>
      </div>
    </Modal>
  );
}
