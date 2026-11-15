/**
 * Native project format (.wlab): human-readable JSON holding the mathematical
 * definitions (never rendered samples), figure configuration, styling and view.
 *
 *   { "format": "wavelab-project", "schemaVersion": 1, "appVersion": "…",
 *     "savedAt": "…", "project": { …Project… }, "view": { …SavedView… } }
 *
 * Reading validates every field and reports the path of the first problem
 * (e.g. "signals[2].timing.frequency must be a positive number"). Files from a
 * newer schema are refused; older schemas pass through `migrate`.
 */

import {
  autoAxis,
  SCHEMA_VERSION,
  type Annotation,
  type Figure,
  type LineDash,
  type Project,
  type SavedView,
  type SignalDef,
  type SignalStyle,
} from '../model/project';
import { isPeriodicKind, type GeneratorKind, type SignalWindow, type Timing } from '../model/signal-defs';
import { createsCycle, directDeps } from '../model/deps';
import type { AxisStyle, StyleOverrides } from '../plot/layout';
import { ExprError, parseExpr } from '../expr/parse';

export const FORMAT_ID = 'wavelab-project';

export class ProjectFileError extends Error {}

export function serializeProject(project: Project, view?: SavedView): string {
  const file = {
    format: FORMAT_ID,
    schemaVersion: SCHEMA_VERSION,
    appVersion: __APP_VERSION__,
    savedAt: new Date().toISOString(),
    project: { ...project, schemaVersion: SCHEMA_VERSION, appVersion: __APP_VERSION__ },
    view,
  };
  return JSON.stringify(file, null, 2) + '\n';
}

export function parseProjectFile(text: string): { project: Project; view?: SavedView } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ProjectFileError(`Not a valid JSON file (${(e as Error).message}).`);
  }
  const f = obj(raw, 'file');
  if (f.format !== FORMAT_ID) throw new ProjectFileError('This is not a WaveLab project file.');
  const version = num(f.schemaVersion, 'schemaVersion');
  if (!Number.isInteger(version) || version < 1) throw new ProjectFileError('schemaVersion must be a positive whole number.');
  if (version > SCHEMA_VERSION) {
    throw new ProjectFileError(
      `This project was saved by a newer WaveLab (file format ${version}, this app reads up to ${SCHEMA_VERSION}). Please update the app.`,
    );
  }
  const migrated = migrate(f, version);
  const project = readProject(migrated.project);
  const view = migrated.view === undefined ? undefined : readView(migrated.view, 'view');
  return { project, view };
}

/** Upgrade older file layouts to the current schema. (Schema 1 is the first.) */
function migrate(file: Record<string, unknown>, _from: number): Record<string, unknown> {
  return file;
}

// ---------------------------------------------------------------------------

const GENERATORS: GeneratorKind[] = ['sine', 'cosine', 'square', 'pulse', 'triangle', 'sawtooth', 'dc', 'exponential', 'damped', 'piecewise', 'bits', 'chirp', 'noise', 'prbs'];
const DASHES: LineDash[] = ['solid', 'dashed', 'dotted', 'dashdot'];

