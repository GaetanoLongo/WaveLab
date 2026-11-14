/**
 * Derived signals: y(t) = expression of other signals and t.
 *
 * Point evaluation is direct. Features (needed by the renderer, snapping and
 * the min/max envelope) are found as follows on an interval [t0, t1]:
 *
 *  1. Breakpoints = features of the inputs (shifted by any delay()). At each one
 *     the result's left/right limits are computed from the inputs' limits, so
 *     input discontinuities stay exact.
 *  2. Between breakpoints every input is smooth and monotonic. The result is
 *     sampled at the "computational resolution" (default: 1/64 of the shortest
 *     input period; configurable per signal). Each sample records a *state
 *     signature*: comparator outcomes, logic truth values, which branch of
 *     abs/min/max/clip/sign is active, the sign of divisors. Where the signature
 *     changes between two samples the switching instant is located by bisection
 *     (to ~1e-15 relative): comparator crossings become exact vertical edges,
 *     clip/abs/min/max corners become exact vertices.
 *  3. Local extrema between samples are refined by golden-section search, which
 *     restores the "monotonic between features" contract.
 *
 * Limitation: two switching instants closer together than one sampling step
 * *within* a smooth segment can be missed. Segment ends are always sampled, so
 * narrow pulses around input breakpoints (e.g. near PWM carrier peaks) are found.
 */

import { FUNCTIONS, isLogic, type Node } from '../expr/parse';
import { DEFAULT_MAX_FEATURES, type Feature, type FeatureQuery, type SignalEval } from './types';

export interface DerivedSpec {
  root: Node;
  logicHigh: number;
  logicLow: number;
  /** Analog values above this count as logic 1 in and/or/xor/not/!. */
  threshold: number;
  /** Computational sampling step in seconds; null = automatic. */
  resolution: number | null;
}

/** Evaluator: value at t (left limit if `left`), optionally recording the state signature. */
type Ev = (t: number, left: boolean, sig: number[] | null) => number;

const MAX_SAMPLES = 20_000;
const SAMPLES_PER_SCALE = 64;

export function leftValue(s: SignalEval, t: number): number {
  return s.left ? s.left(t) : s.value(t - 1e-12 * Math.max(1, Math.abs(t)));
}

