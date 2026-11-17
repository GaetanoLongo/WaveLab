/**
 * Popovers (snap, annotate, export menus…) are anchored to their toolbar button and aligned to its
 * right edge. When the toolbar wraps, or the window is narrow, that can put them partly off screen.
 * Whenever one opens it is shifted back into the window, and made scrollable if it is too tall.
 */

const MARGIN = 8;

function clamp(el: HTMLElement) {
  if (el.classList.contains('context-menu')) return; // positioned by its own code
  el.style.transform = '';
  el.style.maxHeight = '';
  const r = el.getBoundingClientRect();
  if (r.width === 0) return;
  let dx = 0;
  if (r.left < MARGIN) dx = MARGIN - r.left;
  else if (r.right > window.innerWidth - MARGIN) dx = window.innerWidth - MARGIN - r.right;
  if (dx) el.style.transform = `translateX(${dx}px)`;
  const room = window.innerHeight - r.top - MARGIN;
  if (r.height > room && room > 120) {
    el.style.maxHeight = `${room}px`;
    el.style.overflowY = 'auto';
  }
}

export function installPopoverClamp(): () => void {
  const seen = new WeakSet<Element>();
  const check = () => {
    for (const el of document.querySelectorAll<HTMLElement>('.popover')) {
      if (!seen.has(el)) {
        seen.add(el);
        clamp(el);
      }
    }
  };
  const mo = new MutationObserver(check);
  mo.observe(document.body, { childList: true, subtree: true });
  const onResize = () => document.querySelectorAll<HTMLElement>('.popover').forEach(clamp);
  window.addEventListener('resize', onResize);
  return () => {
    mo.disconnect();
    window.removeEventListener('resize', onResize);
  };
}