function readProject(v: unknown): Project {
  const p = obj(v, 'project');
  const signals = arr(p.signals, 'project.signals').map((s, i) => readSignal(s, `signals[${i}]`));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const s of signals) {
    if (!/^[^\s{}#\[\]]+$/.test(s.id)) throw new ProjectFileError(`Signal id "${s.id}" is invalid (no spaces, braces, brackets or #).`);
    if (ids.has(s.id)) throw new ProjectFileError(`Duplicate signal id "${s.id}".`);
    ids.add(s.id);
    // Names must be unique and may not contain “]” (expressions show names in brackets):
    // repair instead of refusing the file.
    let name = s.name.replace(/\]/g, ')').trim() || 'Signal';
    if (names.has(name)) {
      let k = 2;
      while (names.has(`${name} (${k})`)) k++;
      name = `${name} (${k})`;
    }
    names.add(name);
    s.name = name;
  }
  // Derived signals: every reference must exist and the graph must be acyclic.
  const partial = { signals } as Project;
  signals.forEach((s, i) => {
    for (const ref of directDeps(s)) {
      if (!ids.has(ref)) throw new ProjectFileError(`signals[${i}] (“${s.name}”) uses a signal that is not in the file (id "${ref}").`);
    }
    if (s.kind === 'derived' && createsCycle(partial, s.id, directDeps(s))) {
      throw new ProjectFileError(`signals[${i}] (“${s.name}”) is part of a circular dependency.`);
    }
  });
  const figures = arr(p.figures, 'project.figures').map((f, i) => readFigure(f, `figures[${i}]`, ids));
  if (figures.length === 0) throw new ProjectFileError('project.figures must contain at least one figure.');
  // A signal may appear in any figure; signals shown in none are added to the first figure.
  const listed = new Set(figures.flatMap((f) => f.panels.flatMap((pa) => pa.traces.map((t) => t.signalId))));
  const first = figures[0]!;
  for (const s of signals) if (!listed.has(s.id)) first.panels[first.panels.length - 1]!.traces.push({ signalId: s.id });
  const figIds = new Set<string>();
  for (const f of figures) {
    if (figIds.has(f.id)) throw new ProjectFileError(`Duplicate figure id "${f.id}".`);
    figIds.add(f.id);
  }
  let grid: Project['grid'];
  if (p.grid !== undefined) {
    const g = obj(p.grid, 'project.grid');
    const columns = g.columns === null || g.columns === undefined ? null : Math.round(num(g.columns, 'project.grid.columns'));
    if (columns !== null && (columns < 1 || columns > 12)) throw new ProjectFileError('project.grid.columns must be between 1 and 12.');
    const link = g.link ?? 'none';
    if (link !== 'none' && link !== 'columns' && link !== 'all') throw new ProjectFileError('project.grid.link must be none, columns or all.');
    grid = { columns, link };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    appVersion: __APP_VERSION__,
    name: str(p.name, 'project.name') || 'Untitled',
    signals,
    figures,
    ...(grid ? { grid } : {}),
  };
}

