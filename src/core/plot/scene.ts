/**
 * Renderer-agnostic scene description in pixel coordinates. The same scene is
 * serialized to SVG for the screen and for export, so exports match the view.
 */

export type Dash = 'solid' | 'dashed' | 'dotted' | 'dashdot';

export interface SceneRect {
  type: 'rect';
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface SceneLine {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: string;
  width: number;
  opacity?: number;
  dash?: Dash;
}

export interface ScenePath {
  type: 'path';
  /** Flat [x0, y0, x1, y1, ...] arrays, one per polyline. */
  polylines: number[][];
  stroke: string;
  width: number;
  dash: Dash;
  clipId?: string;
  opacity?: number;
  /** Logical grouping id (signal id), emitted as a data attribute. */
  dataId?: string;
}

export interface SceneText {
  type: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  fill: string;
  anchor: 'start' | 'middle' | 'end';
  baseline: 'top' | 'middle' | 'bottom';
  rotate?: number;
  weight?: 'normal' | 'bold';
}

export type SceneItem = SceneRect | SceneLine | ScenePath | SceneText;

export interface SceneClip {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Scene {
  width: number;
  height: number;
  background: string | null;
  fontFamily: string;
  clips: SceneClip[];
  items: SceneItem[];
}

/** Combine scenes into one (e.g. a grid of figures): offsets every item and prefixes clip ids. */
export function composeScenes(
  cells: Array<{ scene: Scene; x: number; y: number }>,
  width: number,
  height: number,
  background: string | null,
): Scene {
  const clips: SceneClip[] = [];
  const items: SceneItem[] = [];
  cells.forEach(({ scene, x, y }, i) => {
    const pre = `c${i}-`;
    for (const c of scene.clips) clips.push({ ...c, id: pre + c.id, x: c.x + x, y: c.y + y });
    if (scene.background) items.push({ type: 'rect', x, y, w: scene.width, h: scene.height, fill: scene.background });
    for (const it of scene.items) {
      switch (it.type) {
        case 'rect':
          items.push({ ...it, x: it.x + x, y: it.y + y });
          break;
        case 'line':
          items.push({ ...it, x1: it.x1 + x, x2: it.x2 + x, y1: it.y1 + y, y2: it.y2 + y });
          break;
        case 'text':
          items.push({ ...it, x: it.x + x, y: it.y + y });
          break;
        case 'path':
          items.push({
            ...it,
            clipId: it.clipId ? pre + it.clipId : undefined,
            polylines: it.polylines.map((pl) => pl.map((v, k) => v + (k % 2 === 0 ? x : y))),
          });
          break;
      }
    }
  });
  return { width, height, background, fontFamily: cells[0]?.scene.fontFamily ?? 'sans-serif', clips, items };
}
