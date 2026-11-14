/**
 * SI-prefix aware number parsing and formatting.
 *
 * Parsing accepts engineering shorthand such as "6.667m", "50k", "1u", "1µs",
 * "2.5 kHz", "-3e-3". Prefixes are case-sensitive ("m" = milli, "M" = mega).
 */

const PREFIXES: Record<string, number> = {
  f: 1e-15,
  p: 1e-12,
  n: 1e-9,
  u: 1e-6,
  'µ': 1e-6, // micro sign U+00B5
  'μ': 1e-6, // greek mu U+03BC
  m: 1e-3,
  '': 1,
  k: 1e3,
  M: 1e6,
  G: 1e9,
  T: 1e12,
};

const FORMAT_PREFIXES: Array<[number, string]> = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
  [1e-15, 'f'],
];

const NUMBER_RE = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(.*?)\s*$/;

export interface ParseResult {
  value: number;
  /** Unit text left after the prefix, e.g. "Hz" for "50 kHz". */
  unit: string;
}

/**
 * Parse a string with optional SI prefix and unit.
 * If `expectedUnit` is given, a trailing unit must match it (or be absent).
 * Returns null on invalid input.
 */
export function parseSI(text: string, expectedUnit?: string): ParseResult | null {
  const m = NUMBER_RE.exec(text);
  if (!m) return null;
  const num = Number(m[1]);
  if (!Number.isFinite(num)) return null;
  let rest = m[2] ?? '';

  // Exact unit match without prefix first (e.g. "m" as metre would be ambiguous; we
  // resolve by preferring the expected unit when it matches fully).
  if (expectedUnit && rest === expectedUnit) return { value: num, unit: rest };

  let factor = 1;
  if (rest.length > 0) {
    const first = rest[0]!;
    if (first in PREFIXES && first !== '') {
      const remainder = rest.slice(1);
      if (!expectedUnit || remainder === '' || remainder === expectedUnit) {
        factor = PREFIXES[first]!;
        rest = remainder;
      }
    }
  }
  if (expectedUnit && rest !== '' && rest !== expectedUnit) return null;
  return { value: num * factor, unit: rest };
}

/**
 * Format a value with an engineering SI prefix, e.g. formatSI(0.006667, 's') -> "6.667 ms".
 * `digits` = significant digits (trailing zeros trimmed).
 */
export function formatSI(value: number, unit = '', digits = 4): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? '—' : value > 0 ? '∞' : '−∞';
  if (value === 0) return unit ? `0 ${unit}` : '0';
  const abs = Math.abs(value);
  let chosen: [number, string] = FORMAT_PREFIXES[FORMAT_PREFIXES.length - 1]!;
  for (const p of FORMAT_PREFIXES) {
    // Small epsilon so 999.99999 rounding to 1000 picks the larger prefix.
    if (abs >= p[0] * (1 - 1e-12)) {
      chosen = p;
      break;
    }
  }
  let scaled = value / chosen[0];
  let text = trimNumber(scaled, digits);
  // Rounding can push e.g. 999.96 to "1000"; re-scale in that case.
  if (Math.abs(Number(text)) >= 1000) {
    const idx = FORMAT_PREFIXES.indexOf(chosen);
    if (idx > 0) {
      chosen = FORMAT_PREFIXES[idx - 1]!;
      scaled = value / chosen[0];
      text = trimNumber(scaled, digits);
    }
  }
  const suffix = chosen[1] + unit;
  return suffix ? `${text} ${suffix}` : text;
}

function trimNumber(x: number, digits: number): string {
  let s = x.toPrecision(digits);
  if (s.includes('e')) s = String(Number(s));
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}
