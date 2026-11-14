/**
 * Editor state: the project document (undoable), the view (not undoable) and
 * transient UI state. Document edits go through `commit`, which records history.
 *
 * Undo/redo stores whole-project snapshots. Immer shares unchanged structure
 * between snapshots, so this stays cheap for documents of this size.
 */

import { produce, type Draft } from 'immer';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { defaultGenerator } from '../core/model/defaults';
import { paletteColor } from '../core/model/palette';
import { emptyProject, type Project, type SignalDef } from '../core/model/project';
import type { GeneratorKind } from '../core/model/signal-defs';
import type { Range } from '../core/plot/range';
import { fitTimeRange } from '../core/plot/viewport';
import { compiled } from './compiled';

export const HISTORY_LIMIT = 200;
/** Consecutive edits with the same key within this time form one undo step. */
export const COALESCE_MS = 800;

export interface ViewState {
  xRange: Range;
  yRanges: Record<string, Range | null>;
}

export interface EditorState {
  project: Project;
  /** Project as last saved/opened; `project !== savedProject` means unsaved changes. */
  savedProject: Project;
  past: Project[];
  future: Project[];
  lastEdit: { key: string; at: number } | null;
  selectedId: string | null;
  clipboard: SignalDef | null;
  view: ViewState;
  /** Short message shown in the status bar (e.g. "Signal is locked"). */
  notice: string | null;
}

export const GENERATOR_LABELS: Record<GeneratorKind, string> = {
  sine: 'Sine',
  cosine: 'Cosine',
  square: 'Square',
  pulse: 'Pulse',
  triangle: 'Triangle',
  sawtooth: 'Sawtooth',
  dc: 'DC',
};

function initialState(project = emptyProject()): EditorState {
  return {
    project,
    savedProject: project,
    past: [],
    future: [],
    lastEdit: null,
    selectedId: null,
    clipboard: null,
    view: { xRange: [0, 0.04], yRanges: {} },
    notice: null,
  };
}

export const editor = createStore<EditorState>(() => initialState());

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editor, selector);
}

export const isDirty = (s: EditorState) => s.project !== s.savedProject;
export const canUndo = (s: EditorState) => s.past.length > 0;
export const canRedo = (s: EditorState) => s.future.length > 0;

// ---------------------------------------------------------------------------
// Helpers

const get = editor.getState;
const set = editor.setState;

let idCounter = 0;
export function newId(prefix = 's'): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Ordered trace list of the (single, for now) figure. */
function order(p: Project | Draft<Project>) {
  return p.figures[0]!.panels[0]!.traces;
}

export function orderedSignals(p: Project): SignalDef[] {
  const byId = new Map(p.signals.map((s) => [s.id, s]));
  return order(p)
    .map((t) => byId.get(t.signalId))
    .filter((s): s is SignalDef => s !== undefined);
}

export function findSignal(p: Project, id: string | null): SignalDef | undefined {
  return id ? p.signals.find((s) => s.id === id) : undefined;
}

