/** Signal list: selection, visibility, lock, colour, rename, duplicate, delete, drag-to-reorder. */

import { useState } from 'react';
import type { SignalDef } from '../../core/model/project';
import { actions, orderedSignals, useEditor } from '../../state/store';
import { Icon } from '../icons';
import { MathLabel } from '../MathLabel';

export function SignalList() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const signals = orderedSignals(project);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const onDrop = () => {
    if (dragId !== null && dropIdx !== null) {
      const from = signals.findIndex((s) => s.id === dragId);
      const to = dropIdx > from ? dropIdx - 1 : dropIdx;
      if (to !== from) actions.reorder(dragId, to);
    }
    setDragId(null);
    setDropIdx(null);
  };

  return (
    <section className="signal-list" aria-label="Signals">
      <h2>
        Signals <span className="count">{signals.length}</span>
      </h2>
      {signals.length === 0 && <p className="empty">No signals yet. Pick a waveform in the toolbox.</p>}
      <ul onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {signals.map((s, i) => (
          <Row
            key={s.id}
            s={s}
            selected={s.id === selectedId}
            dropBefore={dropIdx === i && dragId !== null}
            dropAfter={dropIdx === signals.length && i === signals.length - 1 && dragId !== null}
            onDragStart={() => setDragId(s.id)}
            onDragOverRow={(after) => setDropIdx(after ? i + 1 : i)}
            onDragEnd={() => {
              setDragId(null);
              setDropIdx(null);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

interface RowProps {
  s: SignalDef;
  selected: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart(): void;
  onDragOverRow(after: boolean): void;
  onDragEnd(): void;
}

function Row({ s, selected, dropBefore, dropAfter, onDragStart, onDragOverRow, onDragEnd }: RowProps) {
  const [renaming, setRenaming] = useState(false);
  const cls = ['row', selected && 'selected', !s.style.visible && 'hidden', dropBefore && 'drop-before', dropAfter && 'drop-after']
    .filter(Boolean)
    .join(' ');

  const finishRename = (value: string) => {
    setRenaming(false);
    const v = value.trim();
    if (v && v !== s.name) actions.updateSignal(s.id, (d) => void (d.name = v));
  };

  return (
    <li
      className={cls}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', s.id);
        onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        onDragOverRow(e.clientY > r.top + r.height / 2);
      }}
      onDragEnd={onDragEnd}
      onClick={() => actions.select(s.id)}
    >
      <span className="grip" title="Drag to reorder">
        <Icon name="grip" size={14} />
      </span>
      <label className="swatch" style={{ background: s.style.color }} title="Colour" onClick={(e) => e.stopPropagation()}>
        <input
          type="color"
          value={s.style.color}
          disabled={s.locked}
          onChange={(e) => actions.updateSignal(s.id, (d) => void (d.style.color = e.target.value), `color-${s.id}`)}
        />
      </label>
      {renaming ? (
        <input
          className="rename"
          autoFocus
          defaultValue={s.name}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => finishRename(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finishRename(e.currentTarget.value);
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span
          className="name"
          title={s.locked ? s.name : `${s.name} — double-click to rename (supports V_{out}, \\omega, ^2)`}
          onDoubleClick={() => !s.locked && setRenaming(true)}
        >
          <MathLabel text={s.name} />
        </span>
      )}
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon" title={s.style.visible ? 'Hide' : 'Show'} onClick={() => actions.toggleVisible(s.id)}>
          <Icon name={s.style.visible ? 'eye' : 'eyeOff'} size={14} />
        </button>
        <button className={`icon${s.locked ? ' active' : ''}`} title={s.locked ? 'Unlock' : 'Lock'} onClick={() => actions.toggleLock(s.id)}>
          <Icon name={s.locked ? 'lock' : 'unlock'} size={14} />
        </button>
        <button className="icon" title="Duplicate (Ctrl+D)" onClick={() => actions.duplicate(s.id)}>
          <Icon name="duplicate" size={14} />
        </button>
        <button className="icon" title="Delete (Del)" disabled={s.locked} onClick={() => actions.deleteSignal(s.id)}>
          <Icon name="trash" size={14} />
        </button>
      </span>
    </li>
  );
}
