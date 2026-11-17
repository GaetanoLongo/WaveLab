/**
 * Randomised editing sessions: after every operation the project must stay consistent (no dangling
 * or doubly-listed traces, no dangling expression references, valid selection, unique names), it must
 * survive a save/load round trip, and undoing everything must return to the start (redo to the end).
 */

import { describe, expect, it } from 'vitest';
import { directDeps } from '../core/model/deps';
import { parseProjectFile, serializeProject } from '../core/io/project-file';
import type { GeneratorKind } from '../core/model/signal-defs';
import type { Project } from '../core/model/project';
import { compiled } from './compiled';
import { DEFAULT_MODULATION } from './modulation';
import { DEFAULT_PROTOCOL } from './protocols';
import { DEFAULT_PWM } from './pwm';
import { DEFAULT_RECTIFIER } from './rectifier';
import { actions, canRedo, canUndo, editor } from './store';

function rng(seed: number) {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T,>(a: readonly T[]): T => a[Math.floor(next() * a.length)]! };
}

const KINDS: GeneratorKind[] = ['sine', 'cosine', 'square', 'pulse', 'triangle', 'sawtooth', 'dc', 'exponential', 'damped', 'bits', 'chirp', 'noise', 'prbs'];
const TEMPLATES: Array<[(a: string, b: string) => string, 1 | 2, string]> = [
  [(a, b) => `${a} + ${b}`, 2, 'Sum'],
  [(a, b) => `${a} * ${b}`, 2, 'Product'],
  [(a) => `abs(${a})`, 1, 'Abs'],
  [(a) => `lowpass(${a}, 1m)`, 1, 'LP'],
  [(a, b) => `${a} > ${b}`, 2, 'Cmp'],
  [(a) => `integral(${a}, 0, 0)`, 1, 'Int'],
  [(a) => `movavg(${a}, 2m)`, 1, 'Avg'],
];

function problems(label: string): string[] {
  const st = editor.getState();
  const p: Project = st.project;
  const out: string[] = [];
  const ids = new Set(p.signals.map((s) => s.id));
  const names = new Set<string>();
  for (const s of p.signals) {
    if (names.has(s.name)) out.push(`${label}: duplicate name “${s.name}”`);
    names.add(s.name);
    if (s.kind === 'derived') for (const d of directDeps(s)) if (!ids.has(d)) out.push(`${label}: “${s.name}” references a missing signal`);
  }
  for (const f of p.figures) {
    if (f.panels.length === 0) out.push(`${label}: figure “${f.name}” has no group`);
    const seen = new Set<string>();
    for (const g of f.panels) for (const t of g.traces) {
      if (!ids.has(t.signalId)) out.push(`${label}: dangling trace in “${f.name}/${g.name}”`);
      if (seen.has(t.signalId)) out.push(`${label}: signal listed twice in figure “${f.name}”`);
      seen.add(t.signalId);
    }
    for (const a of f.annotations ?? []) if (a.on && !ids.has(a.on)) out.push(`${label}: annotation refers to a missing signal`);
  }
  if (!p.figures.some((f) => f.id === st.activeFigureId)) out.push(`${label}: active figure does not exist`);
  if (st.selectedId !== null && !ids.has(st.selectedId)) out.push(`${label}: selection points at a missing signal`);
  return out;
}

