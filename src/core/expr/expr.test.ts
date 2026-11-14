import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { rangeOf } from '../plot/range';
import { compileDerived, commonPeriod, type DerivedSpec } from '../signals/derived';
import { compileGenerator } from '../signals/generator';
import type { SignalEval } from '../signals/types';
import { ExprError, isLogic, nameToken, parseExpr, print, refsOf, splitAssignment, storedRef } from './parse';

const names: Record<string, string> = { A: 'a', B: 'b', 'Sine 2': 's2', V_out: 'vo' };
const resolve = (n: string) => names[n] ?? null;
const byId: Record<string, string> = Object.fromEntries(Object.entries(names).map(([k, v]) => [v, k]));
const show = (src: string) => print(parseExpr(src, resolve), (id) => nameToken(byId[id]!));

describe('expression parser', () => {
  it('respects precedence and prints minimal parentheses', () => {
    expect(show('A + B * 2')).toBe('A + B * 2');
    expect(show('(A + B) * 2')).toBe('(A + B) * 2');
    expect(show('A - (B - 1)')).toBe('A - (B - 1)');
    expect(show('-A^2')).toBe('-A^2');
    expect(show('(-A)^2')).toBe('(-A)^2');
    expect(show('A > B && B < 1 || !A')).toBe('A > B && B < 1 || !A');
  });

  it('accepts SI-prefixed numbers', () => {
    const n = parseExpr('delay(A, 1m) * 2k', resolve);
    expect(n.k === 'bin' && n.b.k === 'num' && n.b.v).toBe(2000);
    expect(print(n, storedRef)).toBe('delay(#{a}, 1m) * 2k');
  });

  it('resolves bracketed names and stores ids', () => {
    const n = parseExpr('[Sine 2] + V_out', resolve);
    expect([...refsOf(n)]).toEqual(['s2', 'vo']);
    expect(print(n, storedRef)).toBe('#{s2} + #{vo}');
    expect(show('[Sine 2] + V_out')).toBe('[Sine 2] + V_out');
    expect(print(parseExpr('#{s2} * 3', resolve), storedRef)).toBe('#{s2} * 3');
  });

  it('reports errors with positions', () => {
    const err = (src: string) => {
      try {
        parseExpr(src, resolve);
      } catch (e) {
        return [(e as ExprError).message, (e as ExprError).pos];
      }
      return null;
    };
    expect(err('A + C')).toEqual(['Unknown signal “C”', 4]);
    expect(err('A +')).toEqual(['Expression is incomplete', 3]);
    expect(err('abs(A, B)')).toEqual(['abs() takes 1 argument', 0]);
    expect(err('foo(A)')).toEqual(['Unknown function “foo”', 0]);
    expect(err('delay(A, B)')?.[0]).toMatch(/constant time/);
    expect(err('A == B')?.[0]).toMatch(/Equality comparison is not supported/);
    expect(err('(A')?.[0]).toBe('Expected “)”');
  });

  it('splits "Name = expression"', () => {
    expect(splitAssignment('Vout = Vin + Vref')).toEqual({ name: 'Vout', expr: ' Vin + Vref' });
    expect(splitAssignment('[P out] = A*B')).toEqual({ name: 'P out', expr: ' A*B' });
    expect(splitAssignment('A >= B')).toEqual({ name: null, expr: 'A >= B' });
  });

  it('knows which expressions are logic', () => {
    expect(isLogic(parseExpr('A > B', resolve))).toBe(true);
    expect(isLogic(parseExpr('and(A, B)', resolve))).toBe(true);
    expect(isLogic(parseExpr('A + B', resolve))).toBe(false);
  });
});

// --- derived signal engine ---------------------------------------------------------

function gen(patch: (d: GeneratorDef) => void, kind: GeneratorDef['generator'] = 'sine'): SignalEval {
  const d = defaultGenerator(kind);
  patch(d);
  return compileGenerator(d);
}

function derived(src: string, inputs: Record<string, SignalEval>, extra: Partial<DerivedSpec> = {}): SignalEval {
  const map = new Map(Object.entries(inputs));
  const root = parseExpr(src, (n) => (map.has(n) ? n : null));
  return compileDerived({ root, logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null, ...extra }, map);
}

describe('Acceptance Test 3 — adding two sines of equal frequency and amplitude', () => {
  // A = 10 sin(ωt), B = 10 sin(ωt + 60°)  →  A + B = 2·10·cos(30°)·sin(ωt + 30°) = 17.3205 sin(ωt + 30°)
  const A = gen((d) => d.generator === 'sine' && Object.assign(d.params, { amplitude: 10 }));
  const B = gen((d) => {
    if (d.generator === 'sine') d.params.amplitude = 10;
    d.timing.phaseDeg = 60;
  });
  const S = derived('A + B', { A, B });
  const expectedAmp = 20 * Math.cos(Math.PI / 6);

  it('has the expected amplitude (exact extrema, not sampled)', () => {
    const r = rangeOf(S, 0, 0.02)!;
    expect(r[1]).toBeCloseTo(expectedAmp, 9);
    expect(r[0]).toBeCloseTo(-expectedAmp, 9);
  });

  it('has the expected phase: peak at ωt = 60°, i.e. t = T/6', () => {
    const peak = S.features(0, 0.02).features.find((f) => f.kind === 'max')!;
    expect(peak.t).toBeCloseTo(0.02 / 6, 9);
    expect(S.period).toBeCloseTo(0.02, 15);
  });
});

