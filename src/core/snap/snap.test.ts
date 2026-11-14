import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import type { GeneratorDef } from '../model/signal-defs';
import { compileGenerator } from '../signals/generator';
import { fundamentalPhaseDeg, phaseDifferenceDeg, phaseForDifference, wrapDeg } from '../signals/phase';
import { cycleStarts, snapPoints, zeroCrossings, type SnapPoint } from './points';
import { computeSnap, gridPoints } from './snap';

const all = { edges: true, zeros: true, peaks: true, cycles: false };

describe('snap points', () => {
  it('finds exact zero crossings of a sine (incl. offset)', () => {
    const d = defaultGenerator('sine');
    if (d.generator === 'sine') d.params.offset = 0.5; // zeros where sin = −0.5
    const z = zeroCrossings(compileGenerator(d), 0, 0.02);
    expect(z).toHaveLength(2);
    expect(z[0]!.t).toBeCloseTo((7 / 12) * 0.02, 12); // 210°
    expect(z[0]!.rising).toBe(false);
    expect(z[1]!.t).toBeCloseTo((11 / 12) * 0.02, 12); // 330°
  });

  it('treats a sign-changing jump as a zero crossing', () => {
    const z = zeroCrossings(compileGenerator(defaultGenerator('square')), 0.001, 0.021);
    expect(z.map((x) => x.t)).toEqual([0.01, 0.02].map((t) => expect.closeTo(t, 12)));
  });

  it('labels edges and peaks', () => {
    const sq = snapPoints(compileGenerator(defaultGenerator('square')), 0, 0.015, all);
    expect(sq.filter((p) => p.group === 'edge').map((p) => p.label)).toEqual(['Rising edge', 'Falling edge']);
    const sn = snapPoints(compileGenerator(defaultGenerator('sine')), 0, 0.02, all);
    expect(sn.filter((p) => p.group === 'peak').map((p) => p.label)).toEqual(['Positive peak', 'Negative peak']);
  });

  it('computes cycle starts from phase and delay', () => {
    const c = cycleStarts({ frequency: 50, phaseDeg: 90, delay: 0.001 }, 0, 0.04);
    // base = 1 ms − 5 ms = −4 ms → 16 ms, 36 ms
    expect(c).toEqual([0.016, 0.036].map((t) => expect.closeTo(t, 12)));
  });
});

describe('computeSnap', () => {
  const targets: SnapPoint[] = [
    { t: 0, group: 'time-zero', label: 't = 0' },
    { t: 0.0031, group: 'edge', label: 'Rising edge' },
    { t: 0.005, group: 'peak', label: 'Positive peak' },
  ].sort((a, b) => a.t - b.t) as SnapPoint[];

  it('snaps a compatible anchor within the threshold', () => {
    const r = computeSnap(0.003, [{ t: 0, group: 'edge', label: 'Rising edge' }], targets, 0.0002);
    expect(r.delta).toBeCloseTo(0.0031, 15);
    expect(r.target?.label).toBe('Rising edge');
  });

  it('does not snap incompatible groups (edge → peak)', () => {
    const r = computeSnap(0.0049, [{ t: 0, group: 'edge', label: 'Rising edge' }], targets, 0.0002);
    expect(r.target).toBeNull();
    expect(r.delta).toBe(0.0049);
  });

  it('t = 0 and grid lines accept any anchor', () => {
    const r = computeSnap(0.0101, [{ t: -0.01, group: 'peak', label: 'p' }], targets, 0.0002);
    expect(r.target?.group).toBe('time-zero');
    expect(r.delta).toBeCloseTo(0.01, 15);
  });

  it('prefers like-for-like pairs when equally close', () => {
    const tg: SnapPoint[] = [
      { t: 0.01, group: 'edge', label: 'Falling edge · B' },
      { t: 0.01, group: 'edge', label: 'Rising edge · B' },
    ];
    const r = computeSnap(0.0099, [{ t: 0, group: 'edge', label: 'Rising edge' }], tg, 0.0005);
    expect(r.target?.label).toBe('Rising edge · B');
  });

  it('among periodic copies, the guide uses the pair nearest the pointer', () => {
    const anchors: SnapPoint[] = [0, 0.02, 0.04, 0.06].map((t) => ({ t, group: 'edge' as const, label: 'Rising edge' }));
    const tg: SnapPoint[] = [0.01, 0.03, 0.05, 0.07].map((t) => ({ t, group: 'edge' as const, label: 'Rising edge · B' }));
    const r = computeSnap(0.0099, anchors, tg, 0.0005, undefined, 0.031);
    expect(r.delta).toBeCloseTo(0.01, 15);
    expect(r.target?.t).toBe(0.03);
  });

  it('phase snapping quantizes to the phase step', () => {
    // 50 Hz, 15° step = 0.8333 ms; dragging +1.7 ms → 2 steps → −30° (lag)
    const r = computeSnap(0.0017, [], [], 0.0002, { seconds: 15 / 360 / 50, degrees: 15 });
    expect(r.delta).toBeCloseTo(2 * (15 / 360 / 50), 15);
    expect(r.label).toBe('Phase shift -30°');
  });

  it('builds grid lines', () => {
    expect(gridPoints(0, 0.01, 0.0025).map((p) => p.t)).toEqual([0, 0.0025, 0.005, 0.0075, 0.01]);
  });
});

describe('fundamental phase', () => {
  const sine = (): GeneratorDef => defaultGenerator('sine');

  it('sine/cosine/triangle/square conventions', () => {
    expect(fundamentalPhaseDeg(sine())).toBe(0);
    expect(fundamentalPhaseDeg(defaultGenerator('cosine'))).toBe(90);
    expect(fundamentalPhaseDeg(defaultGenerator('triangle'))).toBe(-90);
    expect(fundamentalPhaseDeg(defaultGenerator('square'))).toBe(0); // 50 % square ~ sine
  });

  it('includes phase parameter and delay', () => {
    const s = sine();
    s.timing.phaseDeg = 30;
    s.timing.delay = 1 / 50 / 12; // 30° later
    expect(fundamentalPhaseDeg(s)).toBeCloseTo(0, 9);
  });

  it('phase difference and the phase needed for a target difference', () => {
    const a = sine();
    const b = defaultGenerator('cosine');
    expect(phaseDifferenceDeg(a, b)).toBe(-90);
    const p = phaseForDifference(a, b, 120)!;
    a.timing.phaseDeg = p;
    expect(phaseDifferenceDeg(a, b)).toBeCloseTo(120, 9);
  });

  it('is undefined for different frequencies', () => {
    const b = sine();
    b.timing.frequency = 60;
    expect(phaseDifferenceDeg(sine(), b)).toBeNull();
  });

  it('wraps to (−180, 180]', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(720)).toBe(0);
  });

  it('a square wave fundamental matches the sine it was built around (sampled check)', () => {
    // Fourier check: correlate the square with sin/cos over one period.
    const sq = defaultGenerator('square');
    if (sq.generator === 'square') sq.params.duty = 0.3;
    sq.timing.delay = 0.0013;
    const s = compileGenerator(sq);
    let a = 0;
    let b = 0;
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const t = (i / N) * 0.02;
      a += s.value(t) * Math.sin(2 * Math.PI * 50 * t);
      b += s.value(t) * Math.cos(2 * Math.PI * 50 * t);
    }
    const theta = (Math.atan2(b, a) * 180) / Math.PI;
    expect(fundamentalPhaseDeg(sq)!).toBeCloseTo(theta, 1);
  });
});
