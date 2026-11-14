import { beforeEach, describe, expect, it } from 'vitest';
import { actions, canRedo, editor, findSignal, isDirty, orderedSignals } from './store';

const st = () => editor.getState();

beforeEach(() => actions.newProject());

describe('editor store', () => {
  it('adds signals with unique names, palette colours and selection', () => {
    const a = actions.addSignal('sine');
    const b = actions.addSignal('sine');
    const names = orderedSignals(st().project).map((s) => s.name);
    expect(names).toEqual(['Sine', 'Sine 2']);
    expect(st().selectedId).toBe(b);
    expect(findSignal(st().project, a)!.style.color).not.toBe(findSignal(st().project, b)!.style.color);
  });

  it('fits the view to the first signal', () => {
    actions.setXRange([5, 6]);
    actions.addSignal('square');
    expect(st().view.xRange).toEqual([0, 0.04]);
  });

  it('undo/redo restores documents and selection stays valid', () => {
    const a = actions.addSignal('sine');
    actions.updateSignal(a, (s) => void (s.timing.frequency = 60));
    expect(findSignal(st().project, a)!.timing.frequency).toBe(60);
    actions.undo();
    expect(findSignal(st().project, a)!.timing.frequency).toBe(50);
    actions.undo();
    expect(st().project.signals).toHaveLength(0);
    expect(st().selectedId).toBeNull();
    actions.redo();
    actions.redo();
    expect(findSignal(st().project, a)!.timing.frequency).toBe(60);
    expect(canRedo(st())).toBe(false);
  });

  it('a new edit clears the redo stack', () => {
    const a = actions.addSignal('sine');
    actions.updateSignal(a, (s) => void (s.name = 'X'));
    actions.undo();
    actions.updateSignal(a, (s) => void (s.name = 'Y'));
    expect(canRedo(st())).toBe(false);
  });

  it('coalesces rapid edits with the same key into one undo step', () => {
    const a = actions.addSignal('square');
    for (const d of [0.4, 0.3, 0.2]) {
      actions.updateSignal(
        a,
        (s) => {
          if (s.generator === 'square') s.params.duty = d;
        },
        'duty',
      );
    }
    actions.undo();
    const s = findSignal(st().project, a)!;
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
    actions.updateSignal(a, (s) => void (s.name = 'Nope'));
    actions.deleteSignal(a);
    expect(findSignal(st().project, a)!.name).toBe('Sine');
    expect(st().notice).toMatch(/locked/);
    actions.toggleVisible(a);
    expect(findSignal(st().project, a)!.style.visible).toBe(false);
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
    actions.updateSignal(b, (s) => void (s.timing.frequency = 1000));
    actions.paste();
    const pasted = findSignal(st().project, st().selectedId)!;
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
    actions.updateSignal(a, (s) => {
      if (s.generator === 'square') Object.assign(s.params, { high: 5, low: 0 });
    });
    actions.invert(a);
    const s = findSignal(st().project, a)!;
    expect(s.generator === 'square' && [s.params.high, s.params.low]).toEqual([-5, 0]);
  });
});
