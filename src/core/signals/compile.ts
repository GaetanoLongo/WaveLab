import type { GeneratorSignalDef } from '../model/project';
import { compileGenerator } from './generator';
import type { SignalEval } from './types';

/** Turn a generator definition into an evaluable signal (derived ones: see state/compiled). */
export function compileSignal(def: GeneratorSignalDef): SignalEval {
  return compileGenerator(def);
}