/** Paths where two JSON values differ (first few), for readable failures. */
function diff(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length > 6) return out;
  if (typeof a !== typeof b || (a === null) !== (b === null) || Array.isArray(a) !== Array.isArray(b)) {
    out.push(`${path}: ${JSON.stringify(a)?.slice(0, 70)} → ${JSON.stringify(b)?.slice(0, 70)}`);
    return out;
  }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    for (const k of new Set([...ka, ...kb])) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path}: ${String(a)} → ${String(b)}`);
  return out;
}

const strip = (project: Project) => {
  const o = JSON.parse(serializeProject(project)) as { savedAt?: string; project?: { signals?: Array<{ params?: { idle?: string } }> } };
  delete o.savedAt;
  // The default bit-stream idle level is omitted from files: “low” and absent are the same.
  for (const s of o.project?.signals ?? []) if (s.params && s.params.idle === 'low') delete s.params.idle;
  return o;
};

describe('random editing sessions', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: invariants hold after every operation; undo/redo and save/load are exact`, () => {
      const R = rng(seed * 7919);
      actions.newProject();
      const start = strip(editor.getState().project);
      const bad: string[] = [];
      const log: string[] = [];
      const anySignal = () => R.pick(editor.getState().project.signals)?.id;
      const anyGroup = () => R.pick(editor.getState().project.figures.find((f) => f.id === editor.getState().activeFigureId)!.panels)?.id;
      const anyFigure = () => R.pick(editor.getState().project.figures)?.id;

      const ops: Array<[string, () => void]> = [
        ['addSignal', () => void actions.addSignal(R.pick(KINDS))],
        ['addSignal', () => void actions.addSignal(R.pick(KINDS))],
        ['addSignal', () => void actions.addSignal(R.pick(KINDS))],
        ['addDerived', () => { const [t, n, name] = R.pick(TEMPLATES); actions.addDerived(t, n, name); }],
        ['addDerived', () => { const [t, n, name] = R.pick(TEMPLATES); actions.addDerived(t, n, name); }],
        ['select', () => actions.select(anySignal() ?? null)],
        ['duplicate', () => { const s = anySignal(); if (s) actions.duplicate(s); }],
        ['copy+paste', () => { const s = anySignal(); if (s) { actions.copy(s); actions.paste(); } }],
        ['delete', () => { const s = anySignal(); if (s) actions.deleteSignal(s); }],
        ['toggleVisible', () => { const s = anySignal(); if (s) actions.toggleVisible(s); }],
        ['toggleLock', () => { const s = anySignal(); if (s) actions.toggleLock(s); }],
        ['rename', () => { const s = anySignal(); if (s) actions.renameSignal(s, R.pick(['x', 'y_{1}', 'V_{out}', 'Sine', 'a b', '']) as string); }],
        ['invert', () => { const s = anySignal(); if (s) actions.invert(s); }],
        ['reorder', () => { const s = anySignal(); if (s) actions.reorder(s, R.int(6)); }],
        ['addGroup', () => void actions.addGroup()],
        ['moveSignal', () => { const s = anySignal(); const g = anyGroup(); if (s && g) actions.moveSignal(s, g, R.int(4)); }],
        ['deleteGroup', () => { const g = anyGroup(); if (g) actions.deleteGroup(g); }],
        ['moveGroup', () => { const g = anyGroup(); if (g) actions.moveGroup(g, R.next() < 0.5 ? -1 : 1); }],
        ['updateGroup', () => { const g = anyGroup(); if (g) actions.updateGroup(g, { share: R.next() < 0.5, collapsed: R.next() < 0.5 }); }],
        ['addFigure', () => void actions.addFigure()],
        ['duplicateFigure', () => void actions.duplicateFigure(anyFigure())],
        ['deleteFigure', () => { const f = anyFigure(); if (f) actions.deleteFigure(f); }],
        ['switchFigure', () => { const f = anyFigure(); if (f) actions.switchFigure(f); }],
        ['removeFromFigure', () => { const s = anySignal(); if (s) actions.removeFromFigure(s); }],
        ['addToFigure', () => { const s = anySignal(); if (s) actions.addToFigure(s); }],
        ['setMode', () => actions.setMode(R.next() < 0.5 ? 'overlay' : 'stacked')],
        ['annotate', () => { const s = anySignal(); if (s) actions.addAnnotation({ kind: 'text', on: s, t0: 0.001, t1: 0.001, y0: 0, y1: 0, text: 'T', color: '#1c2330' }); }],
        ['pwm', () => actions.createPwm({ ...DEFAULT_PWM, topology: R.pick(['half', 'full-bipolar', 'full-unipolar', 'three-phase'] as const), load: R.next() < 0.5 })],
        ['rectifier', () => actions.createRectifier({ ...DEFAULT_RECTIFIER })],
        ['modulation', () => actions.createModulation({ ...DEFAULT_MODULATION, kind: R.pick(['am', 'dsb', 'fm', 'pm'] as const) })],
        ['protocol', () => void actions.createProtocol({ ...DEFAULT_PROTOCOL, protocol: R.pick(['uart', 'spi', 'i2c'] as const) })],
        ['undo', () => actions.undo()],
        ['undo', () => actions.undo()],
        ['redo', () => actions.redo()],
      ];

      const STEPS = 70;
      for (let i = 0; i < STEPS; i++) {
        const [name, run] = R.pick(ops);
        log.push(name);
        try {
          run();
        } catch (e) {
          bad.push(`step ${i} (${name}) threw ${String(e)}`);
          break;
        }
        for (const m of problems(`step ${i} after ${name}`)) bad.push(m);
        if (bad.length) break;
        if (i % 7 === 0) {
          const p = editor.getState().project;
          const back = parseProjectFile(serializeProject(p)).project;
          // A project in which no figure shows any signal is repaired on load (all signals go to the
          // first figure): that is the one accepted difference.
          const nothingShown = p.signals.length > 0 && p.figures.every((f) => f.panels.every((g) => g.traces.length === 0));
          const d = nothingShown ? [] : diff(strip(p), strip(back));
          if (d.length) bad.push(`step ${i} after ${name}: save/load changed the project: ${d.join(' | ')}`);
          for (const s of p.signals.slice(0, 12)) compiled(s, p).value(0.001);
        }
        if (bad.length) break;
      }
      expect(bad).toEqual([]);

      // Undo everything, then redo everything.
      const end = strip(editor.getState().project);
      const redoable = (() => { let n = 0; while (canRedo(editor.getState())) { actions.redo(); n++; } return n; })();
      void redoable;
      const finalState = strip(editor.getState().project);
      let guard = 0;
      while (canUndo(editor.getState()) && guard++ < 500) actions.undo();
      expect(strip(editor.getState().project)).toEqual(start);
      guard = 0;
      while (canRedo(editor.getState()) && guard++ < 500) actions.redo();
      expect(strip(editor.getState().project)).toEqual(finalState);
      void end;
      void log;
    }, 120000);
  }
});
