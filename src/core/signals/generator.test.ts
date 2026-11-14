import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileGenerator } from './generator';
import { isFallingEdge, isRisingEdge } from './types';

const T50 = 0.02;

function sine(phaseDeg = 0, overrides: Partial<GeneratorDef['timing']> = {}): GeneratorDef {
  return {
    generator: 'sine',
    timing: { frequency: 50, phaseDeg, delay: 0, ...overrides },
    window: { mode: 'infinite' },
    params: { amplitude: 1, offset: 0 },
  };
}

describe('Acceptance Test 1 — 50 Hz square wave, 230 V, 50 % duty', () => {
  // Amplitude 230 V (zero-to-peak), offset 0 → high = +230 V, low = −230 V.
  const def: GeneratorDef = {
    generator: 'square',
    timing: { frequency: 50, phaseDeg: 0, delay: 0 },
    window: { mode: 'infinite' },
    params: { high: 230, low: -230, duty: 0.5 },
  };
  const s = compileGenerator(def);

  it('has a period of 20 ms', () => {
    expect(s.period).toBeCloseTo(0.02, 15);
  });

  it('transitions exactly every 10 ms, alternating rising/falling', () => {
    const { features } = s.features(0, 0.04);
    expect(features.map((f) => f.t)).toEqual(
      [0, 0.01, 0.02, 0.03, 0.04].map((t) => expect.closeTo(t, 12)),
    );
    expect(features.map((f) => (isRisingEdge(f) ? 'R' : isFallingEdge(f) ? 'F' : '?'))).toEqual([
      'R', 'F', 'R', 'F', 'R',
    ]);
    for (const f of features) {
      expect(Math.abs(f.right - f.left)).toBe(460);
    }
  });

  it('has the correct levels between transitions', () => {
    expect(s.value(0.005)).toBe(230);
    expect(s.value(0.015)).toBe(-230);
    expect(s.value(0.0249)).toBe(230);
    expect(s.value(-0.005)).toBe(-230);
  });
});

describe('Acceptance Test 2 — 120° phase displacement at 50 Hz', () => {
  const a = compileGenerator(sine(0));
  const b = compileGenerator(sine(120));
  const shift = 120 / 360 / 50; // 6.667 ms

  it('120° at 50 Hz equals 6.667 ms', () => {
    expect(shift * 1000).toBeCloseTo(6.667, 3);
  });

  it('B leads A by 6.667 ms: B(t) = A(t + 6.667 ms)', () => {
    for (const t of [0, 0.001, 0.0037, 0.0123, 0.0199, 0.5]) {
      expect(b.value(t)).toBeCloseTo(a.value(t + shift), 12);
    }
  });

  it('positive peaks are displaced by exactly 6.667 ms (B earlier)', () => {
    const pa = a.features(0, T50).features.find((f) => f.kind === 'max')!;
    const pb = b.features(0, T50).features.find((f) => f.kind === 'max')!;
    // A peaks at 5 ms; B peaks 6.667 ms earlier, i.e. at −1.667 ms ≡ 18.333 ms in [0, 20 ms].
    expect(pa.t).toBeCloseTo(0.005, 12);
    expect(pb.t).toBeCloseTo(0.005 - shift + T50, 12);
  });
});

describe('timing conventions', () => {
  it('positive delay shifts right', () => {
    const a = compileGenerator(sine());
    const d = compileGenerator(sine(0, { delay: 0.003 }));
    expect(d.value(0.0042)).toBeCloseTo(a.value(0.0012), 12);
  });

  it('cosine leads sine by 90°', () => {
    const c = compileGenerator({ ...defaultGenerator('cosine') });
    const s90 = compileGenerator(sine(90));
    for (const t of [0, 0.0031, 0.017]) expect(c.value(t)).toBeCloseTo(s90.value(t), 12);
  });
});

