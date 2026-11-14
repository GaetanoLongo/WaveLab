import { useEffect, useRef, useState } from 'react';
import { zoomRange } from '../core/plot/viewport';
import { actions, canRedo, canUndo, editor, isDirty, useActiveFigure, useEditor } from '../state/store';
import { Icon, type IconName } from './icons';
import { SnapMenu } from './panels/SnapMenu';
import { openSpectrum } from './panels/SpectrumDialog';
import { openExportDialog } from './export/ExportDialog';
import { openAxes, openSettings } from './Modal';
import { forgetFileHandle, openProject, saveProject } from './fileio';
import { MathLabel } from './MathLabel';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

function Btn(p: { icon: IconName; label: string; onClick?: () => void; disabled?: boolean; pending?: string }) {
  const title = p.pending ? `${p.label} — not available yet (milestone ${p.pending})` : p.label;
  return (
    <button className="icon tb" title={title} aria-label={title} onClick={p.onClick} disabled={p.disabled || !!p.pending}>
      <Icon name={p.icon} />
    </button>
  );
}

export function confirmDiscard(): boolean {
  return !isDirty(editor.getState()) || window.confirm('Discard unsaved changes?');
}

const newProject = () => {
  if (!confirmDiscard()) return;
  forgetFileHandle();
  actions.newProject();
};
const zoomBy = (k: number) => actions.setXRange(zoomRange(editor.getState().view.xRange, k));

function ProjectName({ compact }: { compact: boolean }) {
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor(isDirty);
  const [editingName, setEditingName] = useState(false);
  return (
    <div className="project-name">
        {editingName ? (
          <input
            autoFocus
            defaultValue={name}
            aria-label="Project name"
            onBlur={(e) => {
              actions.renameProject(e.target.value);
              setEditingName(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setEditingName(false);
            }}
          />
        ) : (
          <button className="name-btn" title="Rename project" onClick={() => setEditingName(true)}>
            <MathLabel text={name} />
          </button>
        )}
        {dirty && (
          <span className="dirty" title="Unsaved changes" aria-label="Unsaved changes">
            {compact ? '●' : '● unsaved'}
          </span>
        )}
    </div>
  );
}

/** Phone toolbar: essentials visible, everything else in a "⋯" menu. */
function CompactToolbar() {
  const undo = useEditor(canUndo);
  const redo = useEditor(canRedo);
  const hasSel = useEditor((s) => s.selectedId !== null);
  const hasClip = useEditor((s) => s.clipboard !== null);
  const mode = useActiveFigure().mode;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);
  const item = (icon: IconName, label: string, run: () => void, disabled = false) => (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <Icon name={icon} /> {label}
    </button>
  );
  return (
    <header className="toolbar compact">
      <ProjectName compact />
      <div className="sep" />
      <Btn icon="undo" label="Undo" onClick={actions.undo} disabled={!undo} />
      <Btn icon="redo" label="Redo" onClick={actions.redo} disabled={!redo} />
      <Btn icon="fit" label="Fit all signals" onClick={actions.fitAll} />
      <Btn
        icon={mode === 'overlay' ? 'stacked' : 'overlay'}
        label={mode === 'overlay' ? 'Switch to stacked plots' : 'Switch to overlay'}
        onClick={() => actions.setMode(mode === 'overlay' ? 'stacked' : 'overlay')}
      />
      <SnapMenu />
      <Btn icon="export" label="Export PNG / SVG / PDF" onClick={openExportDialog} />
      <div className="popover-anchor" ref={ref}>
        <button className="icon tb more" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          ⋯
        </button>
        {open && (
          <div className="popover menu" role="menu">
            {item('newFile', 'New project', newProject)}
            {item('open', 'Open project…', () => void openProject())}
            {item('save', 'Save', () => void saveProject(false))}
            {item('saveAs', 'Save as…', () => void saveProject(true))}
            <hr />
            {item('duplicate', 'Duplicate', () => actions.duplicate(), !hasSel)}
            {item('copy', 'Copy', () => actions.copy(), !hasSel)}
            {item('paste', 'Paste', actions.paste, !hasClip)}
            {item('trash', 'Delete', () => actions.deleteSignal(), !hasSel)}
            <hr />
            {item('zoomIn', 'Zoom in', () => zoomBy(0.5))}
            {item('zoomOut', 'Zoom out', () => zoomBy(2))}
            {item('fit', 'Auto vertical scale', actions.resetYRanges)}
            <hr />
            {item('axes', 'Axes…', () => openAxes('all'))}
            {item('spectrum', 'Spectrum…', openSpectrum)}
            {item('settings', 'Figure settings…', openSettings)}
          </div>
        )}
      </div>
    </header>
  );
}

