/** Figure tabs above the plot: switch, rename (double-click), duplicate, close, add. */

import { useState } from 'react';
import { actions, useEditor } from '../../state/store';
import { Icon } from '../icons';

export function FigureTabs() {
  const figures = useEditor((s) => s.project.figures);
  const active = useEditor((s) => s.activeFigureId);
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <div className="figure-tabs" role="tablist" aria-label="Figures">
      {figures.map((f) => {
        const on = f.id === active || (figures.length === 1 && !figures.some((x) => x.id === active));
        return (
          <div key={f.id} className={`fig-tab${on ? ' on' : ''}`} role="tab" aria-selected={on}>
            {renaming === f.id ? (
              <input
                autoFocus
                defaultValue={f.name}
                aria-label="Figure name"
                onBlur={(e) => {
                  actions.renameFigure(f.id, e.target.value);
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <button className="fig-name" onClick={() => actions.switchFigure(f.id)} onDoubleClick={() => setRenaming(f.id)} title="Double-click to rename">
                {f.name}
              </button>
            )}
            {on && (
              <button className="icon fig-act" title="Duplicate this figure" aria-label="Duplicate figure" onClick={() => actions.duplicateFigure(f.id)}>
                <Icon name="duplicate" size={13} />
              </button>
            )}
            {on && figures.length > 1 && (
              <button
                className="icon fig-act"
                title="Close (delete) this figure — its signals stay in the project"
                aria-label="Delete figure"
                onClick={() => window.confirm(`Delete “${f.name}”? Its signals stay in the project.`) && actions.deleteFigure(f.id)}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
      <button className="fig-add" title="New figure" aria-label="New figure" onClick={() => actions.addFigure()}>
        +
      </button>
    </div>
  );
}