function readSignal(v: unknown, path: string): SignalDef {
  const s = obj(v, path);
  if (s.kind === 'derived') return readDerived(s, path);
  if (s.kind !== 'generator') throw new ProjectFileError(`${path}.kind "${String(s.kind)}" is not supported by this version.`);
  const generator = s.generator as GeneratorKind;
  if (!GENERATORS.includes(generator)) throw new ProjectFileError(`${path}.generator "${String(s.generator)}" is unknown.`);
  const timing = readTiming(s.timing, `${path}.timing`, isPeriodicKind(generator) || generator === 'damped');
  const window = readWindow(s.window, `${path}.window`);
  const pp = obj(s.params, `${path}.params`);
  const n = (k: string) => num(pp[k], `${path}.params.${k}`);
  const nn = (k: string) => nonNeg(pp[k], `${path}.params.${k}`);
  const base = {
    id: str(s.id, `${path}.id`),
    name: str(s.name, `${path}.name`),
    unit: s.unit === undefined ? 'V' : str(s.unit, `${path}.unit`),
    locked: s.locked === undefined ? false : bool(s.locked, `${path}.locked`),
    style: readStyle(s.style, `${path}.style`),
    kind: 'generator' as const,
    timing,
    window,
  };
  if (!base.id) throw new ProjectFileError(`${path}.id must not be empty.`);
  switch (generator) {
    case 'sine':
    case 'cosine':
    case 'triangle':
      return { ...base, generator, params: { amplitude: n('amplitude'), offset: n('offset') } };
    case 'sawtooth': {
      const slope = pp.slope;
      if (slope !== 'rising' && slope !== 'falling') throw new ProjectFileError(`${path}.params.slope must be "rising" or "falling".`);
      return { ...base, generator, params: { amplitude: n('amplitude'), offset: n('offset'), slope } };
    }
    case 'square': {
      const duty = n('duty');
      if (duty < 0 || duty > 1) throw new ProjectFileError(`${path}.params.duty must be between 0 and 1.`);
      return { ...base, generator, params: { high: n('high'), low: n('low'), duty } };
    }
    case 'pulse':
      return {
        ...base,
        generator,
        params: { high: n('high'), low: n('low'), width: nn('width'), rise: nn('rise'), fall: nn('fall') },
      };
    case 'dc':
      return { ...base, generator, params: { level: n('level') } };
    case 'exponential': {
      const tau = time(pp.tau, `${path}.params.tau`);
      if (!(tau > 0)) throw new ProjectFileError(`${path}.params.tau must be positive.`);
      return { ...base, generator, params: { initial: n('initial'), final: n('final'), tau } };
    }
    case 'damped': {
      const tau = time(pp.tau, `${path}.params.tau`);
      if (!(tau > 0)) throw new ProjectFileError(`${path}.params.tau must be positive.`);
      return { ...base, generator, params: { amplitude: n('amplitude'), offset: n('offset'), tau } };
    }
    case 'piecewise': {
      const raw = arr(pp.points, `${path}.params.points`);
      const points = raw.map((q, i) => {
        const pair = arr(q, `${path}.params.points[${i}]`);
        if (pair.length !== 2) throw new ProjectFileError(`${path}.params.points[${i}] must be [t, y].`);
        return [time(pair[0], `${path}.params.points[${i}][0]`), num(pair[1], `${path}.params.points[${i}][1]`)] as [number, number];
      });
      if (points.length < 2) throw new ProjectFileError(`${path}.params.points needs at least 2 points.`);
      for (let i = 1; i < points.length; i++) {
        if (points[i]![0] < points[i - 1]![0]) throw new ProjectFileError(`${path}.params.points must be sorted by time.`);
      }
      if (!(points[points.length - 1]![0] > points[0]![0])) throw new ProjectFileError(`${path}.params.points must span a time interval longer than 0.`);
      const interp = pp.interp;
      if (interp !== 'linear' && interp !== 'step') throw new ProjectFileError(`${path}.params.interp must be "linear" or "step".`);
      return { ...base, generator, params: { points, interp, repeat: bool(pp.repeat, `${path}.params.repeat`) } };
    }
    case 'bits': {
      const bitsStr = str(pp.bits, `${path}.params.bits`);
      if (!/^[01]+$/.test(bitsStr)) throw new ProjectFileError(`${path}.params.bits must contain only 0 and 1.`);
      const bitTime = time(pp.bitTime, `${path}.params.bitTime`);
      if (!(bitTime > 0)) throw new ProjectFileError(`${path}.params.bitTime must be positive.`);
      const encoding = pp.encoding;
      if (encoding !== 'nrz' && encoding !== 'rz' && encoding !== 'manchester') {
        throw new ProjectFileError(`${path}.params.encoding must be "nrz", "rz" or "manchester".`);
      }
      return {
        ...base,
        generator,
        params: {
          bits: bitsStr,
          bitTime,
          high: n('high'),
          low: n('low'),
          encoding,
          repeat: bool(pp.repeat, `${path}.params.repeat`),
          ...(pp.idle === 'high' ? { idle: 'high' as const } : {}),
        },
      };
    }
    case 'chirp': {
      const f = (k: string) => {
        const v = n(k);
        if (!(v >= 1e-6 && v <= 1e12)) throw new ProjectFileError(`${path}.params.${k} must be between 1 µHz and 1 THz.`);
        return v;
      };
      const duration = time(pp.duration, `${path}.params.duration`);
      if (!(duration > 0)) throw new ProjectFileError(`${path}.params.duration must be positive.`);
      const sweep = pp.sweep;
      if (sweep !== 'linear' && sweep !== 'log') throw new ProjectFileError(`${path}.params.sweep must be "linear" or "log".`);
      return {
        ...base,
        generator,
        params: { amplitude: n('amplitude'), offset: n('offset'), f0: f('f0'), f1: f('f1'), duration, sweep, phaseDeg: n('phaseDeg'), repeat: bool(pp.repeat, `${path}.params.repeat`) },
      };
    }
    case 'noise': {
      const sampleTime = time(pp.sampleTime, `${path}.params.sampleTime`);
      if (!(sampleTime > 0)) throw new ProjectFileError(`${path}.params.sampleTime must be positive.`);
      const length = Math.round(n('length'));
      if (!(length >= 2 && length <= 1_000_000)) throw new ProjectFileError(`${path}.params.length must be between 2 and 1 000 000.`);
      const distribution = pp.distribution;
      if (distribution !== 'gaussian' && distribution !== 'uniform') throw new ProjectFileError(`${path}.params.distribution must be "gaussian" or "uniform".`);
      const interp = pp.interp;
      if (interp !== 'linear' && interp !== 'hold') throw new ProjectFileError(`${path}.params.interp must be "linear" or "hold".`);
      return { ...base, generator, params: { mean: n('mean'), rms: n('rms'), distribution, sampleTime, length, interp, seed: Math.round(n('seed')) } };
    }
    case 'prbs': {
      const order = Math.round(n('order'));
      if (!(order >= 3 && order <= 15)) throw new ProjectFileError(`${path}.params.order must be between 3 and 15.`);
      const bitTime = time(pp.bitTime, `${path}.params.bitTime`);
      if (!(bitTime > 0)) throw new ProjectFileError(`${path}.params.bitTime must be positive.`);
      const seed = Math.round(n('seed'));
      if (!(seed >= 1 && seed < 2 ** order)) throw new ProjectFileError(`${path}.params.seed must be between 1 and 2^order − 1.`);
      return { ...base, generator, params: { order, bitTime, high: n('high'), low: n('low'), seed } };
    }
  }
}