export function compileDerived(spec: DerivedSpec, inputs: Map<string, SignalEval>): SignalEval {
  const thr = spec.threshold;
  const logicRoot = isLogic(spec.root);

  const build = (n: Node): Ev => {
    switch (n.k) {
      case 'num': {
        const v = n.v;
        return () => v;
      }
      case 'const': {
        const v = n.name === 'pi' ? Math.PI : Math.E;
        return () => v;
      }
      case 'time':
        return (t) => t;
      case 'ref': {
        const s = inputs.get(n.id);
        if (!s) return () => NaN;
        return (t, left) => (left ? leftValue(s, t) : s.value(t));
      }
      case 'neg': {
        const a = build(n.a);
        return (t, l, sig) => -a(t, l, sig);
      }
      case 'not': {
        const a = truth(n.a);
        return (t, l, sig) => (a(t, l, sig) ? 0 : 1);
      }
      case 'bin':
        return buildBin(n.op, n.a, n.b);
      case 'call':
        return buildCall(n.fn, n.args);
    }
  };

  /** Logic truth of a node: logic nodes are true when ≠ 0, analog ones when > threshold. */
  const truth = (n: Node): ((t: number, l: boolean, sig: number[] | null) => boolean) => {
    const a = build(n);
    if (isLogic(n)) return (t, l, sig) => a(t, l, sig) !== 0;
    return (t, l, sig) => {
      const v = a(t, l, sig) > thr;
      sig?.push(v ? 1 : 0);
      return v;
    };
  };

  const buildBin = (op: string, na: Node, nb: Node): Ev => {
    if (op === '&&' || op === '||') {
      const a = truth(na);
      const b = truth(nb);
      return op === '&&'
        ? (t, l, sig) => {
            const x = a(t, l, sig);
            const y = b(t, l, sig); // no short-circuit: the signature must have a fixed length
            return x && y ? 1 : 0;
          }
        : (t, l, sig) => {
            const x = a(t, l, sig);
            const y = b(t, l, sig);
            return x || y ? 1 : 0;
          };
    }
    const a = build(na);
    const b = build(nb);
    switch (op) {
      case '+':
        return (t, l, s) => a(t, l, s) + b(t, l, s);
      case '-':
        return (t, l, s) => a(t, l, s) - b(t, l, s);
      case '*':
        return (t, l, s) => a(t, l, s) * b(t, l, s);
      case '/':
        return (t, l, s) => {
          const x = a(t, l, s);
          const y = b(t, l, s);
          s?.push(Math.sign(y));
          const r = x / y;
          return Number.isFinite(r) ? r : NaN;
        };
      case '^':
        return (t, l, s) => {
          const r = a(t, l, s) ** b(t, l, s);
          return Number.isFinite(r) ? r : NaN;
        };
      default: {
        const cmp =
          op === '>'
            ? (x: number, y: number) => x > y
            : op === '<'
              ? (x: number, y: number) => x < y
              : op === '>='
                ? (x: number, y: number) => x >= y
                : (x: number, y: number) => x <= y;
        return (t, l, s) => {
          const r = cmp(a(t, l, s), b(t, l, s)) ? 1 : 0;
          s?.push(r);
          return r;
        };
      }
    }
  };

  const buildCall = (fn: string, args: Node[]): Ev => {
    if (fn === 'and' || fn === 'or' || fn === 'xor') {
      const ts = args.map(truth);
      return (t, l, s) => {
        const v = ts.map((f) => f(t, l, s));
        if (fn === 'and') return v.every(Boolean) ? 1 : 0;
        if (fn === 'or') return v.some(Boolean) ? 1 : 0;
        return v[0] !== v[1] ? 1 : 0;
      };
    }
    if (fn === 'not') {
      const a = truth(args[0]!);
      return (t, l, s) => (a(t, l, s) ? 0 : 1);
    }
    if (fn === 'delay') {
      const a = build(args[0]!);
      const d = build(args[1]!)(0, false, null);
      return (t, l, s) => a(t - d, l, s);
    }
    const ev = args.map(build);
    const a = ev[0]!;
    switch (fn) {
      case 'abs':
        return (t, l, s) => {
          const x = a(t, l, s);
          s?.push(x >= 0 ? 1 : 0);
          return Math.abs(x);
        };
      case 'min':
      case 'max':
        return (t, l, s) => {
          let best = 0;
          let bv = ev[0]!(t, l, s);
          for (let i = 1; i < ev.length; i++) {
            const v = ev[i]!(t, l, s);
            if (fn === 'min' ? v < bv : v > bv) {
              bv = v;
              best = i;
            }
          }
          s?.push(best);
          return bv;
        };
      case 'clip':
        return (t, l, s) => {
          const x = a(t, l, s);
          const lo = ev[1]!(t, l, s);
          const hi = ev[2]!(t, l, s);
          const region = x < lo ? 0 : x > hi ? 2 : 1;
          s?.push(region);
          return region === 0 ? lo : region === 2 ? hi : x;
        };
      case 'sign':
      case 'step':
        return (t, l, s) => {
          const x = a(t, l, s);
          const r = fn === 'sign' ? Math.sign(x) : x >= 0 ? 1 : 0;
          s?.push(r);
          return r;
        };
      case 'sqrt':
      case 'ln':
      case 'log10':
        return (t, l, s) => {
          const x = a(t, l, s);
          s?.push(x > 0 ? 1 : x === 0 ? 0 : -1);
          const r = fn === 'sqrt' ? Math.sqrt(x) : fn === 'ln' ? Math.log(x) : Math.log10(x);
          return Number.isFinite(r) ? r : NaN;
        };
      case 'exp':
        return (t, l, s) => Math.exp(a(t, l, s));
      case 'sin':
        return (t, l, s) => Math.sin(a(t, l, s));
      case 'cos':
        return (t, l, s) => Math.cos(a(t, l, s));
      case 'tan':
        return (t, l, s) => {
          const r = Math.tan(a(t, l, s));
          return Number.isFinite(r) ? r : NaN;
        };
      default:
        if (!FUNCTIONS[fn]) return () => NaN;
        return () => NaN;
    }
  };

  const raw = build(spec.root);
  const out = (v: number) => (Number.isNaN(v) ? NaN : logicRoot ? (v !== 0 ? spec.logicHigh : spec.logicLow) : v);
  const ev = (t: number, left: boolean, sig: number[] | null) => out(raw(t, left, sig));

  // Inputs with their cumulative delay (features shift by it).
  const shifted: Array<{ s: SignalEval; shift: number }> = [];
  const collect = (n: Node, shift: number) => {
    switch (n.k) {
      case 'ref': {
        const s = inputs.get(n.id);
        if (s && !shifted.some((x) => x.s === s && x.shift === shift)) shifted.push({ s, shift });
        break;
      }
      case 'neg':
      case 'not':
        collect(n.a, shift);
        break;
      case 'bin':
        collect(n.a, shift);
        collect(n.b, shift);
        break;
      case 'call':
        if (n.fn === 'delay') collect(n.args[0]!, shift + build(n.args[1]!)(0, false, null));
        else for (const a of n.args) collect(a, shift);
        break;
    }
  };
  collect(spec.root, 0);

  const usesT = hasTime(spec.root);
  const scales = shifted.map((x) => x.s.scale ?? x.s.period).filter((v): v is number => v !== undefined && v > 0);
  const scale = scales.length ? Math.min(...scales) : undefined;
  const period = usesT ? undefined : commonPeriod(shifted.map((x) => x.s.period));

  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const result: Feature[] = [];
    if (!(t1 > t0)) return { features: result, truncated: false };

    // 1. Input breakpoints.
    let truncated = false;
    const bp: number[] = [];
    for (const { s, shift } of shifted) {
      const q = s.features(t0 - shift, t1 - shift, maxCount);
      if (q.truncated) truncated = true;
      for (const f of q.features) {
        const t = f.t + shift;
        if (t > t0 && t < t1) bp.push(t);
      }
    }
    if (truncated) return { features: [], truncated: true };
    bp.sort((x, y) => x - y);
    const tol = 1e-14 * Math.max(1, Math.abs(t0), Math.abs(t1));
    const points = [t0];
    for (const t of bp) if (t - points[points.length - 1]! > tol) points.push(t);
    if (t1 - points[points.length - 1]! > tol) points.push(t1);
    else points[points.length - 1] = t1;

    for (let i = 1; i < points.length - 1; i++) {
      const t = points[i]!;
      const L = ev(t, true, null);
      const R = ev(t, false, null);
      result.push({ t, kind: same(L, R) ? 'kink' : 'jump', left: L, right: R });
    }

    // 2./3. Sample each segment.
    const span = t1 - t0;
    let step = spec.resolution ?? (scale !== undefined ? scale / SAMPLES_PER_SCALE : span / 512);
    if (span / step > MAX_SAMPLES) step = span / MAX_SAMPLES;

    for (let i = 0; i + 1 < points.length; i++) {
      scanSegment(points[i]!, points[i + 1]!, step, ev, !logicRoot, result);
      if (result.length > maxCount * 2) break;
    }

    result.sort((x, y) => x.t - y.t);
    if (result.length > maxCount) return { features: result.slice(0, maxCount), truncated: true };
    return { features: result, truncated: false };
  };

  return {
    value: (t) => ev(t, false, null),
    left: (t) => ev(t, true, null),
    features,
    period,
    scale: spec.resolution !== null ? Math.min(scale ?? Infinity, spec.resolution * SAMPLES_PER_SCALE) : scale,
  };
}

