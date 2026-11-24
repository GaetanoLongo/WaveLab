/** Serialize a Scene to a standalone SVG string (true vector, editable text). */

import { parseMath, SHIFT_SIZE, SUB_DY, SUP_DY } from './mathtext';
import type { Dash, Scene, SceneItem } from './scene';

const r2 = (v: number) => (Math.round(v * 100) / 100).toString();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function dashArray(dash: Dash, width: number): string | null {
  const w = Math.max(1, width);
  switch (dash) {
    case 'solid':
      return null;
    case 'dashed':
      return `${r2(5 * w)} ${r2(3 * w)}`;
    case 'dotted':
      return `${r2(0.1)} ${r2(2.2 * w)}`;
    case 'dashdot':
      return `${r2(6 * w)} ${r2(2.5 * w)} ${r2(0.1)} ${r2(2.5 * w)}`;
  }
}

/**
 * Path text of a set of polylines, remembered per array: trace polylines are reused between redraws
 * while their pixels are unchanged (see `toPixels` in layout.ts), and writing the text of every trace
 * was the largest cost of a redraw. Scene polylines are never modified after they are built.
 */
const pathCache = new WeakMap<number[][], string>();

function pathData(polylines: number[][]): string {
  const hit = pathCache.get(polylines);
  if (hit !== undefined) return hit;
  let d = '';
  for (const pl of polylines) {
    for (let i = 0; i < pl.length; i += 2) {
      d += (i === 0 ? 'M' : 'L') + r2(pl[i]!) + ' ' + r2(pl[i + 1]!);
    }
  }
  pathCache.set(polylines, d);
  return d;
}

function item(it: SceneItem, idPrefix: string): string {
  switch (it.type) {
    case 'rect': {
      const a = [`x="${r2(it.x)}"`, `y="${r2(it.y)}"`, `width="${r2(it.w)}"`, `height="${r2(it.h)}"`];
      a.push(`fill="${it.fill ?? 'none'}"`);
      if (it.stroke) a.push(`stroke="${it.stroke}"`, `stroke-width="${r2(it.strokeWidth ?? 1)}"`);
      if (it.opacity !== undefined) a.push(`opacity="${it.opacity}"`);
      return `<rect ${a.join(' ')}/>`;
    }
    case 'line': {
      const a = [
        `x1="${r2(it.x1)}"`,
        `y1="${r2(it.y1)}"`,
        `x2="${r2(it.x2)}"`,
        `y2="${r2(it.y2)}"`,
        `stroke="${it.stroke}"`,
        `stroke-width="${r2(it.width)}"`,
      ];
      if (it.opacity !== undefined) a.push(`stroke-opacity="${it.opacity}"`);
      const d = it.dash ? dashArray(it.dash, it.width) : null;
      if (d) a.push(`stroke-dasharray="${d}"`);
      return `<line ${a.join(' ')}/>`;
    }
    case 'path': {
      const d = pathData(it.polylines);
      if (!d) return '';
      const a = [
        `d="${d}"`,
        'fill="none"',
        `stroke="${it.stroke}"`,
        `stroke-width="${r2(it.width)}"`,
        'stroke-linejoin="round"',
        `stroke-linecap="${it.dash === 'dotted' || it.dash === 'dashdot' ? 'round' : 'butt'}"`,
      ];
      const da = dashArray(it.dash, it.width);
      if (da) a.push(`stroke-dasharray="${da}"`);
      if (it.opacity !== undefined) a.push(`stroke-opacity="${it.opacity}"`);
      if (it.clipId) a.push(`clip-path="url(#${idPrefix}${it.clipId})"`);
      if (it.dataId) a.push(`data-signal="${esc(it.dataId)}"`);
      return `<path ${a.join(' ')}/>`;
    }
    case 'text': {
      // Explicit baseline offsets (fractions of the font size, tuned for Inter) instead of
      // dominant-baseline, which PDF converters and some editors handle inconsistently.
      const dy = it.baseline === 'top' ? 0.76 * it.size : it.baseline === 'middle' ? 0.36 * it.size : 0;
      const a = [
        `x="${r2(it.x)}"`,
        `y="${r2(it.y + dy)}"`,
        `font-size="${r2(it.size)}"`,
        `fill="${it.fill}"`,
        `text-anchor="${it.anchor}"`,
      ];
      if (it.weight === 'bold') a.push('font-weight="bold"');
      if (it.rotate) a.push(`transform="rotate(${it.rotate} ${r2(it.x)} ${r2(it.y)})"`);
      return `<text ${a.join(' ')}>${mathTspans(it.text, it.size)}</text>`;
    }
  }
}

/**
 * Text content with math markup as <tspan>s. Vertical offsets use relative dy
 * (supported by browsers and svg2pdf), so text-anchor still applies to the whole label.
 */
function mathTspans(src: string, size: number): string {
  const runs = parseMath(src);
  if (runs.length === 1 && runs[0]!.shift === 'none') return esc(runs[0]!.text);
  let offset = 0;
  let out = '';
  for (const r of runs) {
    const target = r.shift === 'sub' ? SUB_DY * size : r.shift === 'sup' ? SUP_DY * size : 0;
    const dy = target - offset;
    offset = target;
    const attrs = [dy !== 0 ? `dy="${r2(dy)}"` : '', r.shift !== 'none' ? `font-size="${r2(size * SHIFT_SIZE)}"` : '']
      .filter(Boolean)
      .join(' ');
    out += attrs ? `<tspan ${attrs}>${esc(r.text)}</tspan>` : `<tspan>${esc(r.text)}</tspan>`;
  }
  return out;
}

export interface SvgOptions {
  /** Unique prefix for clip-path ids (needed when several SVGs share a page). */
  idPrefix?: string;
  /** Extra CSS placed in a <style> element (e.g. embedded @font-face for PNG export). */
  css?: string;
  /** Prepend an XML declaration (standalone .svg files). */
  xmlDeclaration?: boolean;
  /** Multiply the width/height attributes (viewBox unchanged) for high-resolution rasterizing. */
  pixelScale?: number;
}

/**
 * @param idPrefix unique prefix for clip-path ids (needed when several SVGs share a page).
 */
export function sceneToSvg(scene: Scene, opts: SvgOptions | string = {}): string {
  const o: SvgOptions = typeof opts === 'string' ? { idPrefix: opts } : opts;
  const idPrefix = o.idPrefix ?? 'wl-';
  const parts: string[] = [];
  if (o.xmlDeclaration) parts.push('<?xml version="1.0" encoding="UTF-8"?>\n');
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(scene.width * (o.pixelScale ?? 1))}" height="${r2(scene.height * (o.pixelScale ?? 1))}" ` +
      `viewBox="0 0 ${r2(scene.width)} ${r2(scene.height)}" font-family="${esc(scene.fontFamily)}">`,
  );
  if (o.css) parts.push(`<style>${o.css}</style>`);
  if (scene.clips.length > 0) {
    parts.push('<defs>');
    for (const c of scene.clips) {
      parts.push(
        `<clipPath id="${idPrefix}${c.id}"><rect x="${r2(c.x)}" y="${r2(c.y)}" width="${r2(c.w)}" height="${r2(c.h)}"/></clipPath>`,
      );
    }
    parts.push('</defs>');
  }
  if (scene.background) {
    parts.push(`<rect x="0" y="0" width="${r2(scene.width)}" height="${r2(scene.height)}" fill="${scene.background}"/>`);
  }
  for (const it of scene.items) parts.push(item(it, idPrefix));
  parts.push('</svg>');
  return parts.join('');
}