function readDerived(s: Record<string, unknown>, path: string): SignalDef {
  const expr = str(s.expr, `${path}.expr`);
  try {
    // Stored expressions reference signals only as #{id}; names are not resolved here.
    parseExpr(expr, () => null);
  } catch (e) {
    const msg = e instanceof ExprError ? e.message : String(e);
    throw new ProjectFileError(`${path}.expr is invalid: ${msg}`);
  }
  const resolution = s.resolution === undefined || s.resolution === null ? null : num(s.resolution, `${path}.resolution`);
  if (resolution !== null && !(resolution > 0)) throw new ProjectFileError(`${path}.resolution must be positive or null.`);
  const id = str(s.id, `${path}.id`);
  if (!id) throw new ProjectFileError(`${path}.id must not be empty.`);
  return {
    id,
    name: str(s.name, `${path}.name`),
    unit: s.unit === undefined ? 'V' : str(s.unit, `${path}.unit`),
    locked: s.locked === undefined ? false : bool(s.locked, `${path}.locked`),
    style: readStyle(s.style, `${path}.style`),
    kind: 'derived',
    expr,
    logicHigh: s.logicHigh === undefined ? 1 : num(s.logicHigh, `${path}.logicHigh`),
    logicLow: s.logicLow === undefined ? 0 : num(s.logicLow, `${path}.logicLow`),
    threshold: s.threshold === undefined ? 0.5 : num(s.threshold, `${path}.threshold`),
    resolution,
  };
}

function readTiming(v: unknown, path: string, periodic: boolean): Timing {
  const t = obj(v, path);
  const frequency = num(t.frequency, `${path}.frequency`);
  if (periodic && !(frequency >= MIN_FREQ && frequency <= MAX_FREQ)) throw new ProjectFileError(`${path}.frequency must be between 1 µHz and 1 THz.`);
  return { frequency, phaseDeg: num(t.phaseDeg, `${path}.phaseDeg`), delay: time(t.delay, `${path}.delay`) };
}

function readWindow(v: unknown, path: string): SignalWindow {
  if (v === undefined) return { mode: 'infinite' };
  const w = obj(v, path);
  const outside = (): 'zero' | 'undefined' => {
    if (w.outside !== 'zero' && w.outside !== 'undefined') throw new ProjectFileError(`${path}.outside must be "zero" or "undefined".`);
    return w.outside;
  };
  switch (w.mode) {
    case 'infinite':
      return { mode: 'infinite' };
    case 'interval': {
      const start = time(w.start, `${path}.start`);
      const end = time(w.end, `${path}.end`);
      if (end < start) throw new ProjectFileError(`${path}.end must not be before start.`);
      return { mode: 'interval', start, end, outside: outside() };
    }
    case 'cycles': {
      const cycles = num(w.cycles, `${path}.cycles`);
      if (!(cycles > 0 && cycles <= 1e9)) throw new ProjectFileError(`${path}.cycles must be a positive number up to 1e9.`);
      return { mode: 'cycles', start: time(w.start, `${path}.start`), cycles, outside: outside() };
    }
    default:
      throw new ProjectFileError(`${path}.mode "${String(w.mode)}" is unknown.`);
  }
}

