/** Dependency graph between signals (derived signals reference others by id). */

import { parseExpr, refsOf, type Node } from '../expr/parse';
import type { Project, SignalDef } from './project';

const astCache = new Map<string, Node | null>();

/** AST of a stored expression (null if it does not parse). Cached by text. */
export function storedAst(expr: string): Node | null {
  let n = astCache.get(expr);
  if (n === undefined) {
    try {
      n = parseExpr(expr, () => null);
    } catch {
      n = null;
    }
    if (astCache.size > 2000) astCache.clear();
    astCache.set(expr, n);
  }
  return n;
}

/** Ids a signal depends on directly. */
export function directDeps(def: SignalDef): Set<string> {
  if (def.kind !== 'derived') return new Set();
  const ast = storedAst(def.expr);
  return ast ? refsOf(ast) : new Set();
}

/** Signals that reference `id` directly. */
export function dependents(project: Project, id: string): SignalDef[] {
  return project.signals.filter((s) => directDeps(s).has(id));
}

/** True if `id` (with the given references) would depend on itself. */
export function createsCycle(project: Project, id: string, refs: Iterable<string>): boolean {
  const byId = new Map(project.signals.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const stack = [...refs];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === id) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const def = byId.get(cur);
    if (def) stack.push(...directDeps(def));
  }
  return false;
}
