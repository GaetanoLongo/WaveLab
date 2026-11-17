/** Workspace layout (panel visibility and sizes), remembered in the browser. Not part of the project file. */

import { create } from 'zustand';

export interface LayoutState {
  toolboxOpen: boolean;
  inspectorOpen: boolean;
  measureOpen: boolean;
  toolboxW: number;
  inspectorW: number;
  /** Height of the measurement panel in px; null = automatic. */
  measureH: number | null;
}

export const DEFAULT_LAYOUT: LayoutState = {
  toolboxOpen: true,
  inspectorOpen: true,
  measureOpen: true,
  toolboxW: 200,
  inspectorW: 300,
  measureH: null,
};

const KEY = 'wavelab.layout.v1';

const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

/** Sanitize stored/updated values (limits keep the plot usable). */
export function normalizeLayout(raw: Partial<Record<keyof LayoutState, unknown>>): LayoutState {
  const d = DEFAULT_LAYOUT;
  return {
    toolboxOpen: bool(raw.toolboxOpen, d.toolboxOpen),
    inspectorOpen: bool(raw.inspectorOpen, d.inspectorOpen),
    measureOpen: bool(raw.measureOpen, d.measureOpen),
    toolboxW: clamp(raw.toolboxW, 140, 520, d.toolboxW),
    inspectorW: clamp(raw.inspectorW, 220, 700, d.inspectorW),
    measureH: raw.measureH === null || raw.measureH === undefined ? null : clamp(raw.measureH, 60, 700, 200),
  };
}

function load(): LayoutState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeLayout(JSON.parse(raw) as Partial<LayoutState>);
  } catch {
    /* defaults */
  }
  return { ...DEFAULT_LAYOUT };
}

export const useLayout = create<LayoutState>(() => load());

export function setLayout(patch: Partial<LayoutState>) {
  const next = normalizeLayout({ ...useLayout.getState(), ...patch });
  useLayout.setState(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}
