/** Axis settings: visible time range (zoom to interval), titles, ticks, decimals, vertical ranges, log scale. */

import { useEffect, useRef } from 'react';
import { autoLogRange, type AxisStyle } from '../../core/plot/layout';
import { compiled } from '../../state/compiled';
import { actions, orderedSignals, useEditor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { MathLabel } from '../MathLabel';
import { Modal, useDialogs } from '../Modal';
import { TextField } from './PropertiesPanel';

const close = () => useDialogs.setState({ axes: null });

export function AxesDialog() {
  const focus = useDialogs((s) => s.axes);
  return focus !== null ? <Dialog focus={focus} /> : null;
}

function Dialog({ focus }: { focus: string }) {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const fig = project.figures[0]!;
  const ref = useRef<HTMLDivElement>(null);
  const visible = orderedSignals(project).filter((s) => s.style.visible);
  const panels =
    fig.mode === 'overlay'
      ? [{ id: 'overlay', name: 'All signals (overlay)', sigs: visible }]
      : visible.map((s) => ({ id: `stack-${s.id}`, name: s.name, sigs: [s] }));

  useEffect(() => {
    ref.current?.querySelector(`[data-axis="${CSS.escape(focus)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focus]);

  const [t0, t1] = view.xRange;
  return (
    <Modal title="Axes" onClose={close} className="axes-dialog" footer={<button className="primary" onClick={close}>Done</button>}>
      <div ref={ref} className="axes-body">
        <section data-axis="x" className={focus === 'x' ? 'focused' : ''}>
          <h3>Time axis</h3>
          <div className="field-pair">
            <NumberField label="From" unit="s" value={t0} max={t1} onCommit={(v) => v < t1 && actions.setXRange([v, t1])} title="Zoom to a time interval" />
            <NumberField label="To" unit="s" value={t1} min={t0} onCommit={(v) => v > t0 && actions.setXRange([t0, v])} />
          </div>
          <AxisFields axis="x" style={fig.axes?.x} autoTitle="Time (automatic unit)" />
        </section>

        {panels.length === 0 && <p className="hint-text">No visible signals.</p>}
        {panels.map((p) => {
          const r = view.yRanges[p.id] ?? null;
          const canLog = autoLogRange(p.sigs.map((s) => compiled(s, project))) !== null || (r !== null && r[0] > 0);
          const style = fig.axes?.y?.[p.id];
          return (
            <section key={p.id} data-axis={p.id} className={focus === p.id ? 'focused' : ''}>
              <h3>
                Vertical axis · <MathLabel text={p.name} />
              </h3>
              <label className="check">
                <input type="checkbox" checked={r === null} onChange={(e) => actions.setYRange(p.id, e.target.checked ? null : (r ?? [-1, 1]))} />
                Automatic range
              </label>
              {r !== null && (
                <div className="field-pair">
                  <NumberField label="Min" value={r[0]} max={r[1]} onCommit={(v) => v < r[1] && actions.setYRange(p.id, [v, r[1]])} />
                  <NumberField label="Max" value={r[1]} min={r[0]} onCommit={(v) => v > r[0] && actions.setYRange(p.id, [r[0], v])} />
                </div>
              )}
              <label className="check" title={canLog ? '' : 'Needs strictly positive values in the visible data'}>
                <input
                  type="checkbox"
                  checked={!!style?.log}
                  disabled={!canLog && !style?.log}
                  onChange={(e) => actions.setAxisStyle(p.id, { log: e.target.checked })}
                />
                Logarithmic scale
              </label>
              {style?.log && !canLog && <p className="warn">The data is not strictly positive here, so the axis stays linear.</p>}
              <AxisFields axis={p.id} style={style} autoTitle="Signal name and unit" logScale={!!style?.log && canLog} />
            </section>
          );
        })}
      </div>
    </Modal>
  );
}

function AxisFields({ axis, style, autoTitle, logScale = false }: { axis: string; style?: AxisStyle; autoTitle: string; logScale?: boolean }) {
  const set = (patch: AxisStyle) => actions.setAxisStyle(axis, patch);
  return (
    <>
      <TextField label="Title" value={style?.title ?? ''} allowEmpty title={`Empty = automatic (${autoTitle}). Supports V_{out}, \\omega`} onCommit={(v) => set({ title: v })} />
      {!logScale && (
        <>
          <div className="field">
            <label>Tick step</label>
            <div className="field-inline">
              <label className="check">
                <input type="checkbox" checked={!style?.tickStep} onChange={(e) => set({ tickStep: e.target.checked ? null : 1 })} />
                Auto
              </label>
            </div>
          </div>
          {style?.tickStep ? (
            <NumberField label="Step" unit={axis === 'x' ? 's' : ''} positive value={style.tickStep} onCommit={(v) => set({ tickStep: v })} />
          ) : null}
          <div className="field">
            <label>Decimals</label>
            <select value={style?.decimals ?? 'auto'} onChange={(e) => set({ decimals: e.target.value === 'auto' ? null : Number(e.target.value) })}>
              <option value="auto">Automatic</option>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </>
  );
}
