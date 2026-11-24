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

import { constValue, FUNCTIONS, isLogic, type Node } from '../expr/parse';
import { lowpassOf } from './lowpass';
import { filter2Of } from './filter2';
import {
  derivativeOf,
  finiteRiseDerivativeOf,
  integralOf,
  sampleHoldOf,
  movingAverageOf,
  movingRmsOf,
  numericDerivativeOf,
} from './operators';
import { checkBudget } from './budget';
import { withPeriodicCache } from './periodic-cache';
import { leftValue, MAX_SAMPLES, same, scanSegment } from './scan';
import { DEFAULT_MAX_FEATURES, type Feature, type FeatureQuery, type Impulse, type SignalEval } from './types';

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

const SAMPLES_PER_SCALE = 64;


const NAN_SIGNAL: SignalEval = { value: () => NaN, features: () => ({ features: [], truncated: false }) };

export function compileDerived(spec: DerivedSpec, inputs: Map<string, SignalEval>): SignalEval {
  const thr = spec.threshold;
  const logicRoot = isLogic(spec.root);
  const warnings = new Set<string>();

  // Calculus operators work on whole signals: their argument becomes a signal of its own.
  const opCache = new Map<Node, SignalEval>();
  const operatorSignal = (n: Extract<Node, { k: 'call' }>): SignalEval => {
    const cached = opCache.get(n);
    if (cached) return cached;
    const argNode = n.args[0]!;
    // An operator asks its argument for the features of a different window on every evaluation.
    // Separate signals get a per-period feature cache (state/compiled); an argument written inline
    // (lowpass(movavg(x, …), …)) gets the same here, so nesting inside one expression costs no more
    // than chaining separate signals.
    const x =
      argNode.k === 'ref'
        ? (inputs.get(argNode.id) ?? NAN_SIGNAL)
        : withPeriodicCache(compileDerived({ ...spec, root: argNode, logicHigh: 1, logicLow: 0 }, inputs));
    for (const w of x.warnings ?? []) warnings.add(w);
    const c = (i: number, dflt: number) => (n.args[i] ? constValue(n.args[i]!) : dflt);
    let sig: SignalEval;
    switch (n.fn) {
      case 'integral':
        sig = integralOf(x, c(1, 0), c(2, 0));
        break;
      case 'deriv':
        sig = derivativeOf(x);
        break;
      case 'dfinite':
        sig = finiteRiseDerivativeOf(x, c(1, NaN));
        break;
      case 'dnum':
        sig = numericDerivativeOf(x, c(1, NaN));
        break;
      case 'movavg':
        sig = movingAverageOf(x, c(1, NaN));
        break;
      case 'rms':
        sig = movingRmsOf(x, c(1, NaN));
        break;
      case 'lowpass2':
      case 'bandpass2':
      case 'highpass2':
        sig = filter2Of(x, n.fn === 'lowpass2' ? 'low' : n.fn === 'bandpass2' ? 'band' : 'high', c(1, NaN), c(2, NaN));
        break;
      case 'zoh':
        sig = sampleHoldOf(x, c(1, NaN));
        break;
      case 'lowpass':
        sig = lowpassOf(x, c(1, NaN), n.args.length >= 4 ? { t0: c(2, 0), y0: c(3, 0) } : undefined);
        break;
      default:
        sig = NAN_SIGNAL;
    }
    for (const w of sig.warnings ?? []) warnings.add(w);
    sig = withPeriodicCache(sig);
    opCache.set(n, sig);
    return sig;
  };

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
      case 'call': {
        if (FUNCTIONS[n.fn]?.operator) {
          const s = operatorSignal(n);
          return (t, left) => (left ? leftValue(s, t) : s.value(t));
        }
        return buildCall(n.fn, n.args);
      }
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
      case 'max': {
        const isMin = fn === 'min';
        const n = ev.length;
        return (t, l, s) => {
          let best = 0;
          let bv = a(t, l, s);
          for (let i = 1; i < n; i++) {
            const f = ev[i]!;
            const v = f(t, l, s);
            if (isMin ? v < bv : v > bv) {
              bv = v;
              best = i;
            }
          }
          if (s) s.push(best);
          return bv;
        };
      }
      case 'quantize': {
        const q = build(args[1]!)(0, false, null);
        return (t, l, s) => {
          const k = Math.round(a(t, l, s) / q);
          if (s) s.push(k); // the level index is the state: steps are located by bisection
          return k * q;
        };
      }
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
        if (FUNCTIONS[n.fn]?.operator) {
          const s = operatorSignal(n);
          if (!shifted.some((x) => x.s === s && x.shift === shift)) shifted.push({ s, shift });
        } else if (n.fn === 'delay') collect(n.args[0]!, shift + build(n.args[1]!)(0, false, null));
        else for (const a of n.args) collect(a, shift);
        break;
    }
  };
  collect(spec.root, 0);

  // Impulses (from deriv) pass through linear operations only.
  type ImpFn = (a: number, b: number) => Impulse[];
  const scaleImp = (f: ImpFn, k: number): ImpFn => (a, b) => f(a, b).map((i) => ({ t: i.t, weight: i.weight * k }));
  const impulsesOf = (n: Node): ImpFn | null => {
    switch (n.k) {
      case 'ref': {
        const s = inputs.get(n.id);
        return s?.impulses ? (a, b) => s.impulses!(a, b) : null;
      }
      case 'neg': {
        const f = impulsesOf(n.a);
        return f ? scaleImp(f, -1) : null;
      }
      case 'bin': {
        const fa = impulsesOf(n.a);
        const fb = impulsesOf(n.b);
        if (!fa && !fb) return null;
        if (n.op === '+' || n.op === '-') {
          const k = n.op === '-' ? -1 : 1;
          return (a, b) => [...(fa?.(a, b) ?? []), ...(fb ? scaleImp(fb, k)(a, b) : [])].sort((p, q) => p.t - q.t);
        }
        if (n.op === '*' || n.op === '/') {
          const ca = constValue(n.a);
          const cb = constValue(n.b);
          if (fa && Number.isFinite(cb)) return scaleImp(fa, n.op === '*' ? cb : 1 / cb);
          if (fb && n.op === '*' && Number.isFinite(ca)) return scaleImp(fb, ca);
        }
        warnings.add('Impulses (ideal edges of a derivative) cannot pass through this operation; only the finite part is shown. Use dfinite() or dnum() for a finite representation.');
        return null;
      }
      case 'call': {
        if (FUNCTIONS[n.fn]?.operator) {
          const s = operatorSignal(n);
          return s.impulses ? (a, b) => s.impulses!(a, b) : null;
        }
        if (n.fn === 'delay') {
          const f = impulsesOf(n.args[0]!);
          const d = constValue(n.args[1]!);
          return f ? (a, b) => f(a - d, b - d).map((i) => ({ t: i.t + d, weight: i.weight })) : null;
        }
        if (n.args.some((x) => impulsesOf(x))) {
          warnings.add(`Impulses (ideal edges of a derivative) cannot pass through ${n.fn}(); only the finite part is shown.`);
        }
        return null;
      }
      case 'not':
        if (impulsesOf(n.a)) warnings.add('Impulses cannot pass through a logic operation.');
        return null;
      default:
        return null;
    }
  };
  const rootImpulses = logicRoot ? null : impulsesOf(spec.root);

  const usesT = hasTime(spec.root);
  const scales = shifted.map((x) => x.s.scale ?? x.s.period).filter((v): v is number => v !== undefined && v > 0);
  const scale = scales.length ? Math.min(...scales) : undefined;
  const period = usesT ? undefined : commonPeriod(shifted.map((x) => x.s.period));

  // Expression that is just one signal or one operator: its features are already exact.
  const direct =
    !logicRoot && spec.root.k === 'ref'
      ? inputs.get(spec.root.id)
      : spec.root.k === 'call' && FUNCTIONS[spec.root.fn]?.operator
        ? operatorSignal(spec.root)
        : undefined;

  // Piecewise-constant output: logic results, or arithmetic on piecewise-constant inputs
  // (e.g. gate signals, pole and phase voltages of a converter).
  const pcExpr = (n: Node): boolean => {
    if (isLogic(n)) return true;
    switch (n.k) {
      case 'num':
      case 'const':
        return true;
      case 'time':
        return false;
      case 'ref':
        return !!inputs.get(n.id)?.piecewiseConstant;
      case 'neg':
        return pcExpr(n.a);
      case 'not':
        return true;
      case 'bin':
        return pcExpr(n.a) && pcExpr(n.b);
      case 'call':
        if (FUNCTIONS[n.fn]?.operator) return !!operatorSignal(n).piecewiseConstant;
        if (n.fn === 'delay') return pcExpr(n.args[0]!);
        if (n.fn === 'sign' || n.fn === 'quantize') return true;
        return n.args.every(pcExpr);
    }
  };
  const piecewiseConstant = logicRoot || pcExpr(spec.root);
  // All inputs piecewise constant (and no t): the value can only change at input
  // breakpoints, so no sampling is needed between them.
  const onlyBreakpoints = !usesT && shifted.length > 0 && shifted.every((x) => !!x.s.piecewiseConstant);

  // Small cache of recent queries: a signal used by several others (a gate feeding three
  // voltages…) is asked for the same interval many times while drawing.
  const memo = new Map<string, FeatureQuery>();
  const features = (t0: number, t1: number, maxCount = DEFAULT_MAX_FEATURES): FeatureQuery => {
    const key = `${t0}|${t1}|${maxCount}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const r = computeFeatures(t0, t1, maxCount);
    if (memo.size >= 24) memo.delete(memo.keys().next().value!);
    memo.set(key, r);
    return r;
  };

  const computeFeatures = (t0: number, t1: number, maxCount: number): FeatureQuery => {
    if (direct) return direct.features(t0, t1, maxCount);
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
    // ends[i]: the last breakpoint merged into points[i]. Events closer than `tol` form one
    // cluster: its left limit is taken at the first time and its right limit after the last,
    // so a jump 1e-15 s after a kink is not lost.
    const ends = [t0];
    for (const t of bp) {
      if (t - points[points.length - 1]! > tol) {
        points.push(t);
        ends.push(t);
      } else ends[ends.length - 1] = t;
    }
    if (t1 - points[points.length - 1]! > tol) {
      points.push(t1);
      ends.push(t1);
    } else {
      points[points.length - 1] = t1;
      ends[ends.length - 1] = t1;
    }

    // 2./3. Sample each segment.
    const span = t1 - t0;
    let step = spec.resolution ?? (scale !== undefined ? scale / SAMPLES_PER_SCALE : span / 512);
    if (span / step > MAX_SAMPLES) step = span / MAX_SAMPLES;

    for (let i = 1; i < points.length - 1; i++) {
      checkBudget();
      const t = points[i]!;
      const tEnd = ends[i]!;
      let L = ev(t, true, null);
      let R = ev(tEnd, false, null);
      if (same(L, R)) {
        // A breakpoint of a delayed input is f.t + shift; evaluating the input at (t − shift)
        // can land one ulp on the wrong side of its edge, so an exact one-sided limit can
        // miss a real jump (a delayed gate edge became a "kink" and the step was lost).
        // Probe a hair on each side as well; a difference beyond rounding noise is a jump.
        const dlt = Math.max(1e-15, 32 * Number.EPSILON * Math.abs(t));
        const Lp = ev(t - dlt, false, null);
        const Rp = ev(t + dlt, false, null);
        const scale = Math.max(Math.abs(Lp), Math.abs(Rp), 1e-300);
        if (Number.isFinite(Lp) && Number.isFinite(Rp) && Math.abs(Rp - Lp) > 1e-9 * scale) {
          L = Lp;
          R = Rp;
        }
      }
      if (!same(L, R)) {
        result.push({ t, kind: 'jump', left: L, right: R });
        continue;
      }
      if (onlyBreakpoints) continue; // constant on both sides: not a feature
      // Continuous breakpoint: an extremum if the value falls (or rises) on both sides.
      const d = Math.min(step / 8, (t - points[i - 1]!) / 4, (points[i + 1]! - t) / 4);
      const a = ev(t - d, false, null);
      const b = ev(t + d, false, null);
      const kind = a < R && b < R ? 'max' : a > R && b > R ? 'min' : 'kink';
      result.push({ t, kind, left: L, right: R });
    }

    for (let i = 0; !onlyBreakpoints && i + 1 < points.length; i++) {
      scanSegment(ends[i]!, points[i + 1]!, step, ev, !logicRoot, result);
      if (result.length > maxCount * 2) break;
    }

    result.sort((x, y) => x.t - y.t);
    if (result.length > maxCount) return { features: result.slice(0, maxCount), truncated: true };
    return { features: result, truncated: false };
  };

  return {
    impulses: rootImpulses ?? undefined,
    warnings: [...warnings],
    value: (t) => ev(t, false, null),
    // Left limit: evaluate a hair before t. Inputs' own jumps are handled by their left limits,
    // but switching instants created *inside* the expression (comparator crossings) are only
    // known to ~1e-15 by bisection, so evaluating exactly at t could land after the switch.
    left: (t) => ev(t - Math.max(1e-13, Math.abs(t) * 1e-13), true, null),
    features,
    period,
    piecewiseConstant,
    scale: spec.resolution !== null ? Math.min(scale ?? Infinity, spec.resolution * SAMPLES_PER_SCALE) : scale,
  };
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
