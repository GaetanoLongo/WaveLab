import type { SignalDef } from '../model/project';
import { compileGenerator } from './generator';
import type { SignalEval } from './types';

/** Turn a serializable signal definition into an evaluable signal. */
export function compileSignal(def: SignalDef): SignalEval {
  return compileGenerator(def);
}
