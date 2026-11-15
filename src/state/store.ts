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
import { createsCycle, dependents, storedAst } from '../core/model/deps';
import {
  NO_CURSORS,
  type Annotation,
  type Cursors,
  emptyProject,
  type DerivedSignalDef,
  type Figure,
  type GridSettings,
  gridColumns,
  type Panel,
  type GeneratorSignalDef,
  type Project,
  type SavedView,
  type SignalDef,
} from '../core/model/project';
import { ExprError, isLogic, nameToken, parseExpr, print, refsOf, splitAssignment, storedRef, type Node } from '../core/expr/parse';
import type { GeneratorKind } from '../core/model/signal-defs';
import type { Range } from '../core/plot/range';
import { fitTimeRange } from '../core/plot/viewport';
import { rangeOf } from '../core/plot/range';
import { formatSI, siLiteral } from '../core/units/si';
import { buildRectifier, type RectifierConfig } from './rectifier';
import type { SignalSet } from './builder';
import { buildModulation, type ModulationConfig } from './modulation';
import { buildPwm, type PwmConfig } from './pwm';
import type { AxisStyle, StyleOverrides } from '../core/plot/layout';
import { phaseForDifference } from '../core/signals/phase';
import { snapPoints, zeroCrossings } from '../core/snap/points';
import { compiled } from './compiled';

export const HISTORY_LIMIT = 200;
/** Consecutive edits with the same key within this time form one undo step. */
export const COALESCE_MS = 800;

export interface ViewState {
  xRange: Range;
  yRanges: Record<string, Range | null>;
  cursors: Cursors;
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
  /** View of the active figure. */
  view: ViewState;
  /** Figure shown in the plot (tabs). */
  activeFigureId: string;
  /** Saved views of the other figures (zoom and cursors are per figure). */
  views: Record<string, ViewState>;
  /** Show all figures as a grid. */
  gridView: boolean;
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
  exponential: 'Exponential',
  damped: 'Damped sine',
  piecewise: 'Piecewise',
  bits: 'Bits',
  chirp: 'Chirp',
  noise: 'Noise',
  prbs: 'PRBS',
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
    view: { xRange: [0, 0.04], yRanges: {}, cursors: NO_CURSORS },
    activeFigureId: project.figures[0]!.id,
    views: {},
    gridView: false,
    notice: null,
  };
}

export const editor = createStore<EditorState>(() => initialState());

export function useEditor<T>(selector: (s: EditorState) => T): T {
  return useStore(editor, selector);
}

export const isDirty = (s: EditorState) => s.project !== s.savedProject;

/** The figure shown in the plot (re-renders when it or the selection of figures changes). */
export function useActiveFigure(): Figure {
  return useStore(editor, (s) => s.project.figures.find((f) => f.id === s.activeFigureId) ?? s.project.figures[0]!);
}
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

/** The figure shown in the plot (falls back to the first one). */
export function activeFigure<P extends Project | Draft<Project>>(p: P, id = get().activeFigureId): P['figures'][number] {
  return (p.figures.find((f) => f.id === id) ?? p.figures[0]!) as P['figures'][number];
}

/** Group that receives new signals: the selected signal's group, else the last group. */
function targetGroup(fig: Draft<Figure>) {
  const sel = get().selectedId;
  return fig.panels.find((g) => g.traces.some((t) => t.signalId === sel)) ?? fig.panels[fig.panels.length - 1]!;
}

/** Signals of a figure in display order (groups in order, then their members). */
export function orderedSignals(p: Project, figId?: string): SignalDef[] {
  const byId = new Map(p.signals.map((s) => [s.id, s]));
  return activeFigure(p, figId ?? get().activeFigureId)
    .panels.flatMap((g) => g.traces)
    .map((t) => byId.get(t.signalId))
    .filter((s): s is SignalDef => s !== undefined);
}

/** Groups of a figure with their (existing) signals. */
export function figureGroups(p: Project, figId?: string): Array<{ group: Panel; signals: SignalDef[] }> {
  const byId = new Map(p.signals.map((s) => [s.id, s]));
  return activeFigure(p, figId ?? get().activeFigureId).panels.map((group) => ({
    group,
    signals: group.traces.map((t) => byId.get(t.signalId)).filter((s): s is SignalDef => s !== undefined),
  }));
}

function groupName(fig: Figure | Draft<Figure>): string {
  const names = new Set(fig.panels.map((g) => g.name));
  for (let i = 1; ; i++) if (!names.has(`Group ${i}`)) return `Group ${i}`;
}

function defaultView(p: Project, figId: string): ViewState {
  const visible = orderedSignals(p, figId).filter((s) => s.style.visible);
  return { xRange: visible.length ? fitTimeRange(visible.map((s) => compiled(s, p))) : [0, 0.04], yRanges: {}, cursors: NO_CURSORS };
}

