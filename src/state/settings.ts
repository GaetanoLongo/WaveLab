/**
 * Application preferences (not part of the project document): snap settings.
 * Persisted per browser in localStorage when available.
 */

import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { DEFAULT_SNAP, type SnapSettings } from '../core/snap/snap';

const KEY = 'wavelab.snap.v1';

function load(): SnapSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_SNAP, ...(JSON.parse(raw) as Partial<SnapSettings>) };
  } catch {
    /* storage unavailable: use defaults */
  }
  return { ...DEFAULT_SNAP };
}

export const settings = createStore<{ snap: SnapSettings }>(() => ({ snap: load() }));

export function useSettings<T>(sel: (s: { snap: SnapSettings }) => T): T {
  return useStore(settings, sel);
}

export function updateSnap(patch: Partial<SnapSettings>) {
  const snap = { ...settings.getState().snap, ...patch };
  settings.setState({ snap });
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}
