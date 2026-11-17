/**
 * Signal list of the active figure: groups (collapse, rename, share one panel, show/lock all,
 * reorder, delete), signals (select, colour, rename, show, lock, duplicate, remove, delete) with
 * drag-and-drop between groups, and the project's signals not shown in this figure.
 */

import { useState } from 'react';
import type { SignalDef } from '../../core/model/project';
import { actions, figureGroups, useActiveFigure, useEditor } from '../../state/store';
import { Icon } from '../icons';
import { MathLabel } from '../MathLabel';
import { showContextMenu } from '../ContextMenu';
import { signalMenuItems } from '../signalMenu';

export function SignalList() {
  const project = useEditor((s) => s.project);
  const selectedId = useEditor((s) => s.selectedId);
  const fig = useActiveFigure();
  const groups = figureGroups(project, fig.id);
  const total = groups.reduce((n, g) => n + g.signals.length, 0);
  const inFigure = new Set(groups.flatMap((g) => g.signals.map((s) => s.id)));
  const others = project.signals.filter((s) => !inFigure.has(s.id));
  const multiFigure = project.figures.length > 1;
  const flat = groups.length === 1 && !groups[0]!.group.name;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ g: string; i: number } | null>(null);

  const endDrag = () => {
    setDragId(null);
    setDrop(null);
  };
  const onDrop = () => {
    if (dragId && drop) {
      const g = groups.find((x) => x.group.id === drop.g);
      const from = g ? g.signals.findIndex((s) => s.id === dragId) : -1;
      const i = from >= 0 && from < drop.i ? drop.i - 1 : drop.i;
      if (!(from >= 0 && i === from)) actions.moveSignal(dragId, drop.g, i);
    }
    endDrag();
  };

  return (
    <section className="signal-list" aria-label="Signals">
      <h2>
        Signals <span className="count">{total}</span>
        <button className="group-add" title="New group (moves the selected signal into it)" onClick={() => actions.addGroup()}>
          + Group
        </button>
      </h2>
      {total === 0 && others.length === 0 && <p className="empty">No signals yet. Pick a waveform in the toolbox.</p>}
      <div onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {groups.map(({ group, signals }, gi) => (
          <div key={group.id} className={`sig-group${drop?.g === group.id && dragId ? ' drop-into' : ''}`}>
            {!flat && (
              <GroupHeader
                id={group.id}
                name={group.name ?? 'Signals'}
                count={signals.length}
                share={!!group.share}
                collapsed={!!group.collapsed}
                allVisible={signals.length > 0 && signals.every((s) => s.style.visible)}
                allLocked={signals.length > 0 && signals.every((s) => s.locked)}
                first={gi === 0}
                last={gi === groups.length - 1}
                only={groups.length === 1}
                onDragOver={() => setDrop({ g: group.id, i: signals.length })}
              />
            )}
            {!group.collapsed && (
              <ul>
                {signals.map((s, i) => (
                  <Row
                    key={s.id}
                    s={s}
                    selected={s.id === selectedId}
                    dropBefore={!!dragId && drop?.g === group.id && drop.i === i}
                    dropAfter={!!dragId && drop?.g === group.id && drop.i === signals.length && i === signals.length - 1}
                    onDragStart={() => setDragId(s.id)}
                    onDragOverRow={(after) => setDrop({ g: group.id, i: after ? i + 1 : i })}
                    onDragEnd={endDrag}
                    onRemoveFromFigure={multiFigure ? () => actions.removeFromFigure(s.id) : undefined}
                  />
                ))}
                {signals.length === 0 && !flat && <li className="group-empty">Drag signals here</li>}
              </ul>
            )}
          </div>
        ))}
      </div>
      {others.length > 0 && (
        <details className="others" open={total === 0}>
          <summary>
            Not in this figure <span className="count">{others.length}</span>
          </summary>
          <ul>
            {others.map((s) => (
              <li key={s.id} className="row other">
                <span className="swatch static" style={{ background: s.style.color }} />
                <span className="name">
                  <MathLabel text={s.name} />
                </span>
                <button className="icon" title="Show in this figure" aria-label={`Add ${s.name} to this figure`} onClick={() => actions.addToFigure(s.id)}>
                  +
                </button>
                <button className="icon" title="Delete from the project" aria-label={`Delete ${s.name} from the project`} disabled={s.locked} onClick={() => actions.deleteSignal(s.id)}>
                  <Icon name="trash" size={14} />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

interface GroupHeaderProps {
  id: string;
  name: string;
  count: number;
  share: boolean;
  collapsed: boolean;
  allVisible: boolean;
  allLocked: boolean;
  first: boolean;
  last: boolean;
  only: boolean;
  onDragOver(): void;
}

function GroupHeader(p: GroupHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      className="group-head"
      onDragOver={(e) => {
        e.preventDefault();
        p.onDragOver();
      }}
    >
      <button className="icon chev" aria-label={p.collapsed ? 'Expand group' : 'Collapse group'} onClick={() => actions.updateGroup(p.id, { collapsed: !p.collapsed })}>
        {p.collapsed ? '▸' : '▾'}
      </button>
      {renaming ? (
        <input
          className="rename"
          autoFocus
          defaultValue={p.name}
          aria-label="Group name"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v) actions.updateGroup(p.id, { name: v });
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <span className="group-name" title="Double-click to rename" onDoubleClick={() => setRenaming(true)}>
          {p.name} <span className="count">{p.count}</span>
        </span>
      )}
      <span className="row-actions">
        <button
          className={`icon${p.share ? ' active' : ''}`}
          title={p.share ? 'Stacked mode: separate panels' : 'Stacked mode: share one panel for this group'}
          aria-label="Share one panel"
          aria-pressed={p.share}
          onClick={() => actions.updateGroup(p.id, { share: !p.share })}
        >
          <Icon name="overlay" size={14} />
        </button>
        <button className="icon" title={p.allVisible ? 'Hide all' : 'Show all'} onClick={() => actions.setGroupSignals(p.id, { visible: !p.allVisible })}>
          <Icon name={p.allVisible ? 'eye' : 'eyeOff'} size={14} />
        </button>
        <button className={`icon${p.allLocked ? ' active' : ''}`} title={p.allLocked ? 'Unlock all' : 'Lock all'} onClick={() => actions.setGroupSignals(p.id, { locked: !p.allLocked })}>
          <Icon name={p.allLocked ? 'lock' : 'unlock'} size={14} />
        </button>
        <button className="icon" title="Move group up" disabled={p.first} onClick={() => actions.moveGroup(p.id, -1)}>
          ↑
        </button>
        <button className="icon" title="Move group down" disabled={p.last} onClick={() => actions.moveGroup(p.id, 1)}>
          ↓
        </button>
        <button className="icon" title="Delete group (its signals move to the group above)" disabled={p.only} onClick={() => actions.deleteGroup(p.id)}>
          ✕
        </button>
      </span>
    </div>
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
  /** Present when the project has several figures. */
  onRemoveFromFigure?(): void;
}

function Row({ s, selected, dropBefore, dropAfter, onDragStart, onDragOverRow, onDragEnd, onRemoveFromFigure }: RowProps) {
  const [renaming, setRenaming] = useState(false);
  const cls = ['row', selected && 'selected', !s.style.visible && 'hidden', dropBefore && 'drop-before', dropAfter && 'drop-after']
    .filter(Boolean)
    .join(' ');

  const finishRename = (value: string) => {
    setRenaming(false);
    const v = value.trim();
    if (v && v !== s.name) actions.renameSignal(s.id, v);
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
      onContextMenu={(e) => {
        e.preventDefault();
        actions.select(s.id);
        showContextMenu(e.clientX, e.clientY, signalMenuItems(s, !!onRemoveFromFigure, undefined, () => setRenaming(true)));
      }}
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
        {onRemoveFromFigure && (
          <button className="icon" title="Remove from this figure (keeps the signal in the project)" aria-label="Remove from figure" onClick={onRemoveFromFigure}>
            ⊖
          </button>
        )}
        <button className="icon" title="Delete from the project (Del)" disabled={s.locked} onClick={() => actions.deleteSignal(s.id)}>
          <Icon name="trash" size={14} />
        </button>
      </span>
    </li>
  );
}
