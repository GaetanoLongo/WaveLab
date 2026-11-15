import { describe, expect, it } from 'vitest';
import { parseExpr } from '../expr/parse';
import { defaultGenerator } from '../model/defaults';
import { compileDerived } from '../signals/derived';
import { compileGenerator } from '../signals/generator';
import { LIGHT_TECHNICAL } from './layout';
import { eyeScene, xyPoints, xyScene } from './views';

describe('XY and eye views', () => {
  it('sine vs cosine is a circle of radius A', () => {
    const s = compileGenerator(defaultGenerator('sine'));
    const c = compileGenerator(defaultGenerator('cosine'));
    const pts = xyPoints(s, c, 0, 0.02, 500);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(1, 12);
    const sc = xyScene({ x: { signal: s, name: 'x', unit: 'V' }, y: { signal: c, name: 'y', unit: 'V' }, t0: 0, t1: 0.02, width: 500, height: 400, theme: LIGHT_TECHNICAL, color: '#000000', equal: true });
    expect(sc.items.some((i) => i.type === 'path')).toBe(true);
  });

  it('ideal PRBS: eye fully open; through a low-pass: partly closed', () => {
    const p = compileGenerator(defaultGenerator('prbs')); // 0/1, 100 µs bits
    const open = eyeScene({ signal: p, name: 'p', unit: 'V', ui: 1e-4, t0: 0, traces: 120, width: 600, height: 400, theme: LIGHT_TECHNICAL, color: '#000000' });
    expect(open.height).toBeCloseTo(1, 12);
    const map = new Map([['P', p]]);
    const f = compileDerived({ root: parseExpr('lowpass2(P, 3k, 0.6)', (n) => (map.has(n) ? n : null)), logicHigh: 1, logicLow: 0, threshold: 0.5, resolution: null }, map);
    const closed = eyeScene({ signal: f, name: 'f', unit: 'V', ui: 1e-4, t0: 0, traces: 120, width: 600, height: 400, theme: LIGHT_TECHNICAL, color: '#000000' });
    expect(closed.height).toBeGreaterThan(0);
    expect(closed.height).toBeLessThan(0.95);
  });
});