function readStyle(v: unknown, path: string): SignalStyle {
  const s = v === undefined ? {} : obj(v, path);
  const color = s.color === undefined ? '#0072B2' : str(s.color, `${path}.color`);
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new ProjectFileError(`${path}.color must be a #RRGGBB colour.`);
  const dash = (s.dash ?? 'solid') as LineDash;
  if (!DASHES.includes(dash)) throw new ProjectFileError(`${path}.dash "${String(s.dash)}" is unknown.`);
  const lineWidth = s.lineWidth === undefined ? 1.6 : num(s.lineWidth, `${path}.lineWidth`);
  if (!(lineWidth > 0)) throw new ProjectFileError(`${path}.lineWidth must be positive.`);
  return {
    color,
    lineWidth,
    dash,
    visible: s.visible === undefined ? true : bool(s.visible, `${path}.visible`),
    showInLegend: s.showInLegend === undefined ? true : bool(s.showInLegend, `${path}.showInLegend`),
  };
}

function readFigure(v: unknown, path: string, ids: Set<string>): Figure {
  const f = obj(v, path);
  const mode = f.mode === undefined ? 'overlay' : f.mode;
  if (mode !== 'overlay' && mode !== 'stacked') throw new ProjectFileError(`${path}.mode must be "overlay" or "stacked".`);
  const seen = new Set<string>();
  const panels = arr(f.panels, `${path}.panels`).map((pv, i) => {
    const pp = obj(pv, `${path}.panels[${i}]`);
    const traces = arr(pp.traces, `${path}.panels[${i}].traces`)
      .map((tv, j) => ({ signalId: str(obj(tv, `${path}.panels[${i}].traces[${j}]`).signalId, `${path}.panels[${i}].traces[${j}].signalId`) }))
      // Drop references to missing signals and duplicates instead of failing.
      .filter((t) => ids.has(t.signalId) && !seen.has(t.signalId) && (seen.add(t.signalId), true));
    return {
      id: pp.id === undefined ? `panel-${i + 1}` : str(pp.id, `${path}.panels[${i}].id`),
      traces,
      yAxis: autoAxis(''),
      ...(pp.name !== undefined ? { name: str(pp.name, `${path}.panels[${i}].name`) } : {}),
      ...(pp.share !== undefined ? { share: bool(pp.share, `${path}.panels[${i}].share`) } : {}),
      ...(pp.collapsed !== undefined ? { collapsed: bool(pp.collapsed, `${path}.panels[${i}].collapsed`) } : {}),
    };
  });
  if (panels.length === 0) panels.push({ id: 'panel-1', traces: [], yAxis: autoAxis('') });
  const panelIds = new Set<string>();
  for (const pa of panels) {
    if (panelIds.has(pa.id)) throw new ProjectFileError(`${path}: duplicate panel id "${pa.id}".`);
    panelIds.add(pa.id);
  }
  return {
    id: f.id === undefined ? 'fig-1' : str(f.id, `${path}.id`),
    name: f.name === undefined ? 'Figure 1' : str(f.name, `${path}.name`),
    mode,
    panels,
    xAxis: { auto: true, min: 0, max: 0.04, title: 'Time' },
    stylePreset: f.stylePreset === undefined ? 'light' : str(f.stylePreset, `${path}.stylePreset`),
    showLegend: f.showLegend === undefined ? true : bool(f.showLegend, `${path}.showLegend`),
    ...(f.style !== undefined ? { style: readStyleOverrides(f.style, `${path}.style`) } : {}),
    ...(f.axes !== undefined ? { axes: readAxes(f.axes, `${path}.axes`) } : {}),
    ...(f.annotations !== undefined ? { annotations: readAnnotations(f.annotations, `${path}.annotations`, ids) } : {}),
  };
}

