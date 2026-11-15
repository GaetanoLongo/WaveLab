/** Toolbar popover: place annotations (text, arrow, Δt, ΔV), dimensions from cursors, edit list. */

import { useEffect, useRef, useState } from 'react';
import { autoYRange } from '../../core/plot/viewport';
import { compiled } from '../../state/compiled';
import { actions, editor, findSignal, useEditor } from '../../state/store';
import { editAnnotation, setAnnotateTool, useAnnotate, type AnnotateTool } from '../annotate';
import { Icon } from '../icons';

const TOOLS: Array<[AnnotateTool, string, string]> = [
  ['text', 'Text label', 'Click in the plot to place a label'],
  ['arrow', 'Arrow', 'Drag from the label end to the point to mark'],
  ['dim-t', 'Δt dimension', 'Drag horizontally between two instants (snaps to edges)'],
  ['dim-y', 'ΔV dimension', 'Drag vertically between two levels (snaps to signal levels)'],
];

export function AnnotateMenu() {
  const tool = useAnnotate((s) => s.tool);
  const cursors = useEditor((s) => s.view.cursors);
  const count = useEditor((s) => (s.project.figures.find((f) => f.id === s.activeFigureId) ?? s.project.figures[0])?.annotations?.length ?? 0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      if (useAnnotate.getState().tool) setAnnotateTool(null);
    };
    window.addEventListener('keydown', onKey);
    if (!open) return () => window.removeEventListener('keydown', onKey);
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Δt marker height: 85 % up the measured signal's range. */
  const fromCursors = (kind: 'dim-t' | 'dim-y') => {
    const st = editor.getState();
    const sig = findSignal(st.project, st.view.cursors.target ?? st.selectedId);
    const r = sig ? autoYRange([compiled(sig, st.project)]) : ([-1, 1] as const);
    const id = actions.dimensionFromCursors(kind, r[0] + 0.85 * (r[1] - r[0]));
    if (id) useAnnotate.setState({ selected: id });
    setOpen(false);
  };
  const hasT = cursors.t[0] != null && cursors.t[1] != null;
  const hasY = cursors.y[0] != null && cursors.y[1] != null;

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`icon tb${tool ? ' active' : ''}`}
        title={tool ? 'Placing an annotation (Esc to cancel)' : 'Annotations: labels, arrows, dimensions'}
        aria-label="Annotations"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="annotate" />
      </button>
      {open && (
        <div className="popover menu annotate-menu" role="menu">
          {TOOLS.map(([k, label, title]) => (
            <button
              key={k}
              role="menuitemradio"
              aria-checked={tool === k}
              className={tool === k ? 'on' : ''}
              title={title}
              onClick={() => {
                setAnnotateTool(tool === k ? null : k);
                setOpen(false);
              }}
            >
              {label}
            </button>
          ))}
          <hr />
          <button disabled={!hasT} title={hasT ? '' : 'Place time cursors 1 and 2 first'} onClick={() => fromCursors('dim-t')}>
            Δt from time cursors
          </button>
          <button disabled={!hasY} title={hasY ? '' : 'Place level cursors A and B first'} onClick={() => fromCursors('dim-y')}>
            ΔV from level cursors
          </button>
          <hr />
          <button
            disabled={count === 0}
            onClick={() => {
              editAnnotation(useAnnotate.getState().selected ?? '');
              setOpen(false);
            }}
          >
            Edit annotations… {count > 0 ? `(${count})` : ''}
          </button>
        </div>
      )}
    </div>
  );
}
