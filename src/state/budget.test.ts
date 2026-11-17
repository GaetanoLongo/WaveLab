import { beforeEach, describe, expect, it } from 'vitest';
import { budgeted, checkBudget, guardSignal, setComputeBudget } from '../core/signals/budget';
import type { SignalEval } from '../core/signals/types';
import { compiled } from './compiled';
import { actions, editor } from './store';

beforeEach(() => actions.newProject());

describe('compute budget', () => {
  it('a runaway evaluation is abandoned, not left to freeze the page; the heavy signal then answers instantly', () => {
    actions.addSignal('triangle', (d) => (d.timing.frequency = 1050));
    const heavy = actions.addDerived((a) => `integral(movavg(${a}, 1e6))`, 1, 'Heavy')!;
    const p = editor.getState().project;
    const sig = compiled(p.signals.find((s) => s.id === heavy)!, p);
    const prev = setComputeBudget(150);
    try {
      let t0 = performance.now();
      const q = sig.features(0, 1); // takes several seconds without a budget
      expect(performance.now() - t0).toBeLessThan(2500);
      expect(q.truncated).toBe(true);
      // Marked heavy: the same request is now answered at once, and values are undefined.
      t0 = performance.now();
      sig.features(0, 1);
      expect(Number.isNaN(sig.value(0.5))).toBe(true);
      expect(performance.now() - t0).toBeLessThan(50);
    } finally {
      setComputeBudget(prev);
    }
  }, 30000);

  it('signals within the budget are unaffected, including after another signal was abandoned', () => {
    actions.addSignal('sine');
    const light = actions.addDerived((a) => `abs(${a})`, 1, 'Light')!;
    const p = editor.getState().project;
    const sig = compiled(p.signals.find((s) => s.id === light)!, p);
    expect(sig.value(0.005)).toBeCloseTo(1, 12);
    expect(sig.features(0, 0.04).truncated).toBe(false);
  });

  it('the status message is raised (deferred) when something is abandoned', async () => {
    actions.addSignal('triangle', (d) => (d.timing.frequency = 1050));
    const heavy = actions.addDerived((a) => `integral(movavg(${a}, 1e6))`, 1, 'Heavy2')!;
    const p = editor.getState().project;
    const sig = compiled(p.signals.find((s) => s.id === heavy)!, p);
    const prev = setComputeBudget(100);
    try {
      sig.features(0, 1);
    } finally {
      setComputeBudget(prev);
    }
    await Promise.resolve();
    expect(editor.getState().notice).toMatch(/too heavy/);
  }, 30000);

  it('a scope bounds many cheap calls as a whole, and a signal that overran is not retried at once', () => {
    let calls = 0;
    const spin = (ms: number) => {
      const t = performance.now();
      while (performance.now() - t < ms) for (let i = 0; i < 128; i++) checkBudget();
    };
    const slow: SignalEval = guardSignal({
      value: () => {
        calls++;
        spin(2);
        return 1;
      },
      features: () => ({ features: [], truncated: false }),
    });
    const t0 = performance.now();
    const r = budgeted(slow, 120, () => {
      let sum = 0;
      for (let i = 0; i < 5000; i++) sum += slow.value(i); // 10 s if left alone
      return sum;
    }, () => -1);
    expect(r).toBe(-1);
    expect(performance.now() - t0).toBeLessThan(1500);
    const before = calls;
    expect(budgeted(slow, 120, () => slow.value(0), () => -2)).toBe(-2); // marked heavy: not tried again
    expect(calls).toBe(before);
  });
});
