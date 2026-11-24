/**
 * Project-aware compile cache. A compiled signal is reused while its definition
 * object is unchanged (Immer keeps identity of untouched signals) AND, for derived
 * signals, all of its inputs compiled to the same objects. Editing an input
 * therefore recompiles exactly the signals that depend on it.
 *
 * Within one project version every signal is resolved once (`perProject`): without it,
 * each lookup walked the whole dependency tree again, and a graph where expressions share
 * inputs (b = a + x, c = b + a, d = c + b, …) was walked once per path, which grows
 * exponentially with depth (24 such layers took 0.13 s per lookup, on every redraw).
 */

import { storedAst } from '../core/model/deps';
import type { Project, SignalDef } from '../core/model/project';
import { compileSignal } from '../core/signals/compile';
import { compileDerived } from '../core/signals/derived';
import { refsOf } from '../core/expr/parse';
import { guardSignal } from '../core/signals/budget';
import { withPeriodicCache } from '../core/signals/periodic-cache';
import type { SignalEval } from '../core/signals/types';

interface Entry {
  ev: SignalEval;
  deps: Map<string, SignalEval>;
}

const cache = new WeakMap<SignalDef, Entry>();

/** Per project version: signals by id, and the signals already resolved in it. */
interface ProjectMemo {
  signals: readonly SignalDef[];
  length: number;
  byId: Map<string, SignalDef>;
  done: Map<SignalDef, SignalEval>;
}
const perProject = new WeakMap<Project, ProjectMemo>();

const UNDEFINED_SIGNAL: SignalEval = {
  value: () => NaN,
  features: () => ({ features: [], truncated: false }),
};

function memoOf(project: Project): ProjectMemo {
  let m = perProject.get(project);
  // Projects are immutable (Immer); the checks only guard against a caller that edits one in place.
  if (!m || m.signals !== project.signals || m.length !== project.signals.length) {
    const byId = new Map<string, SignalDef>();
    for (const s of project.signals) if (!byId.has(s.id)) byId.set(s.id, s);
    m = { signals: project.signals, length: project.signals.length, byId, done: new Map() };
    perProject.set(project, m);
  }
  return m;
}

export function compiled(def: SignalDef, project: Project): SignalEval {
  return compileIn(def, memoOf(project), new Set());
}

function compileIn(def: SignalDef, memo: ProjectMemo, visiting: Set<string>): SignalEval {
  const done = memo.done.get(def);
  if (done) return done;
  if (def.kind === 'generator') {
    let e = cache.get(def);
    if (!e) {
      e = { ev: compileSignal(def), deps: new Map() };
      cache.set(def, e);
    }
    memo.done.set(def, e.ev);
    return e.ev;
  }
  if (visiting.has(def.id)) return UNDEFINED_SIGNAL; // cycle guard (cycles are also refused on edit/load)
  const ast = storedAst(def.expr);
  if (!ast) return UNDEFINED_SIGNAL;
  visiting.add(def.id);
  const deps = new Map<string, SignalEval>();
  for (const id of refsOf(ast)) {
    const d = memo.byId.get(id);
    deps.set(id, d ? compileIn(d, memo, visiting) : UNDEFINED_SIGNAL);
  }
  visiting.delete(def.id);

  const prev = cache.get(def);
  let ev: SignalEval;
  if (prev && prev.deps.size === deps.size && [...deps].every(([k, v]) => prev.deps.get(k) === v)) ev = prev.ev;
  else {
    ev = guardSignal(
      withPeriodicCache(
        compileDerived({ root: ast, logicHigh: def.logicHigh, logicLow: def.logicLow, threshold: def.threshold, resolution: def.resolution }, deps),
      ),
    );
    cache.set(def, { ev, deps });
  }
  memo.done.set(def, ev);
  return ev;
}