function scanSegment(
  a: number,
  b: number,
  step: number,
  ev: (t: number, left: boolean, sig: number[] | null) => number,
  findExtrema: boolean,
  out: Feature[],
) {
  const n = Math.max(2, Math.min(MAX_SAMPLES, Math.ceil((b - a) / step)));
  const ts: number[] = new Array(n + 1);
  const vs: number[] = new Array(n + 1);
  const sigs: string[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const t = i === n ? b : a + ((b - a) * i) / n;
    const sig: number[] = [];
    // Segment ends use one-sided limits (inside the segment).
    vs[i] = ev(t, i === n, sig);
    ts[i] = t;
    sigs[i] = sig.join(',') + (Number.isNaN(vs[i]!) ? 'N' : '');
  }

  const sigAt = (t: number) => {
    const sig: number[] = [];
    const v = ev(t, false, sig);
    return sig.join(',') + (Number.isNaN(v) ? 'N' : '');
  };

  // Continuous switches (abs/clip/min/max corners) can show ~1e-16 differences between the two
  // sides; treat differences below 1e-9 of the segment's magnitude as continuous.
  let mag = 0;
  for (const v of vs) if (Number.isFinite(v)) mag = Math.max(mag, Math.abs(v));
  const close = (x: number, y: number) => same(x, y) || Math.abs(x - y) <= 1e-9 * mag;

  // Switching instants.
  for (let i = 0; i < n; i++) {
    let lo = ts[i]!;
    const hi0 = ts[i + 1]!;
    let sLo = sigs[i]!;
    const sHi = sigs[i + 1]!;
    for (let guard = 0; guard < 8 && sLo !== sHi; guard++) {
      let l = lo;
      let h = hi0;
      for (let k = 0; k < 64 && h - l > 1e-15 * Math.max(1, Math.abs(h)); k++) {
        const m = (l + h) / 2;
        if (m <= l || m >= h) break;
        if (sigAt(m) === sLo) l = m;
        else h = m;
      }
      // The sample at the segment end is a left limit, so a genuine switch lies strictly inside.
      if (h >= hi0) break;
      const L = ev(l, false, null);
      const R = ev(h, false, null);
      if (close(L, R)) {
        const v = (L + R) / 2;
        out.push({ t: h, kind: 'kink', left: v, right: v });
      } else {
        out.push({ t: h, kind: 'jump', left: L, right: R });
      }
      lo = h;
      sLo = sigAt(h);
      if (h >= hi0) break;
    }
  }

  // Local extrema (only inside stretches with an unchanged signature).
  if (!findExtrema) return;
  for (let i = 1; i < n; i++) {
    if (sigs[i - 1] !== sigs[i] || sigs[i] !== sigs[i + 1]) continue;
    const d1 = vs[i]! - vs[i - 1]!;
    const d2 = vs[i + 1]! - vs[i]!;
    if (!(d1 * d2 < 0)) continue;
    const isMax = d1 > 0;
    const t = golden(ts[i - 1]!, ts[i + 1]!, (x) => (isMax ? -1 : 1) * ev(x, false, null));
    const v = ev(t, false, null);
    out.push({ t, kind: isMax ? 'max' : 'min', left: v, right: v });
  }
}