describe('Acceptance Test 5 — PWM by comparison', () => {
  // Carrier: 1 kHz triangle ±1. Reference: 50 Hz sine, amplitude 0.8 (m = 0.8).
  const carrier = gen((d) => (d.timing.frequency = 1000), 'triangle');
  const ref = gen((d) => d.generator === 'sine' && (d.params.amplitude = 0.8));
  const pwm = derived('Ref > Carrier', { Ref: ref, Carrier: carrier }, { logicHigh: 15, logicLow: 0 });
  const { features } = pwm.features(0, 0.02);
  const edges = features.filter((f) => f.kind === 'jump');

  it('switches exactly where reference and carrier intersect', () => {
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) expect(Math.abs(ref.value(e.t) - carrier.value(e.t))).toBeLessThan(1e-9);
  });

  it('switching frequency equals the carrier frequency (2 edges per carrier period)', () => {
    expect(edges.length).toBe(40); // 20 carrier periods in 20 ms
    const rising = edges.filter((e) => e.right > e.left).length;
    expect(rising).toBe(20);
  });

  it('uses the configured logic levels', () => {
    expect(new Set(edges.flatMap((e) => [e.left, e.right]))).toEqual(new Set([0, 15]));
    expect(pwm.period).toBeCloseTo(0.02, 15);
  });

  it('duty cycle follows the reference: (1 + m·sin)/2 averaged per carrier period', () => {
    // Integrate the PWM over the carrier period around the reference peak (t ≈ 5 ms).
    const t0 = 0.005 - 0.0005;
    const t1 = 0.005 + 0.0005;
    const inside = pwm.features(t0, t1).features.filter((f) => f.kind === 'jump');
    let high = 0;
    let last = t0;
    let state = pwm.value(t0) > 0;
    for (const e of inside) {
      if (state) high += e.t - last;
      last = e.t;
      state = e.right > 0;
    }
    if (state) high += t1 - last;
    // Expected: the period average of (1 + m·sin ωt)/2 over 72°…108° = (1 + 0.8·0.98363)/2 = 0.89345.
    // Natural-sampling PWM (comparison with a sine) matches this to first order only, so allow ±0.5 %.
    const avgSin = (Math.cos((72 * Math.PI) / 180) - Math.cos((108 * Math.PI) / 180)) / ((36 * Math.PI) / 180);
    expect(Math.abs(high / (t1 - t0) - (1 + 0.8 * avgSin) / 2)).toBeLessThan(0.005);
  });
});

describe('derived engine details', () => {
  const sq = gen(() => {}, 'square');
  const sine = gen(() => {});

  it('keeps input discontinuities exact (left/right limits)', () => {
    const d = derived('Sq * 2 + 1', { Sq: sq });
    const f = d.features(0.001, 0.019).features.filter((x) => x.kind === 'jump');
    expect(f).toHaveLength(1);
    expect(f[0]!.t).toBeCloseTo(0.01, 12);
    expect([f[0]!.left, f[0]!.right]).toEqual([3, -1]);
  });

  it('abs() and clip() produce exact corners', () => {
    const a = derived('abs(S)', { S: sine });
    const mins = a.features(0.001, 0.019).features.filter((x) => x.kind === 'kink' || x.kind === 'min');
    expect(mins.some((m) => Math.abs(m.t - 0.01) < 1e-12)).toBe(true);
    const c = derived('clip(S, -0.5, 0.5)', { S: sine });
    const corners = c.features(0, 0.02).features.filter((x) => x.kind === 'kink').map((x) => x.t);
    // sin = 0.5 at 30° and 150° → 1.6667 ms and 8.3333 ms
    expect(corners.some((t) => Math.abs(t - 0.02 / 12) < 1e-12)).toBe(true);
    expect(corners.some((t) => Math.abs(t - (5 * 0.02) / 12) < 1e-12)).toBe(true);
  });

  it('delay() shifts values and features', () => {
    const d = derived('delay(Sq, 3m)', { Sq: sq });
    expect(d.value(0.0125)).toBe(sq.value(0.0095));
    const e = d.features(0.001, 0.019).features.filter((x) => x.kind === 'jump').map((x) => x.t);
    expect(e[0]).toBeCloseTo(0.003, 12);
    expect(e[1]).toBeCloseTo(0.013, 12);
  });

  it('logic of analog inputs uses the threshold', () => {
    const d = derived('and(Sq, S)', { Sq: sq, S: sine }, { threshold: 0.5 });
    // Both above 0.5 when the square is high (0–10 ms) and sin > 0.5 (1.667–8.333 ms).
    expect(d.value(0.005)).toBe(1);
    expect(d.value(0.0012)).toBe(0);
    const e = d.features(0, 0.02).features.filter((x) => x.kind === 'jump').map((x) => x.t);
    expect(e[0]).toBeCloseTo(0.02 / 12, 12);
  });

  it('division by zero gives undefined (NaN) instead of huge values', () => {
    const d = derived('1 / S', { S: sine });
    expect(d.value(0)).toBeNaN();
  });

  it('time-based expressions work', () => {
    const d = derived('sin(2*pi*50*t)', {});
    expect(d.value(0.005)).toBeCloseTo(1, 12);
    const max = d.features(0, 0.02).features.find((f) => f.kind === 'max')!;
    expect(max.t).toBeCloseTo(0.005, 9);
    expect(d.period).toBeUndefined();
  });

  it('commonPeriod finds the LCM of commensurate periods', () => {
    expect(commonPeriod([0.02, 0.001])).toBeCloseTo(0.02, 15);
    expect(commonPeriod([1 / 50, 1 / 60])).toBeCloseTo(0.1, 12);
    expect(commonPeriod([1, Math.SQRT2])).toBeUndefined();
    expect(commonPeriod([0.02, undefined])).toBeUndefined();
  });
});
