/** Harmonic spectrum of a signal: exact Fourier series, THD, bar chart, table, CSV. */

import { budgeted } from '../../core/signals/budget';
import { autoFundamental } from '../../state/fundamental';
import { plainText } from '../../core/plot/mathtext';
import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { harmonicSpectrum, unresolvedSpectrum, type Spectrum } from '../../core/measure/spectrum';
import { formatSI } from '../../core/units/si';
import { compiled } from '../../state/compiled';
import { actions, findSignal, orderedSignals, useEditor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { downloadBlob, safeFileName } from '../fileio';
import { MathLabel } from '../MathLabel';
import { Modal } from '../Modal';

export const useSpectrum = create<{ open: boolean }>(() => ({ open: false }));
export const openSpectrum = () => useSpectrum.setState({ open: true });
const close = () => useSpectrum.setState({ open: false });

type Scale = 'peak' | 'rms' | 'percent' | 'db';

export function SpectrumDialog() {
  const open = useSpectrum((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const view = useEditor((s) => s.view);
  const visible = orderedSignals(project).filter((s) => s.style.visible);
  const [sigId, setSigId] = useState(() => actions.measureTarget()?.id ?? selectedId ?? visible[0]?.id ?? '');
  const sig = findSignal(project, sigId) ?? visible[0];
  const ev = sig ? compiled(sig, project) : null;
  const auto = sig && ev ? autoFundamental(project, sig, ev, view.xRange[1] - view.xRange[0]) : { f1: 1, periods: 1, source: 'span' as const };
  const [f1, setF1] = useState<number | null>(null); // null = automatic (fundamental and periods)
  const [periodsSet, setPeriods] = useState(1);
  const periods = f1 === null ? auto.periods : periodsSet;
  const [t0, setT0] = useState(0);
  const [maxOrder, setMaxOrder] = useState(50);
  const [scale, setScale] = useState<Scale>('peak');
  const [showDc, setShowDc] = useState(false);
  const fund = f1 ?? auto.f1;

  const spec = useMemo(() => (ev ? budgeted(ev, 8000, () => harmonicSpectrum(ev, { f1: fund, periods, t0, maxOrder }), () => unresolvedSpectrum({ f1: fund, periods, t0, maxOrder })) : null), [ev, fund, periods, t0, maxOrder]);
  const unit = sig?.unit ?? '';

  const value = (s: Spectrum, k: number): number => {
    const a = s.amp[k]!;
    if (scale === 'peak') return a;
    if (scale === 'rms') return k === 0 ? a : a / Math.SQRT2;
    if (scale === 'percent') return s.fundamental > 0 ? (100 * Math.abs(a)) / s.fundamental : NaN;
    return s.fundamental > 0 ? 20 * Math.log10(Math.max(Math.abs(a), 1e-300) / s.fundamental) : NaN;
  };
  const fmtVal = (v: number) =>
    !Number.isFinite(v) ? '—' : scale === 'percent' ? `${v.toPrecision(4)} %` : scale === 'db' ? `${v.toFixed(1)} dB` : formatSI(v, unit, 5);

  const exportCsv = () => {
    if (!spec || !sig) return;
    const rows = ['order,frequency_Hz,amplitude_peak,amplitude_rms,percent_of_fundamental,phase_deg_cos'];
    spec.orders.forEach((h, k) => {
      const a = spec.amp[k]!;
      rows.push(
        [h, h * spec.f1, a, k === 0 ? a : a / Math.SQRT2, spec.fundamental ? (100 * Math.abs(a)) / spec.fundamental : '', spec.phaseDeg[k]]
          .map((x) => (typeof x === 'number' ? Number(x.toPrecision(12)) : x))
          .join(','),
      );
    });
    downloadBlob(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }), `${safeFileName(sig.name)}-spectrum.csv`);
  };

  const table = spec
    ? spec.orders
        .map((h, k) => ({ h, k }))
        .filter(({ k }) => k > 0 && spec.amp[k]! > 1e-6 * Math.max(spec.fundamental, 1e-300))
        .slice(0, 60)
    : [];

  return (
    <Modal
      title="Spectrum"
      onClose={close}
      className="spectrum-dialog"
      footer={
        <>
          <button onClick={exportCsv} disabled={!spec}>
            Export CSV
          </button>
          <button className="primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      {!sig || !ev || !spec ? (
        <p className="hint-text">Add a visible signal first.</p>
      ) : (
        <div className="spectrum-body">
          <div className="spectrum-controls">
            <div className="field">
              <label>Signal</label>
              <select value={sig.id} onChange={(e) => setSigId(e.target.value)}>
                {visible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {plainText(s.name)}
                  </option>
                ))}
              </select>
            </div>
            <NumberField
              label="Fundamental"
              unit="Hz"
              positive
              value={fund}
              onCommit={(v) => {
                if (f1 === null) setPeriods(periods);
                setF1(v);
              }}
              title="Harmonic orders are multiples of this frequency"
            />
            <button className="link-btn" onClick={() => setF1(null)} disabled={f1 === null}>
              Auto (
              {auto.source === 'input'
                ? `${auto.inputName ? plainText(auto.inputName) : 'input'} ${formatSI(auto.f1, 'Hz')}${auto.periods > 1 ? `, ${auto.periods} periods` : ''}`
                : auto.source === 'period'
                  ? `1 / period = ${formatSI(auto.f1, 'Hz')}`
                  : 'visible span'}
              )
            </button>
            <NumberField
              label="Periods"
              plain
              min={1}
              max={1000}
              value={periods}
              onCommit={(v) => {
                setF1(fund);
                setPeriods(Math.max(1, Math.round(v)));
              }}
              title="Window = periods / fundamental"
            />
            {f1 === null && auto.fullPeriods && (
              <p className="hint-text">
                The pattern repeats only after {auto.fullPeriods} periods; {auto.periods} are used, so the spectrum is approximate (a little leakage between harmonics). Set “Periods” higher for an exact (slower) result.
              </p>
            )}
            <NumberField label="Start t₀" unit="s" value={t0} onCommit={setT0} />
            <NumberField label="Max order" plain min={1} max={2000} value={maxOrder} onCommit={(v) => setMaxOrder(Math.max(1, Math.round(v)))} />
            <div className="field">
              <label>Scale</label>
              <select value={scale} onChange={(e) => setScale(e.target.value as Scale)}>
                <option value="peak">Amplitude (peak)</option>
                <option value="rms">Amplitude (RMS)</option>
                <option value="percent">% of fundamental</option>
                <option value="db">dB rel. fundamental</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={showDc} onChange={(e) => setShowDc(e.target.checked)} />
              Show DC bar
            </label>
            <dl className="readout spectrum-summary">
              <div>
                <dt>DC</dt>
                <dd>{formatSI(spec.dc, unit, 5)}</dd>
              </div>
              <div>
                <dt>Fundamental</dt>
                <dd>
                  {formatSI(spec.fundamental, unit, 5)} pk · {formatSI(spec.fundamental / Math.SQRT2, unit, 5)} rms
                </dd>
              </div>
              <div>
                <dt>RMS (total)</dt>
                <dd>{formatSI(spec.rms, unit, 5)}</dd>
              </div>
              <div>
                <dt>THD</dt>
                <dd>{Number.isFinite(spec.thd) ? `${(spec.thd * 100).toPrecision(4)} %` : '— (no fundamental)'}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>
                  {formatSI(spec.window[0], 's')} → {formatSI(spec.window[1], 's')}
                </dd>
              </div>
            </dl>
            {spec.unresolved && <p className="warn">The window holds too many edges to compute exactly, or it takes too long (over 8 s). Use a higher fundamental, fewer periods or a lower max order.</p>}
            {!spec.exactWindow && !spec.unresolved && (
              <p className="warn">
                The window is not a whole number of the signal's periods
                {ev.period ? '' : ' (the signal is not periodic)'}: the result is the Fourier series of this window repeated, so expect spectral spreading.
              </p>
            )}
            <p className="hint-text">Exact Fourier series (no FFT). THD from the exact RMS, independent of the max order.</p>
          </div>
          <div className="spectrum-main">
            <h3>
              <MathLabel text={sig.name} /> · harmonics of {formatSI(spec.f1, 'Hz')}
            </h3>
            <BarChart spec={spec} value={(k) => value(spec, k)} scale={scale} showDc={showDc} unit={unit} />
            <table className="harmonics">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Frequency</th>
                  <th>Amplitude</th>
                  <th>Phase (cos)</th>
                </tr>
              </thead>
              <tbody>
                {table.map(({ h, k }) => (
                  <tr key={k}>
                    <td>{Number(h.toPrecision(6))}</td>
                    <td>{formatSI(h * spec.f1, 'Hz', 5)}</td>
                    <td>{fmtVal(value(spec, k))}</td>
                    <td>{spec.phaseDeg[k]!.toFixed(1)}°</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** Simple SVG bar chart of harmonic magnitudes. */
function BarChart({ spec, value, scale, showDc, unit }: { spec: Spectrum; value(k: number): number; scale: Scale; showDc: boolean; unit: string }) {
  const W = 640;
  const H = 260;
  const m = { l: 56, r: 12, t: 10, b: 34 };
  const ks = spec.orders.map((_, k) => k).filter((k) => showDc || k > 0);
  const vals = ks.map((k) => value(k));
  const db = scale === 'db';
  const floor = -80;
  // A loop, not Math.max(...spread): a long spectrum can exceed the engine's argument limit.
  let peak = 1e-300;
  for (const v of vals) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  const top = db ? 5 : peak * 1.08;
  const fundIndex = Math.round(spec.orders.indexOf(1)); // once, not once per bar
  const bottom = db ? floor : 0;
  const maxH = spec.orders[spec.orders.length - 1]!;
  const minH = showDc ? 0 : (spec.orders[1] ?? 0);
  const x = (h: number) => m.l + ((h - minH) / Math.max(1e-12, maxH - minH)) * (W - m.l - m.r);
  const y = (v: number) => m.t + (1 - (Math.max(bottom, Math.min(top, v)) - bottom) / (top - bottom)) * (H - m.t - m.b);
  const bw = Math.max(1, Math.min(14, ((W - m.l - m.r) / Math.max(1, ks.length)) * 0.6));
  const yTicks = db ? [0, -20, -40, -60, -80] : [0, 0.25, 0.5, 0.75, 1].map((f) => (f * top) / 1.08);
  // Round tick steps (1, 2, 5, 10, 20, 50 …) and the fundamental.
  const raw = Math.max(1, maxH / 10);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const xStep = [1, 2, 5, 10].map((f) => f * mag).find((v) => v >= raw) ?? 10 * mag;
  const xTicks: number[] = minH <= 1 ? [1] : [];
  for (let h = Math.ceil(minH / xStep) * xStep; h <= maxH; h += xStep) if (h > 1 || minH > 1) xTicks.push(h);
  return (
    <svg className="bar-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Harmonic spectrum bar chart">
      {yTicks.map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={m.l - 6} y={y(v)} textAnchor="end" dominantBaseline="central" className="tick">
            {db ? `${v}` : scale === 'percent' ? `${Number(v.toPrecision(3))}` : formatSI(v, '', 3)}
          </text>
        </g>
      ))}
      {xTicks.map((h) => (
        <text key={h} x={x(h)} y={H - m.b + 14} textAnchor="middle" className="tick">
          {h}
        </text>
      ))}
      <text x={(W + m.l) / 2} y={H - 4} textAnchor="middle" className="axis-title">
        Harmonic order
      </text>
      <text x={12} y={H / 2} textAnchor="middle" transform={`rotate(-90 12 ${H / 2})`} className="axis-title">
        {db ? 'dB' : scale === 'percent' ? '% of fundamental' : unit || 'amplitude'}
      </text>
      {ks.map((k, i) => {
        const v = vals[i]!;
        if (!Number.isFinite(v)) return null;
        const yv = y(db ? v : Math.abs(v));
        return (
          <rect
            key={k}
            x={x(spec.orders[k]!) - bw / 2}
            y={Math.min(yv, y(bottom))}
            width={bw}
            height={Math.abs(y(bottom) - yv)}
            className={k === fundIndex ? 'bar fund' : 'bar'}
          >
            <title>
              order {Number(spec.orders[k]!.toPrecision(6))}: {db ? `${v.toFixed(1)} dB` : formatSI(v, scale === 'percent' ? '%' : unit, 4)}
            </title>
          </rect>
        );
      })}
      <line x1={m.l} x2={W - m.r} y1={y(bottom)} y2={y(bottom)} className="axis" />
    </svg>
  );
}
