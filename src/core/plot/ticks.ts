/** "Nice" axis ticks (1-2-5 steps) with SI-prefixed labels. */

import { formatFixed, formatSI, prefixFactorFor } from '../units/si';

export interface Ticks {
  major: number[];
  minor: number[];
  step: number;
  minorStep: number;
  /** Labels for the major ticks, same order. */
  labels: string[];
  /** Unit with prefix, e.g. "ms" — shown in the axis title. */
  unitLabel: string;
}

export interface TickOptions {
  /** Fixed major step (data units); null/undefined = automatic. */
  step?: number | null;
  /** Fixed number of decimals in labels; null/undefined = automatic. */
  decimals?: number | null;
  /** Fewest labelled ticks to aim for (default 3; 2 for very short panels). */
  minCount?: number;
}

/** Fewest decimals that write x exactly (2.5 → 1, 0.25 → 2, 5 → 0), at most 12. */
export function decimalsFor(x: number): number {
  const a = Math.abs(x);
  if (!(a > 0) || !Number.isFinite(a)) return 0;
  for (let d = Math.max(0, Math.ceil(-Math.log10(a) - 1e-9)); d <= 12; d++) {
    const scaled = a * 10 ** d;
    if (Math.abs(scaled - Math.round(scaled)) <= 1e-6 * Math.max(1, scaled)) return d;
  }
  return 12;
}

export function niceTicks(
  min: number,
  max: number,
  maxCount: number,
  unit = '',
  maxPrefixFactor = 1e12,
  opts: TickOptions = {},
): Ticks {
  const empty: Ticks = { major: [], minor: [], step: 0, minorStep: 0, labels: [], unitLabel: unit };
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
  const forced = opts.step && opts.step > 0 && (max - min) / opts.step <= 500 ? opts.step : null;
  if (forced) {
    major = multiples(forced);
    mag = 10 ** Math.floor(Math.log10(forced));
    nice = forced / mag;
  }
  for (let i = 0; !forced && i < 4 && major.length < (opts.minCount ?? 3); i++) {
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
  const sub = Math.abs(nice - 2) < 1e-9 ? 4 : 5;
  const minorStep = step / sub;
  const minor = multiples(minorStep).filter((v) => {
    const r = Math.abs(v / step - Math.round(v / step));
    return r > 1e-6;
  });

  const absMax = Math.max(Math.abs(min), Math.abs(max));
  const [factor, prefix] = prefixFactorFor(absMax, maxPrefixFactor);
  const decimals = opts.decimals ?? decimalsFor(step / factor);
  // Typographic minus sign (U+2212) for negative labels, as in print.
  const labels = major.map((v) => formatFixed(v, factor, decimals).replace(/^-/, "\u2212"));
  return { major, minor, step, minorStep, labels, unitLabel: prefix + unit };
}

/** Logarithmic ticks: decades as majors (labelled), 2…9 × decade as minors. Requires 0 < min < max. */
export function logTicks(min: number, max: number, unit = ''): Ticks {
  const empty: Ticks = { major: [], minor: [], step: 0, minorStep: 0, labels: [], unitLabel: unit };
  if (!(min > 0) || !(max > min)) return empty;
  const k0 = Math.floor(Math.log10(min));
  const k1 = Math.ceil(Math.log10(max));
  const decades = Math.log10(max / min);
  // Labelled multiples per decade: all for < 1 decade, 1-2-5 for < 2.5 decades, else decades only.
  const labelled = decades < 1 ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : decades < 2.5 ? [1, 2, 5] : [1];
  const major: number[] = [];
  const minor: number[] = [];
  for (let k = k0; k <= k1; k++) {
    const d = 10 ** k;
    for (let m = 1; m <= 9; m++) {
      const v = m * d;
      if (v < min * (1 - 1e-12) || v > max * (1 + 1e-12)) continue;
      (labelled.includes(m) ? major : minor).push(v);
    }
  }
  // Plain numbers in the usual range (0.8, 1, 20, 1000); SI prefixes only for extremes.
  const labels = major.map((v) => (v >= 1e-3 && v < 1e5 ? String(Number(v.toPrecision(3))) : formatSI(v, '', 3)));
  return { major, minor, step: 0, minorStep: 0, labels, unitLabel: unit };
}
