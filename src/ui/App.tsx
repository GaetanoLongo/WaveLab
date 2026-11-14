import { useMemo, useState } from 'react';
import { themeById, type TraceInput } from '../core/plot/layout';
import { ExportDialog } from './export/ExportDialog';
import { loadFile } from './fileio';
import { formatSI } from '../core/units/si';
import { compiled } from '../state/compiled';
import { useSettings } from '../state/settings';
import { actions, editor, findSignal, isDirty, orderedSignals, useEditor } from '../state/store';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { SignalList } from './panels/SignalList';
import { Toolbox } from './panels/Toolbox';
import { PlotView, type CursorInfo } from './plot/PlotView';
import { Toolbar } from './Toolbar';
import { useShortcuts } from './useShortcuts';

export function App() {
  useShortcuts();
  const [dropping, setDropping] = useState(false);
  const hasFile = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
  return (
    <div
      className={`app${dropping ? ' dropping' : ''}`}
      onDragOver={(e) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFile(e)) return;
        e.preventDefault();
        setDropping(false);
        const f = e.dataTransfer.files[0];
        if (!f) return;
        if (!/\.(wlab|json)$/i.test(f.name)) {
          editor.setState({ notice: `“${f.name}” is not a WaveLab project (.wlab).` });
          return;
        }
        if (isDirty(editor.getState()) && !window.confirm('Discard unsaved changes?')) return;
        void loadFile(f, null);
      }}
    >
      <ExportDialog />
      <Toolbar />
      <div className="workspace">
        <aside className="toolbox" aria-label="Toolbox">
          <Toolbox />
        </aside>
        <PlotArea />
        <aside className="inspector">
          <SignalList />
          <PropertiesPanel />
        </aside>
      </div>
    </div>
  );
}

function PlotArea() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const view = useEditor((s) => s.view);
  const notice = useEditor((s) => s.notice);
  const mode = project.figures[0]!.mode;
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const snap = useSettings((s) => s.snap);

  const traces = useMemo<TraceInput[]>(
    () =>
      orderedSignals(project)
        .filter((s) => s.style.visible)
        .map((s) => ({
          id: s.id,
          name: s.name,
          signal: compiled(s),
          color: s.style.color,
          lineWidth: s.style.lineWidth,
          dash: s.style.dash,
          unit: s.unit,
          showInLegend: s.style.showInLegend,
          highlight: s.id === selectedId,
        })),
    [project, selectedId],
  );

  return (
    <main className="plot-column">
      <div className="plot-area">
        <PlotView
          traces={traces}
          mode={mode}
          xRange={view.xRange}
          onXRangeChange={actions.setXRange}
          yRanges={view.yRanges}
          onYRangeChange={actions.setYRange}
          onFit={actions.fitAll}
          theme={themeById(project.figures[0]!.stylePreset)}
          showLegend={project.figures[0]!.showLegend}
          onCursor={setCursor}
          onSelect={actions.select}
          snap={snap}
          canMove={(id) => {
            const s = findSignal(editor.getState().project, id);
            return !!s && !s.locked;
          }}
          getTiming={(id) => {
            const s = findSignal(editor.getState().project, id);
            if (!s) return null;
            return { ...s.timing, periodic: s.generator !== 'dc' };
          }}
          onMove={(id, delay, key) => actions.setDelay(id, delay, key)}
          emptyMessage={
            project.signals.length === 0
              ? 'Add a waveform from the toolbox on the left.'
              : 'All signals are hidden.'
          }
        />
      </div>
      <footer className="status">
        <span>
          {formatSI(view.xRange[0], 's')} → {formatSI(view.xRange[1], 's')} (span {formatSI(view.xRange[1] - view.xRange[0], 's')})
        </span>
        <span className="cursor-readout">
          {cursor ? `t = ${formatSI(cursor.t, 's', 6)}   y = ${formatSI(cursor.y, cursor.unit, 4)}` : ''}
        </span>
        {notice ? (
          <span className="notice" role="status">
            {notice}
          </span>
        ) : (
          <span className="hint">Drag trace: move (Alt: no snap) · Drag empty: pan · Wheel: zoom · Shift+wheel/drag: vertical / box zoom · Double-click: fit</span>
        )}
      </footer>
    </main>
  );
}
