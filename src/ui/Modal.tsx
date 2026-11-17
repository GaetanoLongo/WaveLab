/** Minimal accessible modal: backdrop click and Escape close it. */

import { useEffect, useRef, type ReactNode } from 'react';
import { create } from 'zustand';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal(p: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && p.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);
  // Keyboard users: the dialog takes the focus when it opens, Tab / Shift+Tab stay inside it, and the
  // focus goes back to what had it (the toolbox entry, the toolbar button) when it closes.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('.modal-body input:not([disabled]), .modal-body select:not([disabled]), .modal-body button:not([disabled])') ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el;
      first.focus({ preventScroll: true });
    }
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (items.length === 0) return e.preventDefault();
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !box.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <div ref={box} tabIndex={-1} onKeyDown={trap} className={`modal ${p.className ?? ''}`} role="dialog" aria-modal="true" aria-label={p.title}>
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