/** Golden-section minimization of f on [a, b]. */
function golden(a: number, b: number, f: (x: number) => number): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let c = b - g * (b - a);
  let d = a + g * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < 80 && b - a > 1e-15 * Math.max(1, Math.abs(b)); i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - g * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + g * (b - a);
      fd = f(d);
    }
  }
  return (a + b) / 2;
}

function same(a: number, b: number): boolean {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function hasTime(n: Node): boolean {
  switch (n.k) {
    case 'time':
      return true;
    case 'neg':
    case 'not':
      return hasTime(n.a);
    case 'bin':
      return hasTime(n.a) || hasTime(n.b);
    case 'call':
      return n.fn === 'delay' ? hasTime(n.args[0]!) : n.args.some(hasTime);
    default:
      return false;
  }
}

/**
 * Least common multiple of periods (null/undefined if any input is aperiodic or the
 * ratios are not close to small rationals). Returns undefined when there are no inputs.
 */
export function commonPeriod(periods: Array<number | undefined>): number | undefined {
  if (periods.length === 0 || periods.some((p) => p === undefined || !(p > 0))) return undefined;
  let L = periods[0]!;
  for (const p of periods.slice(1) as number[]) {
    const r = p / L;
    const frac = rational(r, 1000);
    if (!frac) return undefined;
    const [num, den] = frac;
    // lcm(L, p) with p = L·num/den → L·num/gcd(num, den) = L·num (fraction reduced).
    L = L * num;
    void den;
    if (L > 1e6 * Math.min(...(periods as number[]))) return undefined; // impractically long
  }
  return L;
}

/** Best rational approximation p/q of x with q <= maxDen (relative error < 1e-9). */
function rational(x: number, maxDen: number): [number, number] | null {
  for (let q = 1; q <= maxDen; q++) {
    const p = Math.round(x * q);
    if (p > 0 && Math.abs(p / q - x) <= 1e-9 * x) {
      const g = gcd(p, q);
      return [p / g, q / g];
    }
  }
  return null;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
