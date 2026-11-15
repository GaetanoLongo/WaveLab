/** XY (Lissajous) and eye-diagram views of the project's signals, with SVG/PNG export. */

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { plainText } from '../../core/plot/mathtext';
import { resolveTheme } from '../../core/plot/layout';
import { sceneToSvg } from '../../core/plot/svg';
import { eyeScene, xyScene } from '../../core/plot/views';
import { formatSI } from '../../core/units/si';
import { compiled } from '../../state/compiled';
import { bitTimeOf, findSignal, orderedSignals, useActiveFigure, useEditor } from '../../state/store';
import { scenePng } from '../export/exporters';
import { downloadBlob } from '../fileio';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

type Tab = 'xy' | 'eye';
export const useViewsDialog = create<{ open: Tab | null }>(() => ({ open: null }));
export const openViews = (tab: Tab) => useViewsDialog.setState({ open: tab });
const close = () => useViewsDialog.setState({ open: null });

export function ViewsDialog() {
  const open = useViewsDialog((s) => s.open);
  return open ? <Dialog tab={open} /> : null;
}

const W = 640;
const H = 460;

function Dialog({ tab }: { tab: Tab }) {
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const selectedId = useEditor((s) => s.selectedId);
  const fig = useActiveFigure();
  const theme = useMemo(() => resolveTheme(fig.stylePreset, fig.style), [fig.stylePreset, fig.style]);
  const sigs = orderedSignals(project);
  const [xId, setX] = useState(() => sigs[0]?.id ?? '');
  const [yId, setY] = useState(() => sigs[1]?.id ?? sigs[0]?.id ?? '');
  const [equal, setEqual] = useState(false);
  const [eyeId, setEye] = useState(() => selectedId ?? sigs[0]?.id ?? '');
  const eyeSig = findSignal(project, eyeId);
  const defaultUi = eyeSig ? (bitTimeOf(project, eyeSig) ?? compiled(eyeSig, project).period ?? 1e-3) : 1e-3;
  const [ui, setUi] = useState<number | null>(null);
  const [traces, setTraces] = useState(200);
  const [t0, setT0] = useState(view.xRange[0]);
  const UI = ui ?? defaultUi;

  const result = useMemo(() => {
    if (tab === 'xy') {
      const xs = findSignal(project, xId);
      const ys = findSignal(project, yId);
      if (!xs || !ys) return null;
      return {
        scene: xyScene({
          x: { signal: compiled(xs, project), name: xs.name, unit: xs.unit },
          y: { signal: compiled(ys, project), name: ys.name, unit: ys.unit },
          t0: view.xRange[0],
          t1: view.xRange[1],
          width: W,
          height: H,
          theme,
          color: ys.style.color,
          equal,
        }),
        info: `Curve over the visible time window ${formatSI(view.xRange[0], 's')} → ${formatSI(view.xRange[1], 's')}.`,
      };
    }
    if (!eyeSig) return null;
    const r = eyeScene({ signal: compiled(eyeSig, project), name: eyeSig.name, unit: eyeSig.unit, ui: UI, t0, traces, width: W, height: H, theme, color: eyeSig.style.color });
    return {
      scene: r.scene,
      info: `${traces} traces of 2 UI from ${formatSI(t0, 's')}. Eye height at the centre: ${Number.isFinite(r.height) ? formatSI(r.height, eyeSig.unit, 4) : 'closed / undefined'} (threshold ${formatSI(r.threshold, eyeSig.unit, 4)}).`,
    };
  }, [tab, project, xId, yId, equal, eyeSig, UI, t0, traces, theme, view.xRange]);

  const svg = useMemo(() => (result ? sceneToSvg(result.scene, { idPrefix: 'vw-' }) : ''), [result]);
  const name = tab === 'xy' ? 'xy-plot' : 'eye-diagram';

  return (
    <Modal
      title={tab === 'xy' ? 'XY plot (Lissajous)' : 'Eye diagram'}
      onClose={close}
      className="views-dialog"
      footer={
        <>
          <button disabled={!result} onClick={() => result && downloadBlob(new Blob([sceneToSvg(result.scene, { xmlDeclaration: true, idPrefix: 'wl-' })], { type: 'image/svg+xml' }), `${name}.svg`)}>
            Export SVG
          </button>
          <button disabled={!result} onClick={async () => result && downloadBlob(await scenePng(result.scene, 2), `${name}.png`)}>
            Export PNG
          </button>
          <button className="primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="views-body">
        <div className="views-options">
          <div className="seg" role="group" aria-label="View">
            <button className={tab === 'xy' ? 'on' : ''} onClick={() => openViews('xy')}>
              XY
            </button>
            <button className={tab === 'eye' ? 'on' : ''} onClick={() => openViews('eye')}>
              Eye
            </button>
          </div>
          {tab === 'xy' ? (
            <>
              <SignalSelect label="X axis" value={xId} onChange={setX} sigs={sigs} />
              <SignalSelect label="Y axis" value={yId} onChange={setY} sigs={sigs} />
              <label className="check">
                <input type="checkbox" checked={equal} onChange={(e) => setEqual(e.target.checked)} />
                Equal scales (circles stay round)
              </label>
              <p className="hint-text">Zoom or pan the main plot to choose the time interval.</p>
            </>
          ) : (
            <>
              <SignalSelect label="Signal" value={eyeId} onChange={(v) => (setEye(v), setUi(null))} sigs={sigs} />
              <NumberField label="Unit interval" unit="s" positive value={UI} onCommit={(v) => setUi(v)} title="Bit time; default: the bit time of a bit/PRBS signal, else the period" />
              <NumberField label="Traces" plain min={1} max={2000} value={traces} onCommit={(v) => setTraces(Math.round(v))} />
              <NumberField label="Start" unit="s" value={t0} onCommit={setT0} title="Skip start-up transients" />
              <p className="hint-text">Tip: PRBS → RLC low-pass (or Low-pass) gives a realistic, partly closed eye.</p>
            </>
          )}
          {result && <p className="hint-text">{result.info}</p>}
        </div>
        <div className="views-plot" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
    </Modal>
  );
}

function SignalSelect({ label, value, onChange, sigs }: { label: string; value: string; onChange(v: string): void; sigs: Array<{ id: string; name: string }> }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {sigs.map((s) => (
          <option key={s.id} value={s.id}>
            {plainText(s.name)}
          </option>
        ))}
      </select>
    </div>
  );
}
