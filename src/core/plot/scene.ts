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