describe('shapes', () => {
  it('triangle: min at cycle start, max at half period, linear between', () => {
    const s = compileGenerator(defaultGenerator('triangle'));
    expect(s.value(0)).toBeCloseTo(-1, 12);
    expect(s.value(0.005)).toBeCloseTo(0, 12);
    expect(s.value(0.01)).toBeCloseTo(1, 12);
    const kinds = s.features(0, 0.02).features.map((f) => f.kind);
    expect(kinds).toEqual(['min', 'max', 'min']);
  });

  it('rising sawtooth jumps down at period boundaries; falling jumps up', () => {
    const r = compileGenerator(defaultGenerator('sawtooth'));
    const fr = r.features(0.001, 0.021).features;
    expect(fr).toHaveLength(1);
    expect(fr[0]!.t).toBeCloseTo(0.02, 12);
    expect(isFallingEdge(fr[0]!)).toBe(true);
    expect(r.value(0.01)).toBeCloseTo(0, 12);

    const fdef = defaultGenerator('sawtooth');
    if (fdef.generator === 'sawtooth') fdef.params.slope = 'falling';
    const f = compileGenerator(fdef);
    expect(isRisingEdge(f.features(0.001, 0.021).features[0]!)).toBe(true);
    expect(f.value(0.001)).toBeCloseTo(0.9, 12);
  });

  it('trapezoidal pulse follows SPICE timing (rise, flat width, fall)', () => {
    const s = compileGenerator({
      generator: 'pulse',
      timing: { frequency: 100, phaseDeg: 0, delay: 0 }, // T = 10 ms
      window: { mode: 'infinite' },
      params: { high: 5, low: 0, width: 0.002, rise: 0.001, fall: 0.0005 },
    });
    expect(s.value(0.0005)).toBeCloseTo(2.5, 12);
    expect(s.value(0.002)).toBe(5);
    expect(s.value(0.00325)).toBeCloseTo(2.5, 12);
    expect(s.value(0.005)).toBe(0);
    const ts = s.features(0, 0.0099).features.map((f) => f.t);
    expect(ts).toEqual([0, 0.001, 0.003, 0.0035].map((t) => expect.closeTo(t, 12)));
  });

  it('ideal pulse has vertical edges', () => {
    const s = compileGenerator(defaultGenerator('pulse')); // 50 Hz, 4 ms, no rise/fall
    const f = s.features(0, 0.019).features;
    expect(f.map((x) => x.kind)).toEqual(['jump', 'jump']);
    expect(f[1]!.t).toBeCloseTo(0.004, 12);
  });

  it('degenerate duty cycles collapse to constants', () => {
    const d0 = defaultGenerator('square');
    if (d0.generator === 'square') d0.params.duty = 0;
    expect(compileGenerator(d0).features(0, 1).features).toHaveLength(0);
    expect(compileGenerator(d0).value(0.003)).toBe(-1);
  });

  it('DC is constant and not periodic', () => {
    const s = compileGenerator(defaultGenerator('dc'));
    expect(s.value(123)).toBe(1);
    expect(s.period).toBeUndefined();
  });
});

describe('windows', () => {
  it('cycles window: N full cycles from local start, zero outside', () => {
    const def = sine();
    def.window = { mode: 'cycles', start: 0, cycles: 2, outside: 'zero' };
    def.timing.delay = 0.01;
    const s = compileGenerator(def);
    expect(s.value(0.005)).toBe(0);
    expect(s.value(0.015)).toBeCloseTo(1, 12); // 5 ms into the first cycle
    expect(s.value(0.051)).toBe(0); // after 2 cycles (ends at 50 ms)
    expect(s.period).toBeUndefined();
    const f = s.features(0, 0.06).features;
    expect(f[0]!.t).toBeCloseTo(0.01, 12);
    expect(f[f.length - 1]!.t).toBeCloseTo(0.05, 12);
  });

  it('undefined outside → NaN and jump edges at the window boundaries', () => {
    const def = defaultGenerator('square');
    def.window = { mode: 'interval', start: 0.005, end: 0.025, outside: 'undefined' };
    const s = compileGenerator(def);
    expect(s.value(0)).toBeNaN();
    expect(s.value(0.006)).toBe(1);
    const f = s.features(-1, 1).features;
    expect(f[0]!.t).toBeCloseTo(0.005, 12);
    expect(f[0]!.left).toBeNaN();
    expect(f[0]!.right).toBe(1);
    const last = f[f.length - 1]!;
    expect(last.t).toBeCloseTo(0.025, 12);
    expect(last.left).toBe(1); // 25 ms is inside a high half-cycle (20–30 ms)
    expect(last.right).toBeNaN();
  });

  it('window ending exactly on a jump uses the left limit', () => {
    const def = defaultGenerator('square');
    def.window = { mode: 'cycles', start: 0, cycles: 1, outside: 'zero' };
    const f = compileGenerator(def).features(0, 0.03).features;
    const end = f[f.length - 1]!;
    expect(end.t).toBeCloseTo(0.02, 12);
    expect(end.left).toBe(-1);
    expect(end.right).toBe(0);
  });
});

describe('feature queries', () => {
  it('stay exact far from t = 0', () => {
    const s = compileGenerator(defaultGenerator('square'));
    const f = s.features(1000, 1000.02).features;
    expect(f.map((x) => x.t)).toEqual([1000, 1000.01, 1000.02].map((t) => expect.closeTo(t, 9)));
  });

  it('truncate when the count limit is exceeded', () => {
    const def = defaultGenerator('square');
    def.timing.frequency = 1e6;
    const q = compileGenerator(def).features(0, 1, 1000);
    expect(q.truncated).toBe(true);
    expect(q.features).toHaveLength(1000);
  });
});
