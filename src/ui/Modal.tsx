/** Minimal accessible modal: backdrop click and Escape close it. */

import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';

export function Modal(p: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; className?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div className={`modal ${p.className ?? ''}`} role="dialog" aria-modal="true" aria-label={p.title}>
        <header>
          <h2>{p.title}</h2>
          <button className="icon" aria-label="Close" onClick={p.onClose}>
            ✕
          </button>
        </header>
        <div className="modal-body">{p.children}</div>
        {p.footer && <footer>{p.footer}</footer>}
      </div>
    </div>
  );
}

/** Which secondary dialogs are open. `axes` holds the section to focus ('x', a panel id or 'all'). */
export const useDialogs = create<{ settings: boolean; axes: string | null }>(() => ({ settings: false, axes: null }));
export const openSettings = () => useDialogs.setState({ settings: true });
export const openAxes = (focus = 'all') => useDialogs.setState({ axes: focus });
export const anyDialogOpen = () => {
  const s = useDialogs.getState();
  return s.settings || s.axes !== null;
};
