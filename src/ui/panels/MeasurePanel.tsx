import { plainText } from '../../core/plot/mathtext';
/**
 * Measurement panel: cursor readouts and exact interval measurements of the target
 * signal (between time cursors 1–2, or over the visible window when they are off).
 */

import { useEffect, useMemo, useState } from 'react';
import { measureInterval } from '../../core/measure/measure';
import { powerMetrics } from '../../core/measure/power';
import { autoFundamental } from '../../state/fundamental';
import { formatSI } from '../../core/units/si';
import { compiled } from '../../state/compiled';
import { actions, findSignal, orderedSignals, useEditor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { MathLabel } from '../MathLabel';
import { Resizer } from '../Resizer';
import { setLayout, useLayout } from '../../state/layout';
import { openSpectrum } from './SpectrumDialog';
import { openViews } from './ViewsDialog';

const fmt = (v: number, unit: string, digits = 5, scale = 0) =>
  Number.isFinite(v) ? formatSI(Math.abs(v) <= 1e-9 * scale ? 0 : v, unit, digits) : '—';

/** The window [x0, x1], updated 250 ms after it stops changing (immediately on first use). */
function useSettledWindow(x0: number, x1: number): [number, number] {
  const [w, setW] = useState<[number, number]>([x0, x1]);
  useEffect(() => {
    if (w[0] === x0 && w[1] === x1) return;
    const t = setTimeout(() => setW([x0, x1]), 250);
    return () => clearTimeout(t);
  }, [x0, x1, w]);
  return w;
}

export function MeasurePanel({ phone = false }: { phone?: boolean }) {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const selectedId = useEditor((s) => s.selectedId);
  const open = useLayout((s) => s.measureOpen);
  const height = useLayout((s) => s.measureH);
  const setOpen = (fn: (o: boolean) => boolean) => setLayout({ measureOpen: fn(useLayout.getState().measureOpen) });
  const c = view.cursors;
  const visible = orderedSignals(project).filter((s) => s.style.visible);
  const target = findSignal(project, c.target) ?? visible.find((s) => s.id === selectedId) ?? visible[0];
  const sig = target ? compiled(target, project) : null;
  const unit = target?.unit ?? '';
  const [t1, t2] = c.t;
  const [y1, y2] = c.y;
  const between = t1 != null && t2 != null && t1 !== t2;
  // The visible window changes continuously while zooming; measuring it exactly costs up to seconds
  // on dense PWM signals, so it follows the view only once the view has settled (cursor intervals
  // are immediate). Nothing is measured while the panel is collapsed.
  const settled = useSettledWindow(view.xRange[0], view.xRange[1]);
  const a = between ? Math.min(t1, t2) : settled[0];
  const b = between ? Math.max(t1, t2) : settled[1];
  const active = open || phone;
  const m = useMemo(() => (sig && active ? measureInterval(sig, a, b) : null), [sig, a, b, active]);
  const v1 = sig && t1 != null ? sig.value(t1) : NaN;
  const v2 = sig && t2 != null ? sig.value(t2) : NaN;
  // Power: the measured signal is the voltage, the chosen signal the current.
  const [currentId, setCurrentId] = useState<string | null>(null);
  const others = visible.filter((s) => s.id !== target?.id);
  const cur = others.find((s) => s.id === currentId) ?? others.find((s) => s.unit === 'A') ?? null;
  const pw = useMemo(() => {
    if (!sig || !target || !cur || !active) return null;
    const ie = compiled(cur, project);
    const fund = autoFundamental(project, target, sig, b - a);
    return { m: powerMetrics(sig, ie, a, b, fund.source === 'span' ? undefined : { f1: fund.f1, periods: fund.periods, t0: a }), f1: fund.f1 };
  }, [sig, target, cur, project, a, b, active]);
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
        <option value="">Selected signal{target && !c.target ? ` (${plainText(target.name)})` : ''}</option>
        {visible.map((s) => (
          <option key={s.id} value={s.id}>
            {plainText(s.name)}
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
      <button onClick={() => openViews('xy')} title="XY (Lissajous) plot of two signals over the visible window">
        XY…
      </button>
      <button onClick={() => openViews('eye')} title="Eye diagram: the signal folded over its bit time">
        Eye…
      </button>
    </div>
  );

  if (!open && !phone) return <section className="measure collapsed">{header}</section>;
  const sizing = !phone && height !== null ? { height, maxHeight: 'none' } : undefined;

  return (
    <section className={`measure${phone ? ' phone' : ''}`} aria-label="Measurements" style={sizing}>
      {!phone && (
        <Resizer
          orientation="row"
          label="Resize measurements"
          size={(el) => height ?? el.getBoundingClientRect().height}
          onResize={(d, s) => setLayout({ measureH: s - d })}
          onReset={() => setLayout({ measureH: null })}
        />
      )}
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
                  <dd>{fmt(Math.abs(v2 - v1) <= 1e-10 * Math.max(Math.abs(v1), Math.abs(v2)) ? 0 : v2 - v1, unit)}</dd>
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
                <dt title="Peak (largest |value|) / RMS">Crest</dt>
                <dd>{Number.isFinite(m.crest) ? m.crest.toPrecision(4) : '—'}</dd>
                <dt title="RMS / rectified mean (mean of |value|)">Form</dt>
                <dd>{Number.isFinite(m.form) ? m.form.toPrecision(4) : '—'}</dd>
              </dl>
            </div>
          )}
          {m && others.length > 0 && (
            <div className="m-group wide power">
              <h4>
                Power · <MathLabel text={target.name} /> ×{' '}
                <select aria-label="Current signal" value={cur?.id ?? ''} onChange={(e) => setCurrentId(e.target.value || null)} title="Current signal (the measured signal is the voltage)">
                  <option value="">(choose the current)</option>
                  {others.map((s) => (
                    <option key={s.id} value={s.id}>
                      {plainText(s.name)}
                    </option>
                  ))}
                </select>
              </h4>
              {pw && (
                <dl className="m-grid">
                  <dt title="Active power: mean of v·i">P</dt>
                  <dd>{fmt(pw.m.p, 'W')}</dd>
                  <dt title="Apparent power: Vrms · Irms (rms voltage × rms current)">S</dt>
                  <dd>{fmt(pw.m.s, 'VA')}</dd>
                  <dt title="Power factor P / S">PF</dt>
                  <dd>{Number.isFinite(pw.m.pf) ? pw.m.pf.toFixed(4) : '—'}</dd>
                  <dt title="Non-active power √(S² − P²) (reactive and distortion)">N</dt>
                  <dd>{fmt(pw.m.n, 'var')}</dd>
                  <dt title={`Fundamental reactive power V₁·I₁·sin φ₁ at ${formatSI(pw.f1, 'Hz')} (whole periods from the interval start); > 0 = inductive`}>Q₁</dt>
                  <dd>{fmt(pw.m.q1, 'var')}</dd>
                  <dt title="Displacement power factor cos φ₁ (fundamentals)">DPF</dt>
                  <dd>{Number.isFinite(pw.m.dpf) ? pw.m.dpf.toFixed(4) : '—'}</dd>
                </dl>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
