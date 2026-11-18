import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import { compileGenerator } from '../signals/generator';
import { rangeOfBounded } from './range';

describe('rangeOfBounded', () => {
  it('sees the peak of a long imported table (found by the workflow screenshots: 5 V data was drawn in −1…1)', () => {
    const d = defaultGenerator('piecewise');
    if (d.generator !== 'piecewise') throw new Error('kind');
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < 1200; i++) pts.push([i * 1e-5, i < 200 ? 0 : 5 * (1 - Math.exp(-(i * 1e-5 - 2e-3) / 1.5e-3))]);
    d.params.points = pts;
    d.params.repeat = false;
    const s = compileGenerator(d);
    const r = rangeOfBounded(s, 0, 0.0123)!;
    expect(r[0]).toBeCloseTo(0, 9);
    expect(r[1]).toBeCloseTo(pts[1199]![1], 6);
  });
  it('a table of 100 000 points is still scanned in a fraction of a second', () => {
    const d = defaultGenerator('piecewise');
    if (d.generator !== 'piecewise') throw new Error('kind');
    d.params.points = Array.from({ length: 100000 }, (_, i) => [i * 1e-6, Math.sin(i / 3000) * (1 + i / 1e5)] as [number, number]);
    d.params.repeat = false;
    const s = compileGenerator(d);
    const t0 = performance.now();
    const r = rangeOfBounded(s, 0, 0.1)!;
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(r[1]).toBeGreaterThan(1.9);
  });
});
