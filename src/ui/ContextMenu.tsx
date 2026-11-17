/** Right-click menu: a small popup at the pointer that replaces the browser's own menu. */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';

export type MenuItem =
  | { label: string; onClick(): void; disabled?: boolean; danger?: boolean; title?: string }
  | 'separator';

const useMenu = create<{ at: { x: number; y: number; items: MenuItem[] } | null }>(() => ({ at: null }));
let opener: HTMLElement | null = null;

/** Open the menu at client coordinates (also call `preventDefault()` on the contextmenu event). */
export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  // Drop leading/trailing/double separators so conditional items never leave stray lines.
  const clean = items.filter((it, i) => it !== 'separator' || (i > 0 && items[i - 1] !== 'separator' && i < items.length - 1));
  if (clean.length > 0) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    useMenu.setState({ at: { x, y, items: clean } });
  }
}
export const closeContextMenu = () => {
  const had = useMenu.getState().at !== null;
  useMenu.setState({ at: null });
  // Give the focus back to what had it (a signal row opened with the keyboard), if it is still there.
  if (had && opener && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null;
};

export function ContextMenu() {
  const at = useMenu((s) => s.at);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!at || !ref.current) return setPos(null);
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
    ref.current.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeContextMenu();
    const onDown = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) closeContextMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', closeContextMenu, { passive: true });
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', closeContextMenu);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, [at]);

  if (!at) return null;
  return (
    <div
      ref={ref}
      className="popover menu context-menu"
      role="menu"
      style={{ position: 'fixed', left: pos?.left ?? at.x, top: pos?.top ?? at.y, right: 'auto', visibility: pos ? 'visible' : 'hidden', zIndex: 1000 }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        if (e.key === 'ArrowDown') (e.preventDefault(), items[(i + 1) % items.length]?.focus());
        else if (e.key === 'ArrowUp') (e.preventDefault(), items[(i - 1 + items.length) % items.length]?.focus());
        else if (e.key === 'Home') (e.preventDefault(), items[0]?.focus());
        else if (e.key === 'End') (e.preventDefault(), items[items.length - 1]?.focus());
        else if (e.key === 'Tab') (e.preventDefault(), closeContextMenu());
      }}
    >
      {at.items.map((it, i) =>
        it === 'separator' ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            title={it.title}
            className={it.danger ? 'danger' : ''}
            onClick={() => {
              closeContextMenu();
              it.onClick();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}
