/** Export dialog: format, size, style, PNG/PDF options and a live preview. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { THEMES } from '../../core/plot/layout';
import { sceneToSvg } from '../../core/plot/svg';
import { actions, useActiveFigure, useEditor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { safeFileName } from '../fileio';
import { buildExportScene, DEFAULT_EXPORT, pageSizePt, runExport, type ExportFormat, type ExportOptions, type PageSize } from './exporters';

export const useExportDialog = create<{ open: boolean }>(() => ({ open: false }));
export const openExportDialog = () => useExportDialog.setState({ open: true });
const close = () => useExportDialog.setState({ open: false });

const KEY = 'wavelab.export.v1';

function loadOptions(): Omit<ExportOptions, 'fileName'> {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_EXPORT, ...(JSON.parse(raw) as Partial<ExportOptions>) };
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_EXPORT };
}

const SIZE_PRESETS: Array<[string, number, number]> = [
  ['800 × 500', 800, 500],
  ['1000 × 600', 1000, 600],
  ['1200 × 800', 1200, 800],
  ['16:9 · 1600 × 900', 1600, 900],
  ['Square · 800 × 800', 800, 800],
];

export function ExportDialog() {
  const open = useExportDialog((s) => s.open);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const projectName = useEditor((s) => s.project.name);
  const fig = useActiveFigure();
  const project = useEditor((s) => s.project);
  const view = useEditor((s) => s.view);
  const [o, setO] = useState<Omit<ExportOptions, 'fileName'>>(loadOptions);
  const [fileName, setFileName] = useState(() => safeFileName(projectName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<ExportOptions>) => setO((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch {
      /* ignore */
    }
  }, [o]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('.fmt button.on')?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Preview uses exactly the export scene.
  const preview = useMemo(() => {
    const svg = sceneToSvg(buildExportScene(o.width, o.height, o.transparent, o.includeCursors, o.content), { idPrefix: 'wlprev-' });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    // project/view are dependencies because buildExportScene reads them from the store.
  }, [o.width, o.height, o.transparent, o.includeCursors, o.content, project, view]);

  const doExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await runExport({ ...o, fileName: safeFileName(fileName) });
      close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const [pw, ph] = pageSizePt({ ...o, fileName });
  const ptToMm = (pt: number) => ((pt * 25.4) / 72).toFixed(1);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal export-dialog" role="dialog" aria-modal="true" aria-label="Export" ref={ref}>
        <header>
          <h2>Export figure</h2>
          <button className="icon" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        <div className="export-body">
          <div className={`preview${o.transparent ? ' checker' : ''}`}>
            <img src={preview} alt="Export preview" />
            <span className="preview-size">
              {o.format === 'png'
                ? `${Math.round(o.width * o.scale)} × ${Math.round(o.height * o.scale)} px`
                : o.format === 'pdf'
                  ? `page ${ptToMm(pw)} × ${ptToMm(ph)} mm`
                  : `${o.width} × ${o.height} (vector)`}
            </span>
          </div>
          <div className="options">
            <div className="seg fmt" role="group" aria-label="Format">
              {(['png', 'svg', 'pdf'] as ExportFormat[]).map((f) => (
                <button key={f} className={o.format === f ? 'on' : ''} onClick={() => set({ format: f })}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="hint-text">
              {o.format === 'png' && 'Raster image for slides and documents. Fonts are embedded.'}
              {o.format === 'svg' && 'True vector with editable text and paths. Text uses the Inter font if installed, otherwise a system sans-serif.'}
              {o.format === 'pdf' && 'Vector PDF with the Inter font embedded (Greek letters and symbols included).'}
            </p>

            <h3>Figure</h3>
            {project.figures.length > 1 && (
              <div className="field">
                <label>Content</label>
                <select value={o.content} onChange={(e) => set({ content: e.target.value as 'figure' | 'grid' })}>
                  <option value="figure">Current figure</option>
                  <option value="grid">All figures (grid)</option>
                </select>
              </div>
            )}
            <div className="field">
              <label>Style</label>
              <select value={fig.stylePreset} onChange={(e) => actions.setStylePreset(e.target.value)}>
                {Object.values(THEMES).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
                <option disabled>Dark technical (M9)</option>
                <option disabled>Presentation (M9)</option>
              </select>
            </div>
            <label className="check">
              <input type="checkbox" checked={fig.showLegend} onChange={(e) => actions.setShowLegend(e.target.checked)} />
              Show legend (overlay mode)
            </label>
            <label className="check">
              <input type="checkbox" checked={o.includeCursors} onChange={(e) => set({ includeCursors: e.target.checked })} />
              Include measurement cursors
            </label>
            <div className="field">
              <label>Size preset</label>
              <select
                value=""
                onChange={(e) => {
                  const p = SIZE_PRESETS[Number(e.target.value)];
                  if (p) set({ width: p[1], height: p[2] });
                }}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {SIZE_PRESETS.map(([l], i) => (
                  <option key={l} value={i}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <NumberField label="Width" unit="px" plain min={200} max={8000} value={o.width} onCommit={(v) => set({ width: Math.round(v) })} />
            <NumberField label="Height" unit="px" plain min={150} max={8000} value={o.height} onCommit={(v) => set({ height: Math.round(v) })} />

            {o.format === 'png' && (
              <>
                <h3>PNG</h3>
                <div className="field">
                  <label>Resolution</label>
                  <div className="seg small">
                    {[1, 2, 4].map((k) => (
                      <button key={k} className={o.scale === k ? 'on' : ''} onClick={() => set({ scale: k })}>
                        {k}×
                      </button>
                    ))}
                  </div>
                </div>
                <label className="check">
                  <input type="checkbox" checked={o.transparent} onChange={(e) => set({ transparent: e.target.checked })} />
                  Transparent background
                </label>
              </>
            )}

            {o.format === 'pdf' && (
              <>
                <h3>PDF page</h3>
                <div className="field">
                  <label>Page size</label>
                  <select value={o.page} onChange={(e) => set({ page: e.target.value as PageSize })}>
                    <option value="plot">Same as figure</option>
                    <option value="A4">A4</option>
                    <option value="A3">A3</option>
                    <option value="Letter">Letter</option>
                    <option value="custom">Custom…</option>
                  </select>
                </div>
                {(o.page === 'A4' || o.page === 'A3' || o.page === 'Letter') && (
                  <div className="field">
                    <label>Orientation</label>
                    <select value={o.orientation} onChange={(e) => set({ orientation: e.target.value as 'portrait' | 'landscape' })}>
                      <option value="landscape">Landscape</option>
                      <option value="portrait">Portrait</option>
                    </select>
                  </div>
                )}
                {o.page === 'custom' && (
                  <>
                    <NumberField label="Page width" unit="mm" plain min={20} max={2000} value={o.pageW} onCommit={(v) => set({ pageW: v })} />
                    <NumberField label="Page height" unit="mm" plain min={20} max={2000} value={o.pageH} onCommit={(v) => set({ pageH: v })} />
                  </>
                )}
                {o.page !== 'plot' && (
                  <label className="check">
                    <input type="checkbox" checked={o.fit} onChange={(e) => set({ fit: e.target.checked })} />
                    Fit plot to page (10 mm margins)
                  </label>
                )}
              </>
            )}

            <h3>File</h3>
            <div className="field">
              <label>File name</label>
              <input value={fileName} onChange={(e) => setFileName(e.target.value)} spellCheck={false} />
            </div>
            {error && <p className="warn">Export failed: {error}</p>}
          </div>
        </div>
        <footer>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={doExport} disabled={busy || !fileName.trim()}>
            {busy ? 'Exporting…' : `Export ${o.format.toUpperCase()}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
