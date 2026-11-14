/** Serialize a Scene to a standalone SVG string (true vector, editable text). */

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
      let d = '';
      for (const pl of it.polylines) {
        for (let i = 0; i < pl.length; i += 2) {
          d += (i === 0 ? 'M' : 'L') + r2(pl[i]!) + ' ' + r2(pl[i + 1]!);
        }
      }
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
      const baseline = it.baseline === 'top' ? 'hanging' : it.baseline === 'middle' ? 'central' : 'alphabetic';
      const a = [
        `x="${r2(it.x)}"`,
        `y="${r2(it.y)}"`,
        `font-size="${r2(it.size)}"`,
        `fill="${it.fill}"`,
        `text-anchor="${it.anchor}"`,
        `dominant-baseline="${baseline}"`,
      ];
      if (it.weight === 'bold') a.push('font-weight="bold"');
      if (it.rotate) a.push(`transform="rotate(${it.rotate} ${r2(it.x)} ${r2(it.y)})"`);
      return `<text ${a.join(' ')}>${esc(it.text)}</text>`;
    }
  }
}

/**
 * @param idPrefix unique prefix for clip-path ids (needed when several SVGs share a page).
 */
export function sceneToSvg(scene: Scene, idPrefix = 'wl-'): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r2(scene.width)}" height="${r2(scene.height)}" ` +
      `viewBox="0 0 ${r2(scene.width)} ${r2(scene.height)}" font-family="${esc(scene.fontFamily)}">`,
  );
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
