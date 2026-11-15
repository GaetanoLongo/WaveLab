/** Edit the annotations of the active figure: text, signal (panel), colour, positions. */

import { dimensionLabel } from '../../core/plot/annotations';
import { plainText } from '../../core/plot/mathtext';
import type { Annotation } from '../../core/model/project';
import { actions, findSignal, orderedSignals, useActiveFigure, useEditor } from '../../state/store';
import { editAnnotation, selectAnnotation, useAnnotate } from '../annotate';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

const KIND_LABEL: Record<Annotation['kind'], string> = { text: 'Text', arrow: 'Arrow', 'dim-t': 'Δt dimension', 'dim-y': 'ΔV dimension' };

export function AnnotationsDialog() {
  const editing = useAnnotate((s) => s.editing);
  return editing !== null ? <Dialog focus={editing} /> : null;
}

function Dialog({ focus }: { focus: string }) {
  const fig = useActiveFigure();
  const project = useEditor((s) => s.project);
  const list = fig.annotations ?? [];
  const sigs = orderedSignals(project, fig.id);
  const close = () => editAnnotation(null);
  return (
    <Modal title="Annotations" onClose={close} className="annotations-dialog" footer={<button className="primary" onClick={close}>Done</button>}>
      {list.length === 0 && <p className="hint-text">No annotations in this figure. Use the Annotations menu in the toolbar to add some.</p>}
      <div className="ann-list">
        {list.map((a) => {
          const unit = (a.on && findSignal(project, a.on)?.unit) || '';
          const upd = (patch: Partial<Annotation>, key?: string) => actions.updateAnnotation(a.id, patch, key);
          return (
            <section key={a.id} className={`ann-item${a.id === focus ? ' focused' : ''}`} onMouseDown={() => selectAnnotation(a.id)}>
              <header>
                <strong>{KIND_LABEL[a.kind]}</strong>
                <span className="muted">{a.kind.startsWith('dim') ? dimensionLabel(a, unit) : plainText(a.text)}</span>
                <button className="link-btn danger" onClick={() => actions.deleteAnnotation(a.id)}>
                  Delete
                </button>
              </header>
              <div className="field">
                <label>{a.kind.startsWith('dim') ? 'Label' : 'Text'}</label>
                <input
                  defaultValue={a.text}
                  placeholder={a.kind.startsWith('dim') ? 'automatic (Δt = …)' : ''}
                  title="Supports math markup: v_{out}, \omega, ^\circ"
                  onBlur={(e) => e.target.value !== a.text && upd({ text: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
              <div className="field">
                <label>Panel of</label>
                <select value={a.on ?? ''} onChange={(e) => upd({ on: e.target.value || null })} title="The annotation uses this signal's panel and vertical units">
                  <option value="">(first panel)</option>
                  {sigs.map((s) => (
                    <option key={s.id} value={s.id}>
                      {plainText(s.name)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Colour</label>
                <input type="color" value={a.color} onChange={(e) => upd({ color: e.target.value }, `ann-color-${a.id}`)} />
              </div>
              <div className="field-pair">
                <NumberField label={a.kind === 'dim-t' ? 'From t' : 't'} unit="s" value={a.t0} onCommit={(v) => upd(a.kind === 'dim-y' || a.kind === 'text' ? { t0: v, t1: v } : { t0: v })} />
                {a.kind !== 'dim-t' && <NumberField label={a.kind === 'dim-y' ? 'From y' : 'y'} unit={unit} value={a.y0} onCommit={(v) => upd(a.kind === 'text' ? { y0: v, y1: v } : { y0: v })} />}
                {a.kind === 'dim-t' && <NumberField label="At y" unit={unit} value={a.y0} onCommit={(v) => upd({ y0: v, y1: v })} />}
              </div>
              {(a.kind === 'arrow' || a.kind === 'dim-t') && (
                <div className="field-pair">
                  <NumberField label={a.kind === 'arrow' ? 'Head t' : 'To t'} unit="s" value={a.t1} onCommit={(v) => upd({ t1: v })} />
                  {a.kind === 'arrow' && <NumberField label="Head y" unit={unit} value={a.y1} onCommit={(v) => upd({ y1: v })} />}
                </div>
              )}
              {a.kind === 'dim-y' && <NumberField label="To y" unit={unit} value={a.y1} onCommit={(v) => upd({ y1: v })} />}
            </section>
          );
        })}
      </div>
    </Modal>
  );
}