export function findSignal(p: Project, id: string | null): SignalDef | undefined {
  return id ? p.signals.find((s) => s.id === id) : undefined;
}

/**
 * Why `name` cannot be used for signal `id` (null if it can): names must be non-empty,
 * unique (expressions refer to signals by name) and free of “]” (names are written in
 * brackets inside expressions).
 */
export function signalNameError(p: Project, id: string, name: string): string | null {
  const n = name.trim();
  if (!n) return 'A signal name cannot be empty.';
  if (n.includes(']')) return 'Signal names cannot contain “]”.';
  if (p.signals.some((s) => s.id !== id && s.name === n)) return `Another signal is already called “${n}”.`;
  return null;
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

/** After undo/redo the active figure may no longer exist: fall back to the first one. */
function validFigure(p: Project, s: EditorState): Partial<EditorState> {
  if (p.figures.some((f) => f.id === s.activeFigureId)) return {};
  const id = p.figures[0]!.id;
  return { activeFigureId: id, view: s.views[id] ?? defaultView(p, id) };
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
  // Keys starting with "drag:" belong to one pointer gesture and always merge.
  const merge =
    key !== undefined &&
    s.lastEdit?.key === key &&
    (key.startsWith('drag:') || now - s.lastEdit.at < COALESCE_MS);
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

export type AlignKind = 'rise' | 'fall' | 'max' | 'min' | 'zero-up';

export const ALIGN_LABELS: Record<AlignKind, string> = {
  rise: 'rising edges',
  fall: 'falling edges',
  max: 'positive peaks',
  min: 'negative peaks',
  'zero-up': 'rising zero crossings',
};

function alignPoints(s: ReturnType<typeof compiled>, kind: AlignKind, t0: number, t1: number): number[] {
  if (kind === 'zero-up') return zeroCrossings(s, t0, t1).filter((z) => z.rising).map((z) => z.t);
  const pts = snapPoints(s, t0, t1, { edges: true, zeros: false, peaks: true, cycles: false });
  const label = { rise: 'Rising edge', fall: 'Falling edge', max: 'Positive peak', min: 'Negative peak' }[kind];
  return pts.filter((p) => p.label === label).map((p) => p.t);
}

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
      ...validFigure(prev, s),
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
      ...validFigure(next, s),
    });
  },

  newProject() {
    set(initialState());
  },

  /** Replace the whole document (Open) — clears history; restores the saved view if any. */
  loadProject(project: Project, view?: SavedView) {
    set(initialState(project));
    const toView = (v: { xRange: [number, number]; yRanges: Record<string, [number, number]>; cursors?: Cursors }): ViewState => ({
      xRange: v.xRange,
      yRanges: { ...v.yRanges },
      cursors: v.cursors ?? NO_CURSORS,
    });
    const active = view?.activeFigure && project.figures.some((f) => f.id === view.activeFigure) ? view.activeFigure : project.figures[0]!.id;
    const views: Record<string, ViewState> = {};
    for (const [id, v] of Object.entries(view?.byFigure ?? {})) if (id !== active) views[id] = toView(v);
    set({ activeFigureId: active, views, gridView: !!view?.gridView && project.figures.length > 1 });
    if (view) set({ view: toView(view) });
    else actions.fitAll();
  },

  /** Current view in the serializable form stored in project files. */
  savedView(): SavedView {
    const v = get().view;
    const yRanges: Record<string, [number, number]> = {};
    for (const [k, r] of Object.entries(v.yRanges)) if (r) yRanges[k] = [r[0], r[1]];
    const pack = (w: ViewState) => {
      const yr: Record<string, [number, number]> = {};
      for (const [k, r] of Object.entries(w.yRanges)) if (r) yr[k] = [r[0], r[1]];
      const c = w.cursors;
      const any = c.t.some((x) => x !== null) || c.y.some((x) => x !== null) || c.target !== null;
      return { xRange: [w.xRange[0], w.xRange[1]] as [number, number], yRanges: yr, ...(any ? { cursors: c } : {}) };
    };
    const st = get();
    const others = Object.entries(st.views).filter(([id]) => id !== st.activeFigureId && st.project.figures.some((f) => f.id === id));
    return {
      ...pack(v),
      yRanges,
      ...(st.project.figures.length > 1 ? { activeFigure: st.activeFigureId } : {}),
      ...(st.gridView && st.project.figures.length > 1 ? { gridView: true } : {}),
      ...(others.length ? { byFigure: Object.fromEntries(others.map(([id, w]) => [id, pack(w)])) } : {}),
    };
  },

  setStylePreset(id: string) {
    commit((d) => {
      activeFigure(d).stylePreset = id;
    });
  },

  /** Merge style overrides (undefined values remove an override). */
  setStyle(patch: StyleOverrides, key?: string) {
    commit((d) => {
      const fig = activeFigure(d);
      const next: Record<string, unknown> = { ...(fig.style ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
      fig.style = next as StyleOverrides;
    }, key);
  },

  resetStyle() {
    commit((d) => {
      delete activeFigure(d).style;
    });
  },

  /** Add an annotation to the active figure; returns its id. */
  addAnnotation(a: Omit<Annotation, 'id'>): string {
    const id = newId('a');
    commit((d) => {
      const fig = activeFigure(d);
      (fig.annotations ??= []).push({ ...a, id });
    });
    return id;
  },

  /** Change an annotation of the active figure (drags coalesce with a `drag:` key). */
  updateAnnotation(id: string, patch: Partial<Omit<Annotation, 'id'>>, key?: string) {
    commit((d) => {
      const a = activeFigure(d).annotations?.find((x) => x.id === id);
      if (a) Object.assign(a, patch);
    }, key);
  },

  deleteAnnotation(id: string) {
    commit((d) => {
      const fig = activeFigure(d);
      fig.annotations = (fig.annotations ?? []).filter((x) => x.id !== id);
    });
  },

  /**
   * Dimension marker from the cursors: Δt between time cursors 1–2 (drawn at 85 % of the
   * measured signal's range), or ΔV between level cursors A–B (at time cursor 1 or the view centre).
   */
  dimensionFromCursors(kind: 'dim-t' | 'dim-y', yLevel: number): string | null {
    const st = get();
    const c = st.view.cursors;
    const on = c.target ?? st.selectedId ?? null;
    if (kind === 'dim-t') {
      const [t0, t1] = c.t;
      if (t0 == null || t1 == null) return null;
      return actions.addAnnotation({ kind, on, t0, t1, y0: yLevel, y1: yLevel, text: '', color: '#1c2330' });
    }
    const [y0, y1] = c.y;
    if (y0 == null || y1 == null) return null;
    const t = c.t[0] ?? (st.view.xRange[0] + st.view.xRange[1]) / 2;
    return actions.addAnnotation({ kind, on, t0: t, t1: t, y0, y1, text: '', color: '#1c2330' });
  },

  /** Merge axis options for the time axis ('x') or a panel id. */
  setAxisStyle(axis: string, patch: AxisStyle) {
    commit((d) => {
      const fig = activeFigure(d);
      const axes = (fig.axes ??= {});
      if (axis === 'x') axes.x = { ...(axes.x ?? {}), ...patch };
      else {
        axes.y ??= {};
        axes.y[axis] = { ...(axes.y[axis] ?? {}), ...patch };
      }
    });
  },

  setShowLegend(show: boolean) {
    commit((d) => {
      activeFigure(d).showLegend = show;
    });
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
      activeFigure(d).mode = mode;
    });
  },

  select(id: string | null) {
    set({ selectedId: id, notice: null });
  },

  /** Add a generator signal; `customize` adjusts the definition (presets) in the same undo step. */
  addSignal(kind: GeneratorKind, customize?: (def: GeneratorSignalDef) => void, name?: string) {
    const p = get().project;
    const first = p.signals.length === 0;
    const def: GeneratorSignalDef = {
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
      targetGroup(activeFigure(d)).traces.push({ signalId: def.id });
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
      const fig = activeFigure(d);
      const g = fig.panels.find((x) => x.traces.some((t) => t.signalId === afterId)) ?? fig.panels[fig.panels.length - 1]!;
      const idx = afterId ? g.traces.findIndex((t) => t.signalId === afterId) : -1;
      g.traces.splice(idx >= 0 ? idx + 1 : g.traces.length, 0, { signalId: copy.id });
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
    const users = dependents(p, sig.id);
    if (users.length > 0) {
      notify(`“${sig.name}” is used by ${users.map((u) => `“${u.name}”`).join(', ')} — delete or edit those first.`);
      return;
    }
    const ord = orderedSignals(p);
    const idx = ord.findIndex((s) => s.id === sig.id);
    commit((d) => {
      d.signals = d.signals.filter((s) => s.id !== sig.id);
      for (const fig of d.figures) for (const panel of fig.panels) panel.traces = panel.traces.filter((t) => t.signalId !== sig.id);
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
    const target = findSignal(get().project, id);
    if (target?.kind === 'derived') {
      const ast = storedAst(target.expr);
      if (!ast) return;
      actions.updateSignal(id, (s) => {
        if (s.kind !== 'derived') return;
        if (isLogic(ast)) [s.logicHigh, s.logicLow] = [s.logicLow, s.logicHigh];
        else s.expr = print({ k: 'neg', a: ast }, storedRef);
      });
      return;
    }
    actions.updateGenerator(id, (s) => {
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
        case 'exponential':
          s.params.initial = neg(s.params.initial);
          s.params.final = neg(s.params.final);
          break;
        case 'damped':
          s.params.amplitude = neg(s.params.amplitude);
          s.params.offset = neg(s.params.offset);
          break;
        case 'piecewise':
          s.params.points = s.params.points.map(([t, y]) => [t, neg(y)]);
          break;
        case 'bits':
        case 'prbs':
          s.params.high = neg(s.params.high);
          s.params.low = neg(s.params.low);
          break;
        case 'chirp':
          s.params.amplitude = neg(s.params.amplitude);
          s.params.offset = neg(s.params.offset);
          break;
        case 'noise':
          s.params.mean = neg(s.params.mean);
          s.params.rms = neg(s.params.rms); // negative σ = every sample inverted
          break;
      }
    });
  },

  /** Move signal `id` to position `toIndex` in the display order. */
  reorder(id: string, toIndex: number) {
    // Position in the flattened display order; the signal joins the group found there.
    const fig = activeFigure(get().project);
    const flat = fig.panels.flatMap((g) => g.traces.map((t) => ({ g: g.id, id: t.signalId }))).filter((x) => x.id !== id);
    const at = flat[Math.max(0, Math.min(flat.length, toIndex))];
    if (at) {
      const g = fig.panels.find((x) => x.id === at.g)!;
      actions.moveSignal(id, at.g, g.traces.filter((t) => t.signalId !== id).findIndex((t) => t.signalId === at.id));
    } else {
      const last = fig.panels[fig.panels.length - 1]!;
      actions.moveSignal(id, last.id, last.traces.filter((t) => t.signalId !== id).length);
    }
  },

  /** Move a signal into group `groupId` at `index` (within the active figure). */
  moveSignal(id: string, groupId: string, index: number) {
    commit((d) => {
      const fig = activeFigure(d);
      const target = fig.panels.find((g) => g.id === groupId);
      if (!target) return;
      for (const g of fig.panels) g.traces = g.traces.filter((t) => t.signalId !== id);
      target.traces.splice(Math.max(0, Math.min(target.traces.length, index)), 0, { signalId: id });
    });
  },

  // --- groups (active figure) ---

  /** New group at the end; the selected signal (if any) moves into it. */
  addGroup(): string {
    const id = newId('g');
    const sel = get().selectedId;
    commit((d) => {
      const fig = activeFigure(d);
      if (fig.panels.length === 1 && !fig.panels[0]!.name) fig.panels[0]!.name = 'Signals';
      const g: Panel = { id, name: groupName(fig), traces: [], yAxis: { auto: true, min: -1, max: 1, title: '' } };
      if (sel && fig.panels.some((x) => x.traces.some((t) => t.signalId === sel))) {
        for (const x of fig.panels) x.traces = x.traces.filter((t) => t.signalId !== sel);
        g.traces.push({ signalId: sel });
      }
      fig.panels.push(g);
    });
    return id;
  },

  updateGroup(id: string, patch: Partial<Pick<Panel, 'name' | 'share' | 'collapsed'>>) {
    commit((d) => {
      const g = activeFigure(d).panels.find((x) => x.id === id);
      if (g) Object.assign(g, patch);
    });
  },

  /** Show/hide or lock/unlock every signal of a group. */
  setGroupSignals(id: string, patch: { visible?: boolean; locked?: boolean }) {
    const g = activeFigure(get().project).panels.find((x) => x.id === id);
    if (!g) return;
    const ids = new Set(g.traces.map((t) => t.signalId));
    commit((d) => {
      for (const s of d.signals) {
        if (!ids.has(s.id)) continue;
        if (patch.visible !== undefined) s.style.visible = patch.visible;
        if (patch.locked !== undefined) s.locked = patch.locked;
      }
    });
  },

  moveGroup(id: string, dir: -1 | 1) {
    commit((d) => {
      const panels = activeFigure(d).panels;
      const i = panels.findIndex((g) => g.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= panels.length) return;
      [panels[i], panels[j]] = [panels[j]!, panels[i]!];
    });
  },

  /** Delete a group; its signals move to the neighbouring group (the last group cannot be deleted). */
  deleteGroup(id: string) {
    commit((d) => {
      const panels = activeFigure(d).panels;
      if (panels.length <= 1) return;
      const i = panels.findIndex((g) => g.id === id);
      if (i < 0) return;
      const into = panels[i > 0 ? i - 1 : 1]!;
      into.traces.push(...panels[i]!.traces);
      panels.splice(i, 1);
    });
  },

  // --- figures ---

  switchFigure(id: string) {
    const st = get();
    if (id === st.activeFigureId || !st.project.figures.some((f) => f.id === id)) return;
    const views = { ...st.views, [st.activeFigureId]: st.view };
    set({ activeFigureId: id, views, view: views[id] ?? defaultView(st.project, id), notice: null });
  },

  addFigure(): string {
    const id = newId('f');
    const cur = activeFigure(get().project);
    commit((d) => {
      const names = new Set(d.figures.map((f) => f.name));
      let n = d.figures.length + 1;
      while (names.has(`Figure ${n}`)) n++;
      d.figures.push({
        id,
        name: `Figure ${n}`,
        mode: cur.mode,
        panels: [{ id: newId('g'), traces: [], yAxis: { auto: true, min: -1, max: 1, title: '' } }],
        xAxis: { auto: true, min: 0, max: 0.04, title: 'Time' },
        stylePreset: cur.stylePreset,
        showLegend: true,
        ...(cur.style ? { style: structuredClone(cur.style) } : {}),
      });
    });
    actions.switchFigure(id);
    return id;
  },

  duplicateFigure(id = get().activeFigureId): string {
    const src = activeFigure(get().project, id);
    const nid = newId('f');
    commit((d) => {
      const copy = structuredClone(src) as Figure;
      copy.id = nid;
      copy.name = `${src.name} copy`;
      // New group ids; per-panel axis settings keyed by group panels follow them.
      const ren = new Map<string, string>();
      for (const g of copy.panels) {
        const ng = newId('g');
        ren.set(g.id, ng);
        g.id = ng;
      }
      if (copy.axes?.y) {
        copy.axes.y = Object.fromEntries(
          Object.entries(copy.axes.y).map(([k, v]) => [k.startsWith('group-') ? `group-${ren.get(k.slice(6)) ?? k.slice(6)}` : k, v]),
        );
      }
      d.figures.splice(d.figures.findIndex((f) => f.id === id) + 1, 0, copy);
    });
    const st = get();
    const v = id === st.activeFigureId ? st.view : st.views[id];
    if (v) set({ views: { ...st.views, [nid]: structuredClone(v) } });
    actions.switchFigure(nid);
    return nid;
  },

  renameFigure(id: string, name: string) {
    commit((d) => {
      const f = d.figures.find((x) => x.id === id);
      if (f) f.name = name.trim() || f.name;
    });
  },

  deleteFigure(id: string) {
    const st = get();
    if (st.project.figures.length <= 1) return notify('A project needs at least one figure.');
    const idx = st.project.figures.findIndex((f) => f.id === id);
    if (id === st.activeFigureId) {
      const next = st.project.figures[idx > 0 ? idx - 1 : 1]!;
      actions.switchFigure(next.id);
    }
    commit((d) => {
      d.figures = d.figures.filter((f) => f.id !== id);
    });
  },

  /** Create a PWM signal set (carrier, references, gates, voltages) as new groups, in one undo step. */
  createPwm(config: PwmConfig): void {
    actions.addSignalSet(buildPwm(config, newId, get().project.signals.length), Math.min(2 / config.f1, 1));
  },

  /** Create a rectifier / phase-control signal set as new groups, in one undo step. */
  createRectifier(config: RectifierConfig): void {
    actions.addSignalSet(buildRectifier(config, newId, get().project.signals.length), Math.min(2 / config.f, 1));
  },

  /** Create an AM / DSB-SC / FM / PM signal set as new groups, in one undo step. */
  createModulation(config: ModulationConfig): void {
    actions.addSignalSet(buildModulation(config, newId, get().project.signals.length), Math.min(2 / config.fm, 1));
  },

  /** Add a built set of signals and groups to the active figure (stacked), in one undo step. */
  addSignalSet(built: SignalSet, span: number): void {
    const p = get().project;
    // Unique names: a set may be created several times.
    const names = new Set(p.signals.map((s) => s.name));
    for (const sig of built.signals) {
      let n = sig.name;
      for (let i = 2; names.has(n); i++) n = `${sig.name} ${i}`;
      sig.name = n;
      names.add(n);
    }
    commit((d) => {
      d.signals.push(...built.signals);
      const fig = activeFigure(d);
      // Replace an empty default group, otherwise append.
      if (fig.panels.length === 1 && fig.panels[0]!.traces.length === 0) fig.panels = built.groups;
      else fig.panels.push(...built.groups);
      fig.mode = 'stacked';
    });
    set({ selectedId: built.signals[built.signals.length - 1]!.id });
    actions.setXRange([0, span]);
  },

  /** Three sines 120° apart (same frequency/amplitude as the selection if it is a sine) in a shared group. */
  addThreePhaseSet(): void {
    const p = get().project;
    const sel = findSignal(p, get().selectedId);
    const base = sel && sel.kind === 'generator' && (sel.generator === 'sine' || sel.generator === 'cosine') ? sel : null;
    const f = base?.timing.frequency ?? 50;
    const amp = base && 'amplitude' in base.params ? base.params.amplitude : 1;
    const unit = base?.unit ?? 'V';
    const gid = newId('g');
    const sigs: GeneratorSignalDef[] = [0, -120, 120].map((ph, i) => {
      const d: GeneratorSignalDef = {
        id: newId(),
        name: uniqueName(p, `${['V_a', 'V_b', 'V_c'][i]}`),
        unit,
        locked: false,
        style: { color: ['#0072B2', '#D55E00', '#009E73'][i]!, lineWidth: 1.6, dash: 'solid', visible: true, showInLegend: true },
        kind: 'generator',
        ...defaultGenerator('sine'),
      };
      d.timing.frequency = f;
      d.timing.phaseDeg = ph;
      if (d.generator === 'sine') d.params.amplitude = amp;
      return d;
    });
    commit((d) => {
      d.signals.push(...sigs);
      const fig = activeFigure(d);
      const g: Panel = { id: gid, name: groupName(fig).replace('Group', 'Three-phase'), share: true, traces: sigs.map((x) => ({ signalId: x.id })), yAxis: { auto: true, min: -1, max: 1, title: '' } };
      if (fig.panels.length === 1 && fig.panels[0]!.traces.length === 0) fig.panels = [g];
      else fig.panels.push(g);
    });
    set({ selectedId: sigs[0]!.id });
    if (p.signals.length === 0) actions.fitAll();
  },

  /** Complementary pair with dead time from the selected (logic) signal. */
  addComplementaryPair(td?: number): void {
    const p = get().project;
    const sel = findSignal(p, get().selectedId);
    if (!sel) return notify('Select the gate (logic) signal to complement first.');
    const period = compiled(sel, p).period;
    const dt = td ?? (period ? period / 100 : 1e-6);
    const lit = siLiteral(dt);
    const g = `#{${sel.id}}`;
    const mk = (suffix: string, expr: string): DerivedSignalDef => ({
      id: newId('d'),
      name: uniqueName(p, `${sel.name}${suffix}`),
      unit: sel.unit,
      locked: false,
      style: { color: nextColor(p), lineWidth: 1.6, dash: 'solid', visible: true, showInLegend: true },
      kind: 'derived',
      expr,
      logicHigh: 1,
      logicLow: 0,
      threshold: 0.5,
      resolution: null,
    });
    const hi = mk(' high', `and(${g}, delay(${g}, ${lit}))`);
    const lo = mk(' low', `and(!${g}, delay(!${g}, ${lit}))`);
    lo.style.color = paletteColor((p.signals.length + 1) % 8);
    commit((d) => {
      d.signals.push(hi, lo);
      const grp = targetGroup(activeFigure(d));
      grp.traces.push({ signalId: hi.id }, { signalId: lo.id });
    });
    set({ selectedId: hi.id });
    notify(`Complementary pair with ${formatSI(dt, 's')} dead time: edit the delay in the expressions.`);
  },

  /** Show an existing project signal in the active figure. */
  addToFigure(signalId: string) {
    commit((d) => {
      const fig = activeFigure(d);
      if (fig.panels.some((g) => g.traces.some((t) => t.signalId === signalId))) return;
      fig.panels[fig.panels.length - 1]!.traces.push({ signalId });
    });
    set({ selectedId: signalId });
  },

  /** Remove a signal from the active figure only (it stays in the project). */
  removeFromFigure(signalId: string) {
    commit((d) => {
      for (const g of activeFigure(d).panels) g.traces = g.traces.filter((t) => t.signalId !== signalId);
    });
    if (get().selectedId === signalId) set({ selectedId: null });
  },

  /** Set a signal's position on the timeline. Use one `key` per drag gesture. */
  setDelay(id: string, delay: number, key?: string) {
    actions.updateGenerator(id, (s) => void (s.timing.delay = delay), key);
  },

  /** Edit a generator signal (no-op for derived signals). */
  updateGenerator(id: string, recipe: (s: Draft<GeneratorSignalDef>) => void, key?: string) {
    actions.updateSignal(
      id,
      (s) => {
        if (s.kind === 'generator') recipe(s);
      },
      key,
    );
  },

  /**
   * Create a derived signal from a template applied to the selected signal (A) and,
   * for binary operations, the next visible signal (B). Returns the new id or null.
   */
  addDerived(
    template: (a: string, b: string, ctx: { periodA?: number }) => string,
    arity: 1 | 2,
    name: string,
    unitOf?: (inputUnit: string) => string,
  ): string | null {
    const p = get().project;
    const ordered = orderedSignals(p);
    const a = findSignal(p, get().selectedId) ?? ordered[0];
    if (!a) {
      notify('Add a waveform first: operations work on existing signals.');
      return null;
    }
    let b: SignalDef | undefined;
    if (arity === 2) {
      const idx = ordered.findIndex((s) => s.id === a.id);
      const rest = [...ordered.slice(idx + 1), ...ordered.slice(0, idx)].filter((s) => s.id !== a.id);
      b = rest.find((s) => s.style.visible) ?? rest[0];
      if (!b) {
        notify('This operation needs two signals. Add another waveform first.');
        return null;
      }
    }
    const expr = template(`#{${a.id}}`, b ? `#{${b.id}}` : '', { periodA: compiled(a, p).period });
    const ast = storedAst(expr);
    const def: DerivedSignalDef = {
      id: newId('d'),
      name: uniqueName(p, name),
      unit: unitOf ? unitOf(a.unit) : ast && isLogic(ast) ? 'V' : a.unit,
      locked: false,
      style: { color: nextColor(p), lineWidth: 1.6, dash: 'solid', visible: true, showInLegend: true },
      kind: 'derived',
      expr,
      logicHigh: 1,
      logicLow: 0,
      threshold: 0.5,
      resolution: null,
    };
    commit((d) => {
      d.signals.push(def);
      targetGroup(activeFigure(d)).traces.push({ signalId: def.id });
    });
    set({ selectedId: def.id });
    return def.id;
  },

  /** Rename a signal; refused (with a notice) if the name is empty, taken or contains “]”. */
  renameSignal(id: string, name: string): boolean {
    const p = get().project;
    const err = signalNameError(p, id, name);
    if (err) {
      editor.setState({ notice: err });
      return false;
    }
    actions.updateSignal(id, (d) => void (d.name = name.trim()));
    return true;
  },

  /**
   * Set a derived signal's expression from display text ("Name = expr" allowed).
   * Returns an error (message + position) or null on success.
   */
  setExpression(id: string, text: string): { message: string; pos: number } | null {
    const p = get().project;
    const sig = findSignal(p, id);
    if (!sig || sig.kind !== 'derived') return { message: 'Not an expression signal.', pos: 0 };
    if (sig.locked) return { message: 'Signal is locked.', pos: 0 };
    const { name, expr } = splitAssignment(text);
    const offset = text.length - expr.length;
    let ast;
    try {
      ast = parseExpr(expr, (n) => resolveName(p, n, id));
    } catch (e) {
      if (e instanceof ExprError) return { message: e.message, pos: e.pos + offset };
      throw e;
    }
    const refs = refsOf(ast);
    if (refs.has(id)) return { message: 'A signal cannot use itself.', pos: offset };
    if (createsCycle(p, id, refs)) return { message: 'This would create a circular dependency.', pos: offset };
    const stored = print(ast, storedRef);
    const newName = name?.trim();
    if (newName) {
      const err = signalNameError(p, id, newName);
      if (err) return { message: err, pos: 0 };
    }
    actions.updateSignal(id, (s) => {
      if (s.kind !== 'derived') return;
      s.expr = stored;
      if (newName) s.name = newName;
    });
    return null;
  },

  /**
   * Shift signal `id` (via its delay) so that one of its features coincides with the
   * nearest feature of the same kind on `refId`. Returns a status message.
   */
  alignFeature(id: string, refId: string, kind: AlignKind): string {
    const p = get().project;
    const sig = findSignal(p, id);
    const ref = findSignal(p, refId);
    if (!sig || !ref) return 'Select a signal and a reference.';
    if (sig.kind !== 'generator') return 'Derived signals follow their inputs; use delay() to shift them.';
    const s = compiled(sig, p);
    const r = compiled(ref, p);
    const [v0, v1] = get().view.xRange;
    const span = Math.max(v1 - v0, s.period ?? 0, r.period ?? 0);
    const mine = alignPoints(s, kind, v0 - span, v1 + span);
    if (mine.length === 0) return `“${sig.name}” has no ${ALIGN_LABELS[kind]} near the view.`;
    // Use the signal's matching feature closest to the middle of the view.
    const mid = (v0 + v1) / 2;
    const a = mine.reduce((x, y) => (Math.abs(y - mid) < Math.abs(x - mid) ? y : x));
    const reach = Math.max(span, (r.period ?? 0) * 1.01);
    const theirs = alignPoints(r, kind, a - reach, a + reach);
    if (theirs.length === 0) return `“${ref.name}” has no ${ALIGN_LABELS[kind]} near the view.`;
    const b = theirs.reduce((x, y) => (Math.abs(y - a) < Math.abs(x - a) ? y : x));
    if (b === a) return 'Already aligned.';
    actions.setDelay(id, sig.timing.delay + (b - a));
    return `Aligned ${ALIGN_LABELS[kind]} of “${sig.name}” to “${ref.name}”.`;
  },

  /** Set the phase parameter of `id` so it leads `refId` by `deg` (fundamental phase). */
  setPhaseDifference(id: string, refId: string, deg: number): string {
    const p = get().project;
    const sig = findSignal(p, id);
    const ref = findSignal(p, refId);
    if (!sig || !ref) return 'Select a signal and a reference.';
    if (sig.kind !== 'generator' || ref.kind !== 'generator') return 'Phase difference is defined between generator signals.';
    const phase = phaseForDifference(sig, ref, deg);
    if (phase === null) return 'Phase difference needs two periodic signals with the same frequency.';
    actions.updateGenerator(id, (s) => void (s.timing.phaseDeg = Number(phase.toPrecision(12))));
    return `“${sig.name}” now leads “${ref.name}” by ${deg}°.`;
  },

  // --- view (not undoable) ---

  setXRange(r: Range) {
    const st = get();
    set({ view: { ...st.view, xRange: r } });
    // Grid view with linked time axes: apply the same range to the linked figures.
    const link = st.project.grid?.link ?? 'none';
    if (!st.gridView || link === 'none') return;
    const figs = st.project.figures;
    const cols = gridColumns(figs.length, st.project.grid);
    const ai = figs.findIndex((f) => f.id === st.activeFigureId);
    const views = { ...st.views };
    figs.forEach((f, i) => {
      if (f.id === st.activeFigureId) return;
      if (link === 'columns' && i % cols !== ai % cols) return;
      views[f.id] = { ...(views[f.id] ?? defaultView(st.project, f.id)), xRange: r };
    });
    set({ views });
  },

  setGridView(on: boolean) {
    set({ gridView: on });
  },

  setGrid(patch: Partial<GridSettings>) {
    commit((d) => {
      d.grid = { columns: null, link: 'none', ...(d.grid ?? {}), ...patch };
    });
  },

  setYRange(panelId: string, r: Range | null) {
    set((s) => ({ view: { ...s.view, yRanges: { ...s.view.yRanges, [panelId]: r } } }));
  },

  resetYRanges() {
    set((s) => ({ view: { ...s.view, yRanges: {} } }));
  },

  fitAll() {
    const p = get().project;
    const visible = orderedSignals(p).filter((s) => s.style.visible);
    set((st) => ({ view: { ...st.view, xRange: fitTimeRange(visible.map((s) => compiled(s, p))), yRanges: {} } }));
  },

  fitSelected() {
    const sig = findSignal(get().project, get().selectedId);
    if (!sig) return actions.fitAll();
    set((s) => ({ view: { ...s.view, xRange: fitTimeRange([compiled(sig, s.project)]) } }));
  },

  // --- measurement cursors (view state: saved in files, not undoable) ---

  /** Signal measured by the cursors: the pinned target, else the selection, else the first visible. */
  measureTarget(): SignalDef | undefined {
    const st = get();
    const visible = orderedSignals(st.project).filter((s) => s.style.visible);
    return (
      findSignal(st.project, st.view.cursors.target) ??
      visible.find((s) => s.id === st.selectedId) ??
      visible[0]
    );
  },

  setCursors(patch: Partial<Cursors>) {
    set((st) => ({ view: { ...st.view, cursors: { ...st.view.cursors, ...patch } } }));
  },

  setCursor(kind: 't' | 'y', index: 0 | 1, value: number | null) {
    const c = get().view.cursors;
    const arr: [number | null, number | null] = [...c[kind]];
    arr[index] = value;
    actions.setCursors({ [kind]: arr });
  },

  /** Show both time cursors at 1/3 and 2/3 of the view, or hide them. */
  toggleTimeCursors() {
    const { cursors, xRange } = get().view;
    if (cursors.t.some((x) => x !== null)) return actions.setCursors({ t: [null, null] });
    const [a, b] = xRange;
    actions.setCursors({ t: [a + (b - a) / 3, a + (2 * (b - a)) / 3] });
  },

  /** Show both level cursors inside the target's range, or hide them. */
  toggleLevelCursors() {
    const st = get();
    if (st.view.cursors.y.some((x) => x !== null)) return actions.setCursors({ y: [null, null] });
    const target = actions.measureTarget();
    if (!target) return notify('Add a signal first.');
    const r = rangeOf(compiled(target, st.project), st.view.xRange[0], st.view.xRange[1]) ?? [-1, 1];
    const [lo, hi] = r[1] > r[0] ? r : [r[0] - 1, r[0] + 1];
    actions.setCursors({ y: [lo + (hi - lo) * 0.25, lo + (hi - lo) * 0.75] });
  },

  clearNotice() {
    set({ notice: null });
  },
};

/** Resolve a display name in an expression to a signal id (exact name match). */
export function resolveName(p: Project, name: string, _self?: string): string | null {
  return p.signals.find((s) => s.name === name)?.id ?? null;
}

/** Display text of a stored expression, using current signal names. */
export function exprToDisplay(p: Project, stored: string): string {
  const ast = storedAst(stored);
  return ast ? astToDisplay(p, ast) : stored;
}

/** Display text of an expression tree, using current signal names. */
export function astToDisplay(p: Project, ast: Node): string {
  return print(ast, (id) => {
    const s = p.signals.find((x) => x.id === id);
    return s ? nameToken(s.name) : '[missing signal]';
  });
}

/** View of any figure: the live view for the active one, the saved (or default) view otherwise. */
export function viewOf(st: EditorState, figId: string): ViewState {
  return figId === st.activeFigureId ? st.view : (st.views[figId] ?? defaultView(st.project, figId));
}
