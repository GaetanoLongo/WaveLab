import { beforeEach, describe, expect, it } from 'vitest';
import { parseProjectFile, serializeProject } from '../core/io/project-file';
import type { DerivedSignalDef, GeneratorSignalDef } from '../core/model/project';
import { compiled } from './compiled';
import { actions, canRedo, editor, exprToDisplay, findSignal, isDirty, orderedSignals } from './store';

const st = () => editor.getState();
const g = (id: string | null) => findSignal(st().project, id) as GeneratorSignalDef;

beforeEach(() => actions.newProject());

describe('editor store', () => {
  it('adds signals with unique names, palette colours and selection', () => {
    const a = actions.addSignal('sine');
    const b = actions.addSignal('sine');
    const names = orderedSignals(st().project).map((s) => s.name);
    expect(names).toEqual(['Sine', 'Sine 2']);
    expect(st().selectedId).toBe(b);
    expect(g(a).style.color).not.toBe(g(b).style.color);
  });

  it('fits the view to the first signal', () => {
    actions.setXRange([5, 6]);
    actions.addSignal('square');
    expect(st().view.xRange).toEqual([0, 0.04]);
  });

  it('undo/redo restores documents and selection stays valid', () => {
    const a = actions.addSignal('sine');
    actions.updateGenerator(a, (s) => void (s.timing.frequency = 60));
    expect(g(a).timing.frequency).toBe(60);
    actions.undo();
    expect(g(a).timing.frequency).toBe(50);
    actions.undo();
    expect(st().project.signals).toHaveLength(0);
    expect(st().selectedId).toBeNull();
    actions.redo();
    actions.redo();
    expect(g(a).timing.frequency).toBe(60);
    expect(canRedo(st())).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const a = actions.addSignal('sine');
    actions.updateGenerator(a, (s) => void (s.name = 'X'));
    actions.undo();
    actions.updateGenerator(a, (s) => void (s.name = 'Y'));
    expect(canRedo(st())).toBe(false);
  });

  it('coalesces rapid edits with the same key into one undo step', () => {
    const a = actions.addSignal('square');
    for (const d of [0.4, 0.3, 0.2]) {
      actions.updateGenerator(
        a,
        (s) => {
          if (s.generator === 'square') s.params.duty = d;
        },
        'duty',
      );
    }
    actions.undo();
    const s = g(a);
    expect(s.generator === 'square' && s.params.duty).toBe(0.5);
  });

  it('tracks unsaved changes, including undo back to the saved state', () => {
    expect(isDirty(st())).toBe(false);
    actions.addSignal('sine');
    expect(isDirty(st())).toBe(true);
    actions.markSaved();
    expect(isDirty(st())).toBe(false);
    actions.setMode('stacked');
    expect(isDirty(st())).toBe(true);
    actions.undo();
    expect(isDirty(st())).toBe(false);
  });

  it('view changes are not undoable and do not mark the project dirty', () => {
    actions.addSignal('sine');
    actions.markSaved();
    actions.setXRange([1, 2]);
    expect(isDirty(st())).toBe(false);
    expect(st().past).toHaveLength(1);
  });

  it('locked signals reject edits and deletion but can be hidden/unlocked', () => {
    const a = actions.addSignal('sine');
    actions.toggleLock(a);
    actions.updateGenerator(a, (s) => void (s.name = 'Nope'));
    actions.deleteSignal(a);
    expect(g(a).name).toBe('Sine');
    expect(st().notice).toMatch(/locked/);
    actions.toggleVisible(a);
    expect(g(a).style.visible).toBe(false);
    actions.toggleLock(a);
    actions.deleteSignal(a);
    expect(st().project.signals).toHaveLength(0);
  });

  it('duplicate inserts after the original; copy/paste creates an independent copy', () => {
    const a = actions.addSignal('sine');
    const b = actions.addSignal('square');
    actions.duplicate(a);
    expect(orderedSignals(st().project).map((s) => s.name)).toEqual(['Sine', 'Sine copy', 'Square']);
    actions.copy(b);
    actions.updateGenerator(b, (s) => void (s.timing.frequency = 1000));
    actions.paste();
    const pasted = g(st().selectedId);
    expect(pasted.timing.frequency).toBe(50); // snapshot taken at copy time
    expect(pasted.id).not.toBe(b);
  });

  it('delete selects the neighbour', () => {
    const a = actions.addSignal('sine');
    const b = actions.addSignal('square');
    const c = actions.addSignal('triangle');
    actions.deleteSignal(b);
    expect(st().selectedId).toBe(c);
    actions.deleteSignal(c);
    expect(st().selectedId).toBe(a);
  });

  it('reorders signals', () => {
    const a = actions.addSignal('sine');
    actions.addSignal('square');
    actions.addSignal('triangle');
    actions.reorder(a, 2);
    expect(orderedSignals(st().project).map((s) => s.name)).toEqual(['Square', 'Triangle', 'Sine']);
  });

  it('invert mirrors the waveform around zero', () => {
    const a = actions.addSignal('square');
    actions.updateGenerator(a, (s) => {
      if (s.generator === 'square') Object.assign(s.params, { high: 5, low: 0 });
    });
    actions.invert(a);
    const s = g(a);
    expect(s.generator === 'square' && [s.params.high, s.params.low]).toEqual([-5, 0]);
  });
});