function uniqueName(p: Project, base: string): string {
  const names = new Set(p.signals.map((s) => s.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}

function nextColor(p: Project): string {
  const used = new Set(p.signals.map((s) => s.style.color.toLowerCase()));
  for (let i = 0; i < 8; i++) if (!used.has(paletteColor(i).toLowerCase())) return paletteColor(i);
  return paletteColor(p.signals.length);
}

/** Negation that never produces −0 (which would display as "-0"). */
const neg = (x: number) => (x === 0 ? 0 : -x);

function notify(msg: string) {
  set({ notice: msg });
}

/**
 * Apply an undoable change to the project. Changes producing no difference are ignored.
 * `key`: edits with the same key in quick succession merge into one undo step.
 */
export function commit(recipe: (d: Draft<Project>) => void, key?: string): void {
  const s = get();
  const next = produce(s.project, recipe);
  if (next === s.project) return;
  const now = Date.now();
  const merge = key !== undefined && s.lastEdit?.key === key && now - s.lastEdit.at < COALESCE_MS;
  set({
    project: next,
    past: merge ? s.past : [...s.past, s.project].slice(-HISTORY_LIMIT),
    future: [],
    lastEdit: key !== undefined ? { key, at: now } : null,
    notice: null,
  });
}

// ---------------------------------------------------------------------------
// Actions

export const actions = {
  undo() {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      project: prev,
      past: s.past.slice(0, -1),
      future: [s.project, ...s.future],
      lastEdit: null,
      selectedId: findSignal(prev, s.selectedId) ? s.selectedId : null,
    });
  },

  redo() {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      project: next,
      past: [...s.past, s.project],
      future: s.future.slice(1),
      lastEdit: null,
      selectedId: findSignal(next, s.selectedId) ? s.selectedId : null,
    });
  },

  newProject() {
    set(initialState());
  },

  /** Replace the whole document (used by Open in M5) — clears history. */
  loadProject(project: Project) {
    set(initialState(project));
    actions.fitAll();
  },

  markSaved() {
    set({ savedProject: get().project });
  },

  renameProject(name: string) {
    commit((d) => {
      d.name = name.trim() || 'Untitled';
    });
  },

  setMode(mode: 'overlay' | 'stacked') {
    commit((d) => {
      d.figures[0]!.mode = mode;
    });
  },

  select(id: string | null) {
    set({ selectedId: id, notice: null });
  },

  /** Add a generator signal; `customize` adjusts the definition (presets) in the same undo step. */
  addSignal(kind: GeneratorKind, customize?: (def: SignalDef) => void, name?: string) {
    const p = get().project;
    const first = p.signals.length === 0;
    const def: SignalDef = {
      id: newId(),
      name: uniqueName(p, name ?? GENERATOR_LABELS[kind]),
      unit: 'V',
      locked: false,
      style: { color: nextColor(p), lineWidth: 1.6, dash: 'solid', visible: true, showInLegend: true },
      kind: 'generator',
      ...defaultGenerator(kind),
    };
    customize?.(def);
    commit((d) => {
      d.signals.push(def);
      order(d).push({ signalId: def.id });
    });
    set({ selectedId: def.id });
    if (first) actions.fitAll();
    return def.id;
  },

  /** Insert a copy of `src` right after `afterId` (or at the end). */
  insertCopy(src: SignalDef, afterId?: string) {
    const p = get().project;
    const copy: SignalDef = {
      ...structuredClone(src),
      id: newId(),
      name: uniqueName(p, `${src.name} copy`),
      locked: false,
    };
    copy.style.color = nextColor(p);
    commit((d) => {
      d.signals.push(copy);
      const tr = order(d);
      const idx = afterId ? tr.findIndex((t) => t.signalId === afterId) : -1;
      tr.splice(idx >= 0 ? idx + 1 : tr.length, 0, { signalId: copy.id });
    });
    set({ selectedId: copy.id });
    return copy.id;
  },

  duplicate(id = get().selectedId) {
    const src = findSignal(get().project, id);
    if (src) actions.insertCopy(src, src.id);
  },

  copy(id = get().selectedId) {
    const src = findSignal(get().project, id);
    if (src) set({ clipboard: structuredClone(src), notice: `Copied “${src.name}”` });
  },

  paste() {
    const clip = get().clipboard;
    if (clip) actions.insertCopy(clip, get().selectedId ?? undefined);
  },

  deleteSignal(id = get().selectedId) {
    const p = get().project;
    const sig = findSignal(p, id);
    if (!sig) return;
    if (sig.locked) {
      notify(`“${sig.name}” is locked — unlock it to delete.`);
      return;
    }
    const ord = orderedSignals(p);
    const idx = ord.findIndex((s) => s.id === sig.id);
    commit((d) => {
      d.signals = d.signals.filter((s) => s.id !== sig.id);
      const fig = d.figures[0]!;
      for (const panel of fig.panels) panel.traces = panel.traces.filter((t) => t.signalId !== sig.id);
    });
    const remaining = ord.filter((s) => s.id !== sig.id);
    set({ selectedId: remaining[Math.min(idx, remaining.length - 1)]?.id ?? null });
  },

  /**
   * Edit a signal. Locked signals reject edits unless `allowLocked` (used for the
   * lock and visibility toggles, which must work on locked signals).
   */
  updateSignal(id: string, recipe: (s: Draft<SignalDef>) => void, key?: string, allowLocked = false) {
    const sig = findSignal(get().project, id);
    if (!sig) return;
    if (sig.locked && !allowLocked) {
      notify(`“${sig.name}” is locked — unlock it to edit.`);
      return;
    }
    commit((d) => {
      const s = d.signals.find((x) => x.id === id);
      if (s) recipe(s);
    }, key);
  },

  toggleVisible(id: string) {
    actions.updateSignal(id, (s) => void (s.style.visible = !s.style.visible), undefined, true);
  },

  toggleLock(id: string) {
    actions.updateSignal(id, (s) => void (s.locked = !s.locked), undefined, true);
  },

  /** Mirror the waveform around zero (y → −y) by transforming its parameters. */
  invert(id = get().selectedId) {
    if (!id) return;
    actions.updateSignal(id, (s) => {
      switch (s.generator) {
        case 'sine':
        case 'cosine':
        case 'triangle':
        case 'sawtooth':
          s.params.amplitude = neg(s.params.amplitude);
          s.params.offset = neg(s.params.offset);
          break;
        case 'square':
        case 'pulse':
          s.params.high = neg(s.params.high);
          s.params.low = neg(s.params.low);
          break;
        case 'dc':
          s.params.level = neg(s.params.level);
          break;
      }
    });
  },

  /** Move signal `id` to position `toIndex` in the display order. */
  reorder(id: string, toIndex: number) {
    commit((d) => {
      const tr = order(d);
      const from = tr.findIndex((t) => t.signalId === id);
      if (from < 0) return;
      const [item] = tr.splice(from, 1);
      tr.splice(Math.max(0, Math.min(tr.length, toIndex)), 0, item!);
    });
  },

  // --- view (not undoable) ---

  setXRange(r: Range) {
    set((s) => ({ view: { ...s.view, xRange: r } }));
  },

  setYRange(panelId: string, r: Range | null) {
    set((s) => ({ view: { ...s.view, yRanges: { ...s.view.yRanges, [panelId]: r } } }));
  },

  resetYRanges() {
    set((s) => ({ view: { ...s.view, yRanges: {} } }));
  },

  fitAll() {
    const visible = orderedSignals(get().project).filter((s) => s.style.visible);
    set({ view: { xRange: fitTimeRange(visible.map(compiled)), yRanges: {} } });
  },

  fitSelected() {
    const sig = findSignal(get().project, get().selectedId);
    if (!sig) return actions.fitAll();
    set((s) => ({ view: { ...s.view, xRange: fitTimeRange([compiled(sig)]) } }));
  },

  clearNotice() {
    set({ notice: null });
  },
};