export function Toolbar({ compact = false }: { compact?: boolean }) {
  const undo = useEditor(canUndo);
  const redo = useEditor(canRedo);
  const hasSel = useEditor((s) => s.selectedId !== null);
  const hasClip = useEditor((s) => s.clipboard !== null);
  const mode = useActiveFigure().mode;
  if (compact) return <CompactToolbar />;

  return (
    <header className="toolbar">
      <strong className="brand">WaveLab</strong>
      <ProjectName compact={false} />

      <div className="tb-group">
        <Btn icon="newFile" label="New project" onClick={newProject} />
        <Btn icon="open" label={`Open project (${MOD}O)`} onClick={() => void openProject()} />
        <Btn icon="save" label={`Save (${MOD}S)`} onClick={() => void saveProject(false)} />
        <Btn icon="saveAs" label="Save as…" onClick={() => void saveProject(true)} />
      </div>
      <div className="tb-group">
        <Btn icon="undo" label={`Undo (${MOD}Z)`} onClick={actions.undo} disabled={!undo} />
        <Btn icon="redo" label={`Redo (${MOD}Y)`} onClick={actions.redo} disabled={!redo} />
      </div>
      <div className="tb-group">
        <Btn icon="duplicate" label={`Duplicate (${MOD}D)`} onClick={() => actions.duplicate()} disabled={!hasSel} />
        <Btn icon="copy" label={`Copy (${MOD}C)`} onClick={() => actions.copy()} disabled={!hasSel} />
        <Btn icon="paste" label={`Paste (${MOD}V)`} onClick={actions.paste} disabled={!hasClip} />
        <Btn icon="trash" label="Delete (Del)" onClick={() => actions.deleteSignal()} disabled={!hasSel} />
      </div>
      <div className="tb-group">
        <Btn icon="zoomIn" label="Zoom in" onClick={() => zoomBy(0.5)} />
        <Btn icon="zoomOut" label="Zoom out" onClick={() => zoomBy(2)} />
        <Btn icon="fit" label="Fit all signals (double-click plot)" onClick={actions.fitAll} />
        <button className="tb text" title="Return all vertical axes to automatic scaling" onClick={actions.resetYRanges}>
          Auto Y
        </button>
        <Btn icon="axes" label="Axes: time range, titles, ticks, log scale" onClick={() => openAxes('all')} />
        <Btn icon="spectrum" label="Spectrum: harmonics and THD" onClick={openSpectrum} />
      </div>
      <div className="seg" role="group" aria-label="Plot mode">
        <button className={mode === 'overlay' ? 'on' : ''} onClick={() => actions.setMode('overlay')} title="All signals on one plot">
          <Icon name="overlay" size={14} /> Overlay
        </button>
        <button className={mode === 'stacked' ? 'on' : ''} onClick={() => actions.setMode('stacked')} title="One plot per signal, shared time axis">
          <Icon name="stacked" size={14} /> Stacked
        </button>
      </div>
      <div className="sep" />
      <div className="tb-group">
        <SnapMenu />
        <Btn icon="export" label={`Export PNG / SVG / PDF (${MOD}Shift+S)`} onClick={openExportDialog} />
        <Btn icon="settings" label="Figure settings (style, fonts, legend)" onClick={openSettings} />
      </div>
    </header>
  );
}
