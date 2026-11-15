/**
 * Helpers for tools that create a whole set of ordinary, editable signals at once
 * (PWM generator, rectifiers): generators, expression signals and their groups.
 */

import { defaultGenerator } from '../core/model/defaults';
import { paletteColor } from '../core/model/palette';
import type { DerivedSignalDef, GeneratorSignalDef, Panel, SignalDef } from '../core/model/project';
import type { GeneratorKind } from '../core/model/signal-defs';

export interface SignalSet {
  signals: SignalDef[];
  groups: Panel[];
}

export type GenOf<K extends GeneratorKind> = Extract<GeneratorSignalDef, { generator: K }>;

export function setBuilder(newId: (prefix: string) => string, colorStart = 0) {
  const signals: SignalDef[] = [];
  let colour = colorStart;
  const style = (lw = 1.6) => ({ color: paletteColor(colour++), lineWidth: lw, dash: 'solid' as const, visible: true, showInLegend: true });
  return {
    signals,
    ref: (s: SignalDef) => `#{${s.id}}`,
    gen<K extends GeneratorKind>(name: string, unit: string, kind: K, build: (d: GenOf<K>) => void = () => {}): GenOf<K> {
      const d = { id: newId('s'), name, unit, locked: false, style: style(), kind: 'generator', ...defaultGenerator(kind) } as GenOf<K>;
      build(d);
      signals.push(d);
      return d;
    },
    der(name: string, unit: string, expr: string, high = 1, low = 0): DerivedSignalDef {
      const d: DerivedSignalDef = {
        id: newId('d'),
        name,
        unit,
        locked: false,
        style: style(),
        kind: 'derived',
        expr,
        logicHigh: high,
        logicLow: low,
        threshold: 0.5,
        resolution: null,
      };
      signals.push(d);
      return d;
    },
    group(name: string, members: SignalDef[], opts: { share?: boolean; collapsed?: boolean } = {}): Panel {
      return {
        id: newId('g'),
        name,
        share: opts.share ?? false,
        ...(opts.collapsed ? { collapsed: true } : {}),
        traces: members.map((s) => ({ signalId: s.id })),
        yAxis: { auto: true, min: -1, max: 1, title: '' },
      };
    },
  };
}
