import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { panelsForGroups, resolveTheme, type TraceInput } from '../core/plot/layout';
import { isPeriodicKind } from '../core/model/signal-defs';
import { ExportDialog } from './export/ExportDialog';
import { AxesDialog } from './panels/AxesDialog';
import { FigureSettingsDialog } from './panels/FigureSettings';
import { SpectrumDialog } from './panels/SpectrumDialog';
import { PwmDialog } from './panels/PwmDialog';
import { RectifierDialog } from './panels/RectifierDialog';
import { ModulationDialog } from './panels/ModulationDialog';
import { openAxes } from './Modal';
import { loadFile } from './fileio';
import { formatSI } from '../core/units/si';
import { compiled } from '../state/compiled';
import { useSettings } from '../state/settings';
import { actions, editor, figureGroups, findSignal, isDirty, orderedSignals, useActiveFigure, useEditor, viewOf } from '../state/store';
import { gridColumns } from '../core/model/project';
import { FigureTabs } from './panels/FigureTabs';
import { PropertiesPanel } from './panels/PropertiesPanel';
import { MeasurePanel } from './panels/MeasurePanel';
import { SignalList } from './panels/SignalList';
import { Toolbox } from './panels/Toolbox';
import { PlotView, type CursorInfo } from './plot/PlotView';
import { Toolbar } from './Toolbar';
import { useShortcuts } from './useShortcuts';
import { discardRecovery, restoreRecovery, startRecovery, useRecovery } from '../state/recovery';
import { PHONE_QUERY, useMediaQuery } from './useMediaQuery';

type PhoneTab = 'add' | 'signals' | 'props' | 'measure';
/** Which panel the phone layout shows under the plot. */
export const usePhoneTab = create<{ tab: PhoneTab }>(() => ({ tab: 'add' }));

export function App() {
  useShortcuts();
  useEffect(startRecovery, []);
  const phone = useMediaQuery(PHONE_QUERY);
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
      <FigureSettingsDialog />
      <SpectrumDialog />
      <PwmDialog />
      <RectifierDialog />
      <ModulationDialog />
      <AxesDialog />
      <RecoveryBanner />
      <Toolbar compact={phone} />
      {phone ? (
        <PhoneWorkspace />
      ) : (
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
      )}
    </div>
  );
}

/** Offer to restore unsaved work found from a previous session. */
function RecoveryBanner() {
  const found = useRecovery((s) => s.found);
  if (!found) return null;
  const when = new Date(found.savedAt).toLocaleString();
  return (
    <div className="recovery-banner" role="alert">
      <span>
        Unsaved work from {when} (“{found.name}”) was found in this browser.
      </span>
      <button className="primary" onClick={restoreRecovery}>
        Restore
      </button>
      <button onClick={discardRecovery}>Discard</button>
    </div>
  );
}

const TABS: Array<[PhoneTab, string]> = [
  ['add', 'Add'],
  ['signals', 'Signals'],
  ['props', 'Properties'],
  ['measure', 'Measure'],
];

/**
 * Phone layout: the plot on top, one panel below chosen with a tab bar.
 * Creating or selecting a signal jumps to its properties.
 */
function PhoneWorkspace() {
  const tab = usePhoneTab((s) => s.tab);
  const selectedId = useEditor((s) => s.selectedId);
  const count = useEditor((s) => s.project.signals.length);
  // Starts at null so a signal already selected when the phone layout appears shows its properties.
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== prevSel.current) usePhoneTab.setState({ tab: 'props' });
    prevSel.current = selectedId;
  }, [selectedId]);

  return (
    <div className="phone-workspace">
      <PlotArea />
      <nav className="phone-tabs" role="tablist" aria-label="Panels">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'on' : ''}
            onClick={() => usePhoneTab.setState({ tab: id })}
          >
            {label}
            {id === 'signals' && count > 0 && <span className="count">{count}</span>}
          </button>
        ))}
      </nav>
      <div className="phone-panel" role="tabpanel">
        {tab === 'add' && <Toolbox />}
        {tab === 'signals' && <SignalList />}
        {tab === 'props' && <PropertiesPanel />}
        {tab === 'measure' && <MeasurePanel phone />}
      </div>
    </div>
  );
}

function PlotArea() {
  const phoneLayout = useMediaQuery(PHONE_QUERY);
  const view = useEditor((s) => s.view);
  const notice = useEditor((s) => s.notice);
  const gridView = useEditor((s) => s.gridView && s.project.figures.length > 1);
  const figures = useEditor((s) => s.project.figures);
  const activeId = useActiveFigure().id;
  const grid = useEditor((s) => s.project.grid);
  const [cursor, setCursor] = useState<CursorInfo | null>(null);
  const cols = gridColumns(figures.length, grid);

  return (
    <main className="plot-column">
      <FigureTabs />
      {gridView ? (
        <div className="figure-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {figures.map((f) => (
            <div key={f.id} className={`grid-cell${f.id === activeId ? ' active' : ''}`}>
              <button className="cell-head" onClick={() => actions.switchFigure(f.id)} title="Make this the active figure">
                {f.name}
              </button>
              <FigurePlot figId={f.id} active={f.id === activeId} onCursor={setCursor} phoneLayout={phoneLayout} />
            </div>
          ))}
        </div>
      ) : (
        <div className="plot-area">
          <FigurePlot figId={activeId} active onCursor={setCursor} phoneLayout={phoneLayout} />
        </div>
      )}
      {!phoneLayout && <MeasurePanel />}
      <footer className="status">
        <button className="range-btn" title="Set the visible time interval (Axes)" onClick={() => openAxes('x')}>
          {formatSI(view.xRange[0], 's')} → {formatSI(view.xRange[1], 's')} (span {formatSI(view.xRange[1] - view.xRange[0], 's')})
        </button>
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

