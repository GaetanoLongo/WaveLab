import { useState } from 'react';
import { zoomRange } from '../core/plot/viewport';
import { actions, canRedo, canUndo, editor, isDirty, useEditor } from '../state/store';
import { Icon, type IconName } from './icons';
import { SnapMenu } from './panels/SnapMenu';
import { openExportDialog } from './export/ExportDialog';
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

export function Toolbar() {
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor(isDirty);
  const undo = useEditor(canUndo);
  const redo = useEditor(canRedo);
  const hasSel = useEditor((s) => s.selectedId !== null);
  const hasClip = useEditor((s) => s.clipboard !== null);
  const mode = useEditor((s) => s.project.figures[0]!.mode);
  const [editingName, setEditingName] = useState(false);

  return (
    <header className="toolbar">
      <strong className="brand">WaveLab</strong>
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
          <span className="dirty" title="Unsaved changes">
            ● unsaved
          </span>
        )}
      </div>

      <div className="tb-group">
        <Btn
          icon="newFile"
          label="New project"
          onClick={() => {
            if (!confirmDiscard()) return;
            forgetFileHandle();
            actions.newProject();
          }}
        />
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
        <Btn icon="zoomIn" label="Zoom in" onClick={() => actions.setXRange(zoomRange(editor.getState().view.xRange, 0.5))} />
        <Btn icon="zoomOut" label="Zoom out" onClick={() => actions.setXRange(zoomRange(editor.getState().view.xRange, 2))} />
        <Btn icon="fit" label="Fit all signals (double-click plot)" onClick={actions.fitAll} />
        <button className="tb text" title="Return all vertical axes to automatic scaling" onClick={actions.resetYRanges}>
          Auto Y
        </button>
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
        <Btn icon="settings" label="Settings" pending="M9" />
      </div>
    </header>
  );
}
