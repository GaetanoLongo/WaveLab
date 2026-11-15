/** Serial protocol dialog: UART / SPI / I²C frames with decoded-field labels. */

import { useState } from 'react';
import { create } from 'zustand';
import { formatSI } from '../../core/units/si';
import { DEFAULT_PROTOCOL, parseBytes, type Protocol, type ProtocolConfig } from '../../state/protocols';
import { actions } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

export const useProtocolDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openProtocol = () => useProtocolDialog.setState({ open: true });
const close = () => useProtocolDialog.setState({ open: false });

const KEY = 'wavelab.protocol.v1';
function load(): ProtocolConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PROTOCOL, ...(JSON.parse(raw) as Partial<ProtocolConfig>) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_PROTOCOL };
}

export function ProtocolDialog() {
  const open = useProtocolDialog((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const [c, setC] = useState<ProtocolConfig>(load);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProtocolConfig>) => setC((p) => ({ ...p, ...patch }));
  const bytes = parseBytes(c.data, c.dataFormat);
  const create = () => {
    const err = actions.createProtocol(c);
    if (err) return setError(err);
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      /* ignore */
    }
    close();
  };
  const frameBits = c.protocol === 'uart' ? 1 + c.dataBits + (c.parity !== 'none' ? 1 : 0) + c.stopBits : c.protocol === 'spi' ? 8 : 9;
  const rate = c.protocol === 'uart' ? c.baud : c.protocol === 'spi' ? c.spiClock : c.i2cClock;
  return (
    <Modal
      title="Serial protocol frames"
      onClose={close}
      className="protocol-dialog pwm-dialog"
      footer={
        <>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={create} disabled={!bytes || !bytes.length}>
            Create signals
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <section>
          <h3>Protocol</h3>
          <div className="seg" role="group" aria-label="Protocol">
            {(['uart', 'spi', 'i2c'] as Protocol[]).map((p) => (
              <button key={p} className={c.protocol === p ? 'on' : ''} onClick={() => set({ protocol: p })}>
                {p === 'i2c' ? 'I²C' : p.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="field">
            <label>Data</label>
            <input value={c.data} onChange={(e) => set({ data: e.target.value })} spellCheck={false} />
          </div>
          <div className="field">
            <label>Format</label>
            <select value={c.dataFormat} onChange={(e) => set({ dataFormat: e.target.value as ProtocolConfig['dataFormat'] })}>
              <option value="text">Text (one byte per character)</option>
              <option value="hex">Hex bytes (48 65 0x6C)</option>
            </select>
          </div>
          <NumberField label="High level" unit="V" value={c.high} onCommit={(v) => set({ high: v })} />
          <NumberField label="Low level" unit="V" value={c.low} onCommit={(v) => set({ low: v })} />
        </section>
        <section>
          {c.protocol === 'uart' && (
            <>
              <h3>UART</h3>
              <NumberField label="Baud rate" unit="Bd" positive value={c.baud} onCommit={(v) => set({ baud: v })} />
              <div className="field">
                <label>Frame</label>
                <div className="field-inline">
                  <select value={c.dataBits} onChange={(e) => set({ dataBits: Number(e.target.value) })} aria-label="Data bits">
                    {[5, 6, 7, 8].map((n) => (
                      <option key={n} value={n}>
                        {n} data
                      </option>
                    ))}
                  </select>
                  <select value={c.parity} onChange={(e) => set({ parity: e.target.value as ProtocolConfig['parity'] })} aria-label="Parity">
                    <option value="none">no parity</option>
                    <option value="even">even</option>
                    <option value="odd">odd</option>
                  </select>
                  <select value={c.stopBits} onChange={(e) => set({ stopBits: Number(e.target.value) as 1 | 2 })} aria-label="Stop bits">
                    <option value={1}>1 stop</option>
                    <option value={2}>2 stop</option>
                  </select>
                </div>
              </div>
              <NumberField label="Idle bits between frames" plain min={0} max={100} value={c.gap} onCommit={(v) => set({ gap: Math.round(v) })} />
            </>
          )}
          {c.protocol === 'spi' && (
            <>
              <h3>SPI</h3>
              <NumberField label="Clock" unit="Hz" positive value={c.spiClock} onCommit={(v) => set({ spiClock: v })} />
              <div className="field">
                <label>Mode</label>
                <select value={c.spiMode} onChange={(e) => set({ spiMode: Number(e.target.value) as 0 | 1 | 2 | 3 })}>
                  <option value={0}>0 (CPOL 0, CPHA 0)</option>
                  <option value={1}>1 (CPOL 0, CPHA 1)</option>
                  <option value={2}>2 (CPOL 1, CPHA 0)</option>
                  <option value={3}>3 (CPOL 1, CPHA 1)</option>
                </select>
              </div>
              <label className="check">
                <input type="checkbox" checked={c.lsbFirst} onChange={(e) => set({ lsbFirst: e.target.checked })} />
                LSB first
              </label>
              <div className="field">
                <label>MISO data</label>
                <input value={c.miso} onChange={(e) => set({ miso: e.target.value })} placeholder="empty = no MISO line" spellCheck={false} />
              </div>
            </>
          )}
          {c.protocol === 'i2c' && (
            <>
              <h3>I²C</h3>
              <NumberField label="SCL clock" unit="Hz" positive value={c.i2cClock} onCommit={(v) => set({ i2cClock: v })} />
              <div className="field">
                <label>Address (7-bit, hex)</label>
                <input
                  defaultValue={c.address.toString(16).toUpperCase()}
                  onBlur={(e) => {
                    const v = parseInt(e.target.value.replace(/^0x/i, ''), 16);
                    if (v >= 0 && v < 128) set({ address: v });
                    else e.target.value = c.address.toString(16).toUpperCase();
                  }}
                  spellCheck={false}
                />
              </div>
              <div className="field">
                <label>Direction</label>
                <select value={c.read ? 'r' : 'w'} onChange={(e) => set({ read: e.target.value === 'r' })}>
                  <option value="w">Write (master sends data)</option>
                  <option value="r">Read (slave sends data, NACK at the end)</option>
                </select>
              </div>
            </>
          )}
          <h3>Check</h3>
          <dl className="readout">
            <div>
              <dt>Bytes</dt>
              <dd>{bytes ? `${bytes.length}` : 'invalid hex'}</dd>
            </div>
            <div>
              <dt>Bit time</dt>
              <dd>{formatSI(1 / rate, 's')}</dd>
            </div>
            <div>
              <dt>Bits per byte on the wire</dt>
              <dd>{frameBits}</dd>
            </div>
          </dl>
          {error && <p className="warn">{error}</p>}
          <p className="hint-text">Creates bit-sequence signals (editable) and labels the decoded fields with dimension annotations.</p>
        </section>
      </div>
    </Modal>
  );
}
