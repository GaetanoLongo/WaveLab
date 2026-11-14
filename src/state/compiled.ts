/**
 * Compile cache keyed by definition object identity. Immer creates a new object
 * only for signals that changed, so unchanged signals reuse their compiled form
 * (and their cached ranges) across edits.
 */

import type { SignalDef } from '../core/model/project';
import { compileSignal } from '../core/signals/compile';
import type { SignalEval } from '../core/signals/types';

const cache = new WeakMap<SignalDef, SignalEval>();

export function compiled(def: SignalDef): SignalEval {
  let s = cache.get(def);
  if (!s) {
    s = compileSignal(def);
    cache.set(def, s);
  }
  return s;
}