const noop = () => {};

/**
 * One figure's plot. The active figure is interactive; in grid view the others are drawn
 * read-only and become active on the first pointer press.
 */
function FigurePlot({ figId, active, onCursor, phoneLayout }: { figId: string; active: boolean; onCursor(c: CursorInfo | null): void; phoneLayout: boolean }) {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  // Select only stored objects (a freshly built default view would re-render forever).
  const stored = useEditor((s) => (s.activeFigureId === figId ? s.view : s.views[figId]));
  const fallback = useMemo(() => viewOf({ ...editor.getState(), project }, figId), [project, figId]);
  const view = stored ?? fallback;
  const fig = project.figures.find((f) => f.id === figId) ?? project.figures[0]!;
  const snap = useSettings((s) => s.snap);
  const visibleIds = orderedSignals(project, fig.id).filter((s) => s.style.visible).map((s) => s.id);
  const yTraceId =
    (view.cursors.target && visibleIds.includes(view.cursors.target) ? view.cursors.target : null) ??
    (active && selectedId && visibleIds.includes(selectedId) ? selectedId : null) ??
    visibleIds[0] ??
    null;
  const theme = useMemo(() => resolveTheme(fig.stylePreset, fig.style), [fig.stylePreset, fig.style]);
  const cursorSpec = useMemo(() => ({ t: view.cursors.t, y: view.cursors.y, yTraceId }), [view.cursors.t, view.cursors.y, yTraceId]);

  const groups = useMemo(() => {
    const toTrace = (s: (typeof project.signals)[number]): TraceInput => ({
      id: s.id,
      name: s.name,
      signal: compiled(s, project),
      color: s.style.color,
      lineWidth: s.style.lineWidth,
      dash: s.style.dash,
      unit: s.unit,
      showInLegend: s.style.showInLegend,
      highlight: active && s.id === selectedId,
    });
    return figureGroups(project, fig.id).map(({ group, signals }) => ({
      id: group.id,
      name: group.name,
      share: group.share,
      traces: signals.filter((s) => s.style.visible).map(toTrace),
    }));
  }, [project, fig.id, selectedId, active]);
  const traces = useMemo(() => groups.flatMap((g) => g.traces), [groups]);
  // Stacked panels keep a readable minimum height; beyond that the plot area scrolls
  // (on touch screens a vertical swipe scrolls, a horizontal one still pans time).
  const nPanels = fig.mode === 'stacked' ? panelsForGroups('stacked', groups, {}).length : 1;
  const minHeight = nPanels > 1 ? nPanels * 40 + 70 : undefined;

  return (
    <div className="figure-plot" style={minHeight ? { minHeight } : undefined} onPointerDownCapture={() => !active && actions.switchFigure(figId)}>
      <PlotView
        traces={traces}
        mode={fig.mode}
        xRange={view.xRange}
        onXRangeChange={active ? actions.setXRange : noop}
        yRanges={view.yRanges}
        onYRangeChange={active ? actions.setYRange : noop}
        onFit={active ? actions.fitAll : noop}
        theme={theme}
        axes={fig.axes}
        showLegend={fig.showLegend}
        groups={groups}
        onCursor={active ? onCursor : undefined}
        onSelect={active ? actions.select : undefined}
        snap={snap}
        canMove={(id) => {
          if (!active) return false;
          const s = findSignal(editor.getState().project, id);
          return !!s && !s.locked && s.kind === 'generator';
        }}
        getTiming={(id) => {
          const s = findSignal(editor.getState().project, id);
          if (!s || s.kind !== 'generator') return null;
          return { ...s.timing, periodic: isPeriodicKind(s.generator) };
        }}
        onMove={active ? (id, delay, key) => actions.setDelay(id, delay, key) : undefined}
        cursors={cursorSpec}
        onCursorMove={active ? actions.setCursor : undefined}
        onAxisDoubleClick={active ? openAxes : undefined}
        emptyMessage={
          project.signals.length > 0 && visibleIds.length === 0 && orderedSignals(project, fig.id).length === 0
            ? 'This figure is empty: add a waveform, or add existing signals from the signal list.'
            : project.signals.length === 0
              ? phoneLayout
                ? 'Add a waveform from the “Add” tab below.'
                : 'Add a waveform from the toolbox on the left.'
              : 'All signals are hidden.'
        }
      />
    </div>
  );
}