function readView(v: unknown, path: string): SavedView {
  const w = obj(v, path);
  const range = (r: unknown, p: string): [number, number] => {
    const a = arr(r, p);
    if (a.length !== 2) throw new ProjectFileError(`${p} must be [min, max].`);
    const lo = num(a[0], `${p}[0]`);
    const hi = num(a[1], `${p}[1]`);
    if (!(hi > lo)) throw new ProjectFileError(`${p} must have max > min.`);
    if (p.endsWith('xRange') && (Math.abs(lo) > MAX_TIME || Math.abs(hi) > MAX_TIME || hi - lo < 1e-15)) {
      throw new ProjectFileError(`${p} must lie within ±1e6 s and span at least 1 fs.`);
    }
    return [lo, hi];
  };
  const yRanges: Record<string, [number, number]> = {};
  if (w.yRanges !== undefined) {
    for (const [k, r] of Object.entries(obj(w.yRanges, `${path}.yRanges`))) {
      if (r !== null) yRanges[k] = range(r, `${path}.yRanges.${k}`);
    }
  }
  let cursors: SavedView['cursors'];
  if (w.cursors !== undefined) {
    const c = obj(w.cursors, `${path}.cursors`);
    const pair = (v: unknown, p: string): [number | null, number | null] => {
      const a = arr(v, p);
      if (a.length !== 2) throw new ProjectFileError(`${p} must have two entries.`);
      return [a[0] === null ? null : num(a[0], `${p}[0]`), a[1] === null ? null : num(a[1], `${p}[1]`)];
    };
    cursors = {
      t: pair(c.t, `${path}.cursors.t`),
      y: pair(c.y, `${path}.cursors.y`),
      target: c.target === null || c.target === undefined ? null : str(c.target, `${path}.cursors.target`),
    };
  }
  const out: SavedView = { xRange: range(w.xRange, `${path}.xRange`), yRanges, ...(cursors ? { cursors } : {}) };
  if (w.activeFigure !== undefined) out.activeFigure = str(w.activeFigure, `${path}.activeFigure`);
  if (w.gridView !== undefined) out.gridView = bool(w.gridView, `${path}.gridView`);
  if (w.byFigure !== undefined) {
    out.byFigure = {};
    for (const [id, v] of Object.entries(obj(w.byFigure, `${path}.byFigure`))) {
      const sub = readView(v, `${path}.byFigure.${id}`);
      out.byFigure[id] = { xRange: sub.xRange, yRanges: sub.yRanges, ...(sub.cursors ? { cursors: sub.cursors } : {}) };
    }
  }
  return out;
}

// --- primitive readers -------------------------------------------------------

function obj(v: unknown, path: string): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ProjectFileError(`${path} must be an object.`);
  return v as Record<string, unknown>;
}

const ANNOTATION_KINDS = ['text', 'arrow', 'dim-t', 'dim-y'];

function readAnnotations(v: unknown, path: string, ids: Set<string>): Annotation[] {
  const seen = new Set<string>();
  return arr(v, path).map((a, i) => {
    const p = `${path}[${i}]`;
    const o = obj(a, p);
    const id = str(o.id, `${p}.id`);
    if (seen.has(id)) throw new ProjectFileError(`${p}: duplicate annotation id "${id}".`);
    seen.add(id);
    if (!ANNOTATION_KINDS.includes(o.kind as string)) throw new ProjectFileError(`${p}.kind must be one of ${ANNOTATION_KINDS.join(', ')}.`);
    const on = o.on === null || o.on === undefined ? null : str(o.on, `${p}.on`);
    const color = str(o.color, `${p}.color`);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new ProjectFileError(`${p}.color must be a #rrggbb colour.`);
    return {
      id,
      kind: o.kind as Annotation['kind'],
      // A signal that is no longer in the file: fall back to the first panel.
      on: on !== null && ids.has(on) ? on : null,
      t0: time(o.t0, `${p}.t0`),
      y0: num(o.y0, `${p}.y0`),
      t1: time(o.t1, `${p}.t1`),
      y1: num(o.y1, `${p}.y1`),
      text: str(o.text, `${p}.text`),
      color,
    };
  });
}

function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) throw new ProjectFileError(`${path} must be a list.`);
  return v;
}

