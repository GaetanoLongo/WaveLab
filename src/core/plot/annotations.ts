/**
 * Annotations drawn into the scene (screen and exports): text labels, arrows and
 * dimension markers (Δt / ΔV) in data coordinates of the panel of their signal.
 */

import type { Annotation } from '../model/project';
import { plainText } from './mathtext';
import { formatSI } from '../units/si';
import { tToPx, yToPx, type FigureLayout, type PanelLayout } from './layout';
import type { SceneItem } from './scene';

export interface ResolvedAnnotation {
  a: Annotation;
  panel: PanelLayout;
  unit: string;
}

/** Panel and vertical unit of each annotation (its signal's panel, else the first panel). */
export function resolveAnnotations(anns: Annotation[] | undefined, l: FigureLayout, unitOf: (id: string) => string | undefined): ResolvedAnnotation[] {
  if (!anns?.length || !l.panels.length) return [];
  return anns.map((a) => {
    const panel = (a.on && l.panels.find((p) => p.traceIds.includes(a.on!))) || l.panels[0]!;
    const unit = (a.on && unitOf(a.on)) || '';
    return { a, panel, unit };
  });
}

/** Automatic label of a dimension marker. */
export function dimensionLabel(a: Annotation, unit: string): string {
  if (a.text.trim()) return a.text;
  if (a.kind === 'dim-t') return `Δt = ${formatSI(Math.abs(a.t1 - a.t0), 's', 4)}`;
  const sym = unit === 'V' ? 'ΔV' : unit === 'A' ? 'ΔI' : 'Δy';
  return `${sym} = ${formatSI(Math.abs(a.y1 - a.y0), unit, 4)}`;
}

/** Pixel geometry of an annotation (for drawing and hit-testing). */
export function annotationPx(r: ResolvedAnnotation, l: FigureLayout) {
  const { a, panel } = r;
  const x0 = tToPx(l, a.t0);
  const y0 = yToPx(panel, a.y0);
  if (a.kind === 'dim-t') return { x0, y0, x1: tToPx(l, a.t1), y1: y0 };
  if (a.kind === 'dim-y') return { x0, y0, x1: x0, y1: yToPx(panel, a.y1) };
  return { x0, y0, x1: tToPx(l, a.t1), y1: yToPx(panel, a.y1) };
}

/** Open arrowhead at (x, y) pointing along (dx, dy). */
function head(items: SceneItem[], x: number, y: number, dx: number, dy: number, size: number, color: string, w: number) {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const s = size;
  const p = [x - ux * s - uy * s * 0.45, y - uy * s + ux * s * 0.45, x, y, x - ux * s + uy * s * 0.45, y - uy * s - ux * s * 0.45];
  items.push({ type: 'path', polylines: [p], stroke: color, width: w, dash: 'solid' });
}

/** Rough text width in px (0.56 em per character of the visible text). */
export function textWidthPx(text: string, size: number): number {
  return plainText(text).length * size * 0.56;
}

/**
 * Label that fits in `maxPx`: the text itself, else without its leading word (so “0x48 'H'”
 * becomes “'H'”), else truncated with an ellipsis, else nothing.
 */
export function fitLabel(text: string, maxPx: number, size: number): string {
  if (textWidthPx(text, size) <= maxPx) return text;
  const words = text.split(' ');
  for (let i = 1; i < words.length; i++) {
    const t = words.slice(i).join(' ');
    if (textWidthPx(t, size) <= maxPx) return t;
  }
  const plain = plainText(text);
  const chars = Math.floor(maxPx / (size * 0.56)) - 1;
  return chars >= 2 && plain === text ? `${text.slice(0, chars)}…` : '';
}

/** Text with a plot-coloured backing so grid lines and traces do not run through it. */
function haloText(items: SceneItem[], bg: string | undefined, t: Extract<SceneItem, { type: 'text' }>) {
  if (bg && t.text) {
    const w = textWidthPx(t.text, t.size) + 4;
    const h = t.size * 1.2;
    const x = t.anchor === 'start' ? t.x - 2 : t.anchor === 'end' ? t.x - w + 2 : t.x - w / 2;
    const y = t.baseline === 'top' ? t.y : t.baseline === 'bottom' ? t.y - h : t.y - h / 2;
    items.push({ type: 'rect', x, y, w, h, fill: bg, opacity: 0.85 });
  }
  items.push(t);
}

