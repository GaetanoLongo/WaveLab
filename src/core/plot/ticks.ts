/** "Nice" axis ticks (1-2-5 steps) with SI-prefixed labels. */

import { formatFixed, prefixFactorFor } from '../units/si';

export interface Ticks {
  major: number[];
  minor: number[];
  step: number;
  /** Labels for the major ticks, same order. */
  labels: string[];
  /** Unit with prefix, e.g. "ms" — shown in the axis title. */
  unitLabel: string;
}

export function niceTicks(
  min: number,
  max: number,
  maxCount: number,
  unit = '',
  maxPrefixFactor = 1e12,
): Ticks {
  const empty: Ticks = { major: [], minor: [], step: 0, labels: [], unitLabel: unit };
  if (!(max > min) || !Number.isFinite(min) || !Number.isFinite(max)) return empty;

  const raw = (max - min) / Math.max(1, maxCount);
  let mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  let nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;

  const multiples = (s: number) => {
    const k0 = Math.ceil(min / s - 1e-9);
    const k1 = Math.floor(max / s + 1e-9);
    const out: number[] = [];
    for (let k = k0; k <= k1 && out.length < 10_000; k++) out.push(k * s);
    return out;
  };

  // Guarantee at least 3 labelled ticks (small panels would otherwise get one).
  let major = multiples(nice * mag);
  for (let i = 0; i < 4 && major.length < 3; i++) {
    if (nice === 10) nice = 5;
    else if (nice === 5) nice = 2;
    else if (nice === 2) nice = 1;
    else {
      nice = 5;
      mag /= 10;
    }
    major = multiples(nice * mag);
  }
  const step = nice * mag;
  const sub = nice === 2 ? 4 : 5;
  const minorStep = step / sub;
  const minor = multiples(minorStep).filter((v) => {
    const r = Math.abs(v / step - Math.round(v / step));
    return r > 1e-6;
  });

  const absMax = Math.max(Math.abs(min), Math.abs(max));
  const [factor, prefix] = prefixFactorFor(absMax, maxPrefixFactor);
  const decimals = Math.max(0, Math.ceil(-Math.log10(step / factor) - 1e-9));
  const labels = major.map((v) => formatFixed(v, factor, decimals));
  return { major, minor, step, labels, unitLabel: prefix + unit };
}