/** Sanity limits: beyond these, floating-point precision and computation time run out. */
const MAX_ABS = 1e15;
const MAX_TIME = 1e6;
const MIN_FREQ = 1e-6;
const MAX_FREQ = 1e12;

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ProjectFileError(`${path} must be a finite number.`);
  if (Math.abs(v) > MAX_ABS) throw new ProjectFileError(`${path} is too large (limit ±1e15).`);
  return v;
}

/** A time value in seconds (delay, window edge, breakpoint time…). */
function time(v: unknown, path: string): number {
  const n = num(v, path);
  if (Math.abs(n) > MAX_TIME) throw new ProjectFileError(`${path} must be within ±1e6 s.`);
  return n;
}

function nonNeg(v: unknown, path: string): number {
  const n = num(v, path);
  if (n < 0) throw new ProjectFileError(`${path} must not be negative.`);
  return n;
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') throw new ProjectFileError(`${path} must be text.`);
  return v;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') throw new ProjectFileError(`${path} must be true or false.`);
  return v;
}

const LEGENDS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'outside-right', 'none'];

function readStyleOverrides(v: unknown, path: string): StyleOverrides {
  const o = obj(v, path);
  const out: StyleOverrides = {};
  const color = (x: unknown, p: string) => {
    const c = str(x, p);
    if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw new ProjectFileError(`${p} must be a #RRGGBB colour.`);
    return c;
  };
  if (o.background !== undefined) out.background = o.background === null ? null : color(o.background, `${path}.background`);
  if (o.plotBackground !== undefined) out.plotBackground = color(o.plotBackground, `${path}.plotBackground`);
  if (o.gridColor !== undefined) out.gridColor = color(o.gridColor, `${path}.gridColor`);
  if (o.gridOpacity !== undefined) out.gridOpacity = Math.min(1, Math.max(0, num(o.gridOpacity, `${path}.gridOpacity`)));
  if (o.minorGrid !== undefined) out.minorGrid = bool(o.minorGrid, `${path}.minorGrid`);
  if (o.font !== undefined) {
    if (!['sans', 'serif', 'mono'].includes(o.font as string)) throw new ProjectFileError(`${path}.font must be sans, serif or mono.`);
    out.font = o.font as StyleOverrides['font'];
  }
  if (o.fontSize !== undefined) out.fontSize = Math.min(40, Math.max(6, num(o.fontSize, `${path}.fontSize`)));
  if (o.legend !== undefined) {
    if (!LEGENDS.includes(o.legend as string)) throw new ProjectFileError(`${path}.legend is not a valid position.`);
    out.legend = o.legend as StyleOverrides['legend'];
  }
  if (o.margins !== undefined) {
    if (!['compact', 'normal', 'wide'].includes(o.margins as string)) throw new ProjectFileError(`${path}.margins must be compact, normal or wide.`);
    out.margins = o.margins as StyleOverrides['margins'];
  }
  if (o.lineScale !== undefined) out.lineScale = Math.min(5, Math.max(0.25, num(o.lineScale, `${path}.lineScale`)));
  return out;
}

function readAxisStyle(v: unknown, path: string): AxisStyle {
  const a = obj(v, path);
  const out: AxisStyle = {};
  if (a.title !== undefined) out.title = str(a.title, `${path}.title`);
  if (a.tickStep !== undefined && a.tickStep !== null) {
    const t = num(a.tickStep, `${path}.tickStep`);
    if (!(t > 0)) throw new ProjectFileError(`${path}.tickStep must be positive.`);
    out.tickStep = t;
  }
  if (a.decimals !== undefined && a.decimals !== null) out.decimals = Math.min(12, Math.max(0, Math.round(num(a.decimals, `${path}.decimals`))));
  if (a.log !== undefined) out.log = bool(a.log, `${path}.log`);
  return out;
}

function readAxes(v: unknown, path: string): { x?: AxisStyle; y?: Record<string, AxisStyle> } {
  const a = obj(v, path);
  const out: { x?: AxisStyle; y?: Record<string, AxisStyle> } = {};
  if (a.x !== undefined) out.x = readAxisStyle(a.x, `${path}.x`);
  if (a.y !== undefined) {
    out.y = {};
    for (const [k, val] of Object.entries(obj(a.y, `${path}.y`))) out.y[k] = readAxisStyle(val, `${path}.y.${k}`);
  }
  return out;
}