export function drawAnnotations(items: SceneItem[], list: ResolvedAnnotation[], l: FigureLayout, fsBase: number, lineScale = 1, selectedId?: string | null, bg?: string) {
  const baseW = 1.3 * lineScale;
  for (const r of list) {
    const { a } = r;
    const w = baseW * (a.width ?? 1);
    const fs = fsBase * (a.size ?? 1);
    const hs = Math.max(6, fs * 0.6);
    const g = annotationPx(r, l);
    if (a.id === selectedId) {
      // Selection halo.
      items.push({ type: 'path', polylines: [[g.x0, g.y0, g.x1, g.y1]], stroke: '#0b6bcb', width: 8, dash: 'solid', opacity: 0.18 });
    }
    switch (a.kind) {
      case 'text':
        haloText(items, bg, { type: 'text', x: g.x0, y: g.y0, text: a.text || 'Text', size: fs, fill: a.color, anchor: 'start', baseline: 'middle' });
        break;
      case 'arrow': {
        items.push({ type: 'line', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y1, stroke: a.color, width: w });
        head(items, g.x1, g.y1, g.x1 - g.x0, g.y1 - g.y0, hs, a.color, w);
        if (a.text) {
          // Label beyond the tail, on the side away from the head.
          const left = g.x1 > g.x0;
          haloText(items, bg, {
            type: 'text',
            x: g.x0 + (left ? -4 : 4),
            y: g.y0,
            text: a.text,
            size: fs,
            fill: a.color,
            anchor: left ? 'end' : 'start',
            baseline: 'middle',
          });
        }
        break;
      }
      case 'dim-t': {
        const ext = hs * 0.9;
        items.push({ type: 'line', x1: g.x0, y1: g.y0 - ext, x2: g.x0, y2: g.y0 + ext, stroke: a.color, width: w });
        items.push({ type: 'line', x1: g.x1, y1: g.y0 - ext, x2: g.x1, y2: g.y0 + ext, stroke: a.color, width: w });
        items.push({ type: 'line', x1: g.x0, y1: g.y0, x2: g.x1, y2: g.y0, stroke: a.color, width: w });
        head(items, g.x0, g.y0, g.x0 - g.x1, 0, hs, a.color, w);
        head(items, g.x1, g.y0, g.x1 - g.x0, 0, hs, a.color, w);
        const room = Math.abs(g.x1 - g.x0) - 2 * hs - 4;
        haloText(items, bg, { type: 'text', x: (g.x0 + g.x1) / 2, y: g.y0 - 4, text: fitLabel(dimensionLabel(a, r.unit), room, fs * 0.92), size: fs * 0.92, fill: a.color, anchor: 'middle', baseline: 'bottom' });
        break;
      }
      case 'dim-y': {
        const ext = hs * 0.9;
        items.push({ type: 'line', x1: g.x0 - ext, y1: g.y0, x2: g.x0 + ext, y2: g.y0, stroke: a.color, width: w });
        items.push({ type: 'line', x1: g.x0 - ext, y1: g.y1, x2: g.x0 + ext, y2: g.y1, stroke: a.color, width: w });
        items.push({ type: 'line', x1: g.x0, y1: g.y0, x2: g.x0, y2: g.y1, stroke: a.color, width: w });
        head(items, g.x0, g.y0, 0, g.y0 - g.y1, hs, a.color, w);
        head(items, g.x0, g.y1, 0, g.y1 - g.y0, hs, a.color, w);
        haloText(items, bg, { type: 'text', x: g.x0 + ext + 3, y: (g.y0 + g.y1) / 2, text: dimensionLabel(a, r.unit), size: fs * 0.92, fill: a.color, anchor: 'start', baseline: 'middle' });
        break;
      }
    }
  }
}

/** Annotation under the pointer (within `tol` px of its line or text start). */
export function annotationAt(list: ResolvedAnnotation[], l: FigureLayout, x: number, y: number, tol = 6): ResolvedAnnotation | null {
  let best: ResolvedAnnotation | null = null;
  let bestD = tol;
  for (const r of list) {
    const g = annotationPx(r, l);
    let d: number;
    if (r.a.kind === 'text') {
      // Rough text box: starts at the anchor, ~0.6 em per character.
      const wTxt = Math.max(20, (r.a.text || 'Text').length * 7);
      d = x >= g.x0 - 2 && x <= g.x0 + wTxt && Math.abs(y - g.y0) <= 9 ? 0 : Infinity;
    } else {
      const dx = g.x1 - g.x0;
      const dy = g.y1 - g.y0;
      const len2 = dx * dx + dy * dy;
      const u = len2 > 0 ? Math.max(0, Math.min(1, ((x - g.x0) * dx + (y - g.y0) * dy) / len2)) : 0;
      d = Math.hypot(x - (g.x0 + u * dx), y - (g.y0 + u * dy));
    }
    if (d <= bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
