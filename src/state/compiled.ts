/**
 * Project-aware compile cache. A compiled signal is reused while its definition
 * object is unchanged (Immer keeps identity of untouched signals) AND, for derived
 * signals, all of its inputs compiled to the same objects. Editing an input
 * therefore recompiles exactly the signals that depend on it.
 */

import { storedAst } from '../core/model/deps';
import type { Project, SignalDef } from '../core/model/project';
import { compileSignal } from '../core/signals/compile';
import { compileDerived } from '../core/signals/derived';
import { refsOf } from '../core/expr/parse';
import { withPeriodicCache } from '../core/signals/periodic-cache';
import type { SignalEval } from '../core/signals/types';

interface Entry {
  ev: SignalEval;
  deps: Map<string, SignalEval>;
}

const cache = new WeakMap<SignalDef, Entry>();

const UNDEFINED_SIGNAL: SignalEval = {
  value: () => NaN,
  features: () => ({ features: [], truncated: false }),
};

export function compiled(def: SignalDef, project: Project): SignalEval {
  return compileIn(def, project, new Set());
}

function compileIn(def: SignalDef, project: Project, visiting: Set<string>): SignalEval {
  if (def.kind === 'generator') {
    let e = cache.get(def);
    if (!e) {
      e = { ev: compileSignal(def), deps: new Map() };
      cache.set(def, e);
    }
    return e.ev;
  }
  if (visiting.has(def.id)) return UNDEFINED_SIGNAL; // cycle guard (cycles are also refused on edit/load)
  const ast = storedAst(def.expr);
  if (!ast) return UNDEFINED_SIGNAL;
  visiting.add(def.id);
  const deps = new Map<string, SignalEval>();
  for (const id of refsOf(ast)) {
    const d = project.signals.find((s) => s.id === id);
    deps.set(id, d ? compileIn(d, project, visiting) : UNDEFINED_SIGNAL);
  }
  visiting.delete(def.id);

  const prev = cache.get(def);
  if (prev && prev.deps.size === deps.size && [...deps].every(([k, v]) => prev.deps.get(k) === v)) return prev.ev;
  const ev = withPeriodicCache(
    compileDerived({ root: ast, logicHigh: def.logicHigh, logicLow: def.logicLow, threshold: def.threshold, resolution: def.resolution }, deps),
  );
  cache.set(def, { ev, deps });
  return ev;
}
