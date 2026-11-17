/**
 * Automatic fundamental for the spectrum of a signal.
 *
 *  - Generator: 1 / period.
 *  - Derived signal (e.g. a PWM output): the signal's own period can be much longer than
 *    the physically meaningful fundamental (the pattern repeats only after the LCM of the
 *    carrier and reference periods). The fundamental is the lowest-frequency sine/cosine
 *    input (otherwise the lowest-frequency periodic input) that fits a whole number of
 *    times in the signal's period, and the window is that full period.
 */

import type { Project, SignalDef } from '../core/model/project';
import { isPeriodicKind } from '../core/model/signal-defs';
import { directDeps } from '../core/model/deps';
import type { SignalEval } from '../core/signals/types';

export interface AutoFundamental {
  f1: number;
  periods: number;
  /** Where the value comes from, for the UI. */
  source: 'period' | 'input' | 'span';
  inputName?: string;
  /** Set when the pattern repeats only after this many periods and fewer were used (approximate). */
  fullPeriods?: number;
}

/**
 * Longest window (in periods of the fundamental) used automatically. A PWM whose carrier and
 * reference frequencies are not commensurate repeats only after thousands of periods (e.g.
 * 14 Hz / 170.37 Hz: 100 s); integrating that exactly blocks the page for many seconds.
 */
export const MAX_AUTO_PERIODS = 40;

export function autoFundamental(p: Project, sig: SignalDef, ev: SignalEval, span: number): AutoFundamental {
  if (!ev.period) return { f1: 1 / span, periods: 1, source: 'span' };
  const own: AutoFundamental = { f1: 1 / ev.period, periods: 1, source: 'period' };
  if (sig.kind !== 'derived') return own;

  // Periodic generator inputs, transitively.
  const seen = new Set<string>();
  const inputs: SignalDef[] = [];
  const walk = (s: SignalDef) => {
    for (const id of directDeps(s)) {
      if (seen.has(id)) continue;
      seen.add(id);
      const d = p.signals.find((x) => x.id === id);
      if (!d) continue;
      if (d.kind === 'generator') {
        if (isPeriodicKind(d.generator) && d.generator !== 'dc' && d.window.mode === 'infinite' && d.timing.frequency > 0) inputs.push(d);
      } else walk(d);
    }
  };
  walk(sig);

  const fits = (f: number) => {
    const n = ev.period! * f;
    return n >= 1 && Math.abs(n - Math.round(n)) < 1e-6 * n;
  };
  const pick = (list: SignalDef[]) =>
    list
      .filter((d) => d.kind === 'generator' && fits(d.timing.frequency))
      .sort((a, b) => (a.kind === 'generator' && b.kind === 'generator' ? a.timing.frequency - b.timing.frequency : 0))[0];
  const sines = inputs.filter((d) => d.kind === 'generator' && (d.generator === 'sine' || d.generator === 'cosine'));
  const best = pick(sines) ?? pick(inputs);
  if (!best || best.kind !== 'generator') return own;
  const f1 = best.timing.frequency;
  const full = Math.round(ev.period * f1);
  if (full > MAX_AUTO_PERIODS) return { f1, periods: MAX_AUTO_PERIODS, source: 'input', inputName: best.name, fullPeriods: full };
  return { f1, periods: full, source: 'input', inputName: best.name };
}
