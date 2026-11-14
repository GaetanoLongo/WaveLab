/** Sensible default definitions for each generator (50 Hz, ±1 V style values). */

import { defaultTiming, INFINITE, type GeneratorDef, type GeneratorKind } from './signal-defs';

export function defaultGenerator(kind: GeneratorKind): GeneratorDef {
  const timing = defaultTiming(50);
  const window = INFINITE;
  switch (kind) {
    case 'sine':
      return { generator: 'sine', timing, window, params: { amplitude: 1, offset: 0 } };
    case 'cosine':
      return { generator: 'cosine', timing, window, params: { amplitude: 1, offset: 0 } };
    case 'square':
      return { generator: 'square', timing, window, params: { high: 1, low: -1, duty: 0.5 } };
    case 'pulse':
      return {
        generator: 'pulse',
        timing,
        window,
        params: { high: 1, low: 0, width: 0.004, rise: 0, fall: 0 },
      };
    case 'triangle':
      return { generator: 'triangle', timing, window, params: { amplitude: 1, offset: 0 } };
    case 'sawtooth':
      return {
        generator: 'sawtooth',
        timing,
        window,
        params: { amplitude: 1, offset: 0, slope: 'rising' },
      };
    case 'dc':
      return { generator: 'dc', timing, window, params: { level: 1 } };
  }
}
