/**
 * Measurement panel: cursor readouts and exact interval measurements of the target
 * signal (between time cursors 1–2, or over the visible window when they are off).
 */

import { useMemo, useState } from 'react';
import { measureInterval } from '../../core/measure/measure';
import { formatSI } from '../../core/units/si';
import { compiled } from '../../state/compiled';
import { actions, findSignal, orderedSignals, useEditor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { MathLabel } from '../MathLabel';
import { openSpectrum } from './SpectrumDialog';

const fmt = (v: number, unit: string, digits = 5, scale = 0) =>
  Number.isFinite(v) ? formatSI(Math.abs(v) <= 1e-9 * scale ? 0 : v, unit, digits) : '—';

export function MeasurePanel({ phone = false }: { phone?: boolean }) {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const selectedId = useEditor((s) => s.selectedId);
  const [open, setOpen] = useState(true);
  const c = view.cursors;
  const visible = orderedSignals(project).filter((s) => s.style.visible);
  const target = findSignal(project, c.target) ?? visible.find((s) => s.id === selectedId) ?? visible[0];
  const sig = target ? compiled(target, project) : null;
  const unit = target?.unit ?? '';
  const [t1, t2] = c.t;
  const [y1, y2] = c.y;
  const between = t1 != null && t2 != null && t1 !== t2;
  const a = between ? Math.min(t1, t2) : view.xRange[0];
  const b = between ? Math.max(t1, t2) : view.xRange[1];
  const m = useMemo(() => (sig ? measureInterval(sig, a, b) : null), [sig, a, b]);
  const v1 = sig && t1 != null ? sig.value(t1) : NaN;
  const v2 = sig && t2 != null ? sig.value(t2) : NaN;
  const timeOn = t1 != null || t2 != null;
  const levelOn = y1 != null || y2 != null;

  const header = (
    <div className="measure-head">
      {!phone && (
        <button className="icon chevron" aria-label={open ? 'Collapse measurements' : 'Expand measurements'} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'}
        </button>
      )}
      <strong>Measurements</strong>
      <select
        aria-label="Measured signal"
        value={c.target ?? ''}
        onChange={(e) => actions.setCursors({ target: e.target.value || null })}
        title="Signal measured by the cursors"
      >
        <option value="">Selected signal{target && !c.target ? ` (${target.name})` : ''}</option>
        {visible.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button className={`toggle${timeOn ? ' on' : ''}`} onClick={actions.toggleTimeCursors} title="Show/hide time cursors 1 and 2 (drag them in the plot)">
        Time cursors
      </button>
      <button className={`toggle${levelOn ? ' on' : ''}`} onClick={actions.toggleLevelCursors} title="Show/hide level cursors A and B in the measured signal's panel">
        Level cursors
      </button>
      <button onClick={openSpectrum} title="Harmonic spectrum and THD of the measured signal">
        Spectrum…
      </button>
    </div>
  );

  if (!open && !phone) return <section className="measure collapsed">{header}</section>;

  return (
    <section className={`measure${phone ? ' phone' : ''}`} aria-label="Measurements">
      {header}
      {!target || !sig ? (
        <p className="hint-text">Add a visible signal to measure.</p>
      ) : (
        <div className="measure-body">
          {timeOn && (
            <div className="m-group">
              <h4>Time cursors</h4>
              {([0, 1] as const).map((i) => {
                const t = c.t[i];
                return t == null ? null : (
                  <div key={i} className="m-cursor">
                    <NumberField label={`Cursor ${i + 1}`} unit="s" value={t} onCommit={(v) => actions.setCursor('t', i, v)} />
                    <span className="m-val">{fmt(i === 0 ? v1 : v2, unit)}</span>
                  </div>
                );
              })}
              {between && (
                <dl className="m-grid">
                  <dt>Δt</dt>
                  <dd>{fmt(t2! - t1!, 's', 6)}</dd>
                  <dt>1/Δt</dt>
                  <dd>{fmt(1 / Math.abs(t2! - t1!), 'Hz')}</dd>
                  <dt>ΔY</dt>
                  <dd>{fmt(v2 - v1, unit)}</dd>
                </dl>
              )}
            </div>
          )}
          {levelOn && (
            <div className="m-group">
              <h4>Level cursors</h4>
              {([0, 1] as const).map((i) => {
                const v = c.y[i];
                return v == null ? null : (
                  <NumberField key={i} label={`Cursor ${i === 0 ? 'A' : 'B'}`} unit={unit} value={v} onCommit={(x) => actions.setCursor('y', i, x)} />
                );
              })}
              {y1 != null && y2 != null && (
                <dl className="m-grid">
                  <dt>ΔAB</dt>
                  <dd>{fmt(y2 - y1, unit)}</dd>
                </dl>
              )}
            </div>
          )}
          {m && (
            <div className="m-group wide">
              <h4>
                <MathLabel text={target.name} /> · {between ? 'between cursors 1–2' : 'visible window'}{' '}
                <span className="muted">({fmt(b - a, 's', 4)})</span>
              </h4>
              <dl className="m-grid">
                <dt>Max</dt>
                <dd>{fmt(m.max, unit)}</dd>
                <dt>Min</dt>
                <dd>{fmt(m.min, unit)}</dd>
                <dt>Pk-pk</dt>
                <dd>{fmt(m.peakToPeak, unit)}</dd>
                <dt>Mean</dt>
                <dd>{fmt(m.mean, unit, 5, Math.max(Math.abs(m.max), Math.abs(m.min)))}</dd>
                <dt>RMS</dt>
                <dd>{fmt(m.rms, unit)}</dd>
                <dt title={`Fraction of time above the mid level ${fmt(m.threshold, unit)}`}>Duty</dt>
                <dd>{Number.isFinite(m.duty) ? `${(m.duty * 100).toPrecision(4)} %` : '—'}</dd>
                <dt title="From same-direction crossings of the mid level">Freq</dt>
                <dd>{fmt(m.frequency, 'Hz')}</dd>
              </dl>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