describe('positioning and alignment (M4)', () => {
  it('a drag gesture is one undo step regardless of duration', () => {
    const a = actions.addSignal('sine');
    for (const d of [0.001, 0.002, 0.003]) actions.setDelay(a, d, 'drag:a:1');
    expect(g(a).timing.delay).toBe(0.003);
    actions.undo();
    expect(g(a).timing.delay).toBe(0);
  });

  it('aligns rising edges by moving the delay only', () => {
    const ref = actions.addSignal('square');
    const sig = actions.addSignal('square');
    actions.updateGenerator(ref, (s) => void (s.timing.delay = 0.003));
    actions.updateGenerator(sig, (s) => void (s.timing.phaseDeg = 45));
    actions.setXRange([0, 0.04]);
    const msg = actions.alignFeature(sig, ref, 'rise');
    expect(msg).toMatch(/Aligned/);
    const s = g(sig);
    expect(s.timing.phaseDeg).toBe(45); // phase untouched
    expect(s.timing.frequency).toBe(50); // frequency untouched
    // Rising edges now coincide: net shift equals the reference's (modulo a period).
    const shift = s.timing.delay - 45 / 360 / 50 - 0.003;
    expect(Math.abs(shift - Math.round(shift / 0.02) * 0.02)).toBeLessThan(1e-12);
  });

  it('reports when a feature kind does not exist', () => {
    const ref = actions.addSignal('square');
    const sig = actions.addSignal('sine');
    expect(actions.alignFeature(sig, ref, 'rise')).toMatch(/no rising edges/);
  });

  it('sets a phase difference via the phase parameter (Acceptance Test 2 workflow)', () => {
    const ref = actions.addSignal('sine');
    const sig = actions.addSignal('sine');
    actions.setPhaseDifference(sig, ref, 120);
    const s = g(sig);
    expect(s.timing.phaseDeg).toBeCloseTo(120, 9);
    expect(s.timing.delay).toBe(0);
    expect(s.timing.frequency).toBe(50);
  });

  it('refuses a phase difference between different frequencies', () => {
    const ref = actions.addSignal('sine');
    const sig = actions.addSignal('sine');
    actions.updateGenerator(sig, (s) => void (s.timing.frequency = 60));
    expect(actions.setPhaseDifference(sig, ref, 30)).toMatch(/same frequency/);
  });
});

