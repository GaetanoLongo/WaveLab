/** Thin drag handle between panels. Double-click resets the size. */

import { useRef } from 'react';

export function Resizer(p: {
  /** 'col' = vertical bar resizing a width; 'row' = horizontal bar resizing a height. */
  orientation: 'col' | 'row';
  /** Current size in px (read at the start of a drag); receives the handle's parent element. */
  size(parent: HTMLElement): number;
  /** Pointer movement along the axis since the drag started (px) and the size at its start. */
  onResize(delta: number, startSize: number): void;
  onReset?(): void;
  label: string;
}) {
  const start = useRef<{ pos: number; size: number } | null>(null);
  const axis = p.orientation === 'col' ? 'clientX' : 'clientY';
  return (
    <div
      className={`resizer ${p.orientation}`}
      role="separator"
      aria-orientation={p.orientation === 'col' ? 'vertical' : 'horizontal'}
      aria-label={p.label}
      title={`${p.label} (double-click to reset)`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: e[axis], size: p.size(e.currentTarget.parentElement as HTMLElement) };
      }}
      onPointerMove={(e) => {
        if (start.current) p.onResize(e[axis] - start.current.pos, start.current.size);
      }}
      onPointerUp={() => (start.current = null)}
      onPointerCancel={() => (start.current = null)}
      onDoubleClick={p.onReset}
    />
  );
}