describe('derived signals (M6)', () => {
  const d = (id: string | null) => findSignal(st().project, id) as DerivedSignalDef;
  const ev = (id: string | null) => compiled(findSignal(st().project, id)!, st().project);

  it('binary operations use the selected signal and the next one; results chain', () => {
    const a = actions.addSignal('sine');
    const b = actions.addSignal('square');
    actions.select(a);
    const diff = actions.addDerived((x, y) => `${x} - ${y}`, 2, 'Difference')!;
    expect(exprToDisplay(st().project, d(diff).expr)).toBe('Sine - Square');
    expect(st().selectedId).toBe(diff);
    const abs = actions.addDerived((x) => `abs(${x})`, 1, 'Abs')!;
    expect(exprToDisplay(st().project, d(abs).expr)).toBe('abs(Difference)');
    expect(ev(abs).value(0.0025)).toBeCloseTo(Math.abs(Math.sin(Math.PI / 4) - 1), 12);
    void b;
  });

  it('expressions use names in the editor and ids in storage (renames are safe)', () => {
    const a = actions.addSignal('sine');
    actions.addSignal('square');
    const x = actions.addDerived((p) => p, 1, 'Expression')!;
    expect(actions.setExpression(x, 'Vout = Sine * 2 + [Square]')).toBeNull();
    expect(d(x).name).toBe('Vout');
    expect(d(x).expr).toMatch(/^#\{s-[^}]+\} \* 2 \+ #\{s-[^}]+\}$/);
    actions.updateGenerator(a, (s) => void (s.name = 'V_{in}'));
    expect(exprToDisplay(st().project, d(x).expr)).toBe('[V_{in}] * 2 + Square');
  });

  it('reports parse errors with positions and refuses cycles / self references', () => {
    actions.addSignal('sine');
    const x = actions.addDerived((p) => p, 1, 'X')!;
    const y = actions.addDerived((p) => `${p} * 2`, 1, 'Y')!; // Y uses X
    expect(actions.setExpression(x, 'Sine + Nope')).toEqual({ message: 'Unknown signal “Nope”', pos: 7 });
    expect(actions.setExpression(x, 'X + 1')?.message).toMatch(/cannot use itself/);
    expect(actions.setExpression(x, 'Y + 1')?.message).toMatch(/circular/);
    void y;
  });

  it('a signal used by others cannot be deleted', () => {
    const a = actions.addSignal('sine');
    actions.addDerived((p) => `abs(${p})`, 1, 'Abs');
    actions.deleteSignal(a);
    expect(findSignal(st().project, a)).toBeDefined();
    expect(st().notice).toMatch(/used by “Abs”/);
  });

  it('editing an input recompiles its dependents', () => {
    const a = actions.addSignal('sine');
    const x = actions.addDerived((p) => `${p} * 10`, 1, 'X')!;
    const before = ev(x);
    expect(before.value(0.005)).toBeCloseTo(10, 12);
    actions.updateGenerator(a, (s) => void (s.timing.frequency = 100));
    const after = ev(x);
    expect(after).not.toBe(before);
    expect(after.value(0.0025)).toBeCloseTo(10, 12);
  });

  it('invert negates analog expressions and swaps logic levels', () => {
    actions.addSignal('sine');
    const x = actions.addDerived((p) => `${p} + 1`, 1, 'X')!;
    actions.invert(x);
    expect(exprToDisplay(st().project, d(x).expr)).toBe('-(Sine + 1)');
    actions.addSignal('triangle');
    const c = actions.addDerived((p, q) => `${p} > ${q}`, 2, 'C')!;
    actions.updateSignal(c, (s) => void (s.kind === 'derived' && ((s.logicHigh = 5), (s.logicLow = 0))));
    actions.invert(c);
    expect([d(c).logicHigh, d(c).logicLow]).toEqual([0, 5]);
  });

  it('derived signals are not moved by setDelay', () => {
    actions.addSignal('sine');
    const x = actions.addDerived((p) => p, 1, 'X')!;
    const before = st().project;
    actions.setDelay(x, 0.003);
    expect(st().project).toBe(before);
  });

  it('Acceptance Test 7 (complete): operation chain survives save and reload', () => {
    const a = actions.addSignal('sine');
    actions.addSignal('square');
    actions.select(a);
    actions.addDerived((x, y) => `${x} - ${y}`, 2, 'Difference');
    const abs = actions.addDerived((x) => `abs(${x})`, 1, 'Abs')!;
    actions.addSignal('triangle');
    actions.select(a);
    const cmp = actions.addDerived((x, y) => `${x} > ${y}`, 2, 'PWM')!;
    const text = serializeProject(st().project, actions.savedView());
    const { project, view } = parseProjectFile(text);
    actions.loadProject(project, view);
    expect(st().project.signals.map((s) => s.name)).toEqual(['Sine', 'Square', 'Difference', 'Abs', 'Triangle', 'PWM']);
    for (const id of [abs, cmp]) {
      for (const t of [0.0011, 0.0063, 0.0137]) expect(ev(id).value(t)).toBe(compiledFromText(text, id, t));
    }
  });
});

function compiledFromText(text: string, id: string, t: number): number {
  const { project } = parseProjectFile(text);
  return compiled(project.signals.find((s) => s.id === id)!, project).value(t);
}
