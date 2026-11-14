import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import { emptyProject, type Project, type SignalDef } from '../model/project';
import { compileSignal } from '../signals/compile';
import { parseProjectFile, ProjectFileError, serializeProject } from './project-file';

function sig(id: string, kind: Parameters<typeof defaultGenerator>[0], patch: (d: SignalDef) => void = () => {}): SignalDef {
  const d: SignalDef = {
    id,
    name: id,
    unit: 'V',
    locked: false,
    style: { color: '#0072B2', lineWidth: 1.6, dash: 'solid', visible: true, showInLegend: true },
    kind: 'generator',
    ...defaultGenerator(kind),
  };
  patch(d);
  return d;
}

function sample(): Project {
  const p = emptyProject('Inverter study');
  p.signals = [
    sig('a', 'square', (d) => {
      d.name = 'V_{gate}';
      d.timing.delay = 0.001;
      if (d.generator === 'square') d.params.duty = 0.3;
      d.style.dash = 'dashed';
    }),
    sig('b', 'sine', (d) => {
      d.timing.phaseDeg = 120;
      d.locked = true;
      d.window = { mode: 'cycles', start: 0.002, cycles: 3, outside: 'undefined' };
    }),
    sig('c', 'pulse', (d) => {
      if (d.generator === 'pulse') Object.assign(d.params, { rise: 1e-4, fall: 2e-4 });
      d.style.visible = false;
    }),
  ];
  p.figures[0]!.panels[0]!.traces = [{ signalId: 'c' }, { signalId: 'a' }, { signalId: 'b' }];
  p.figures[0]!.mode = 'stacked';
  p.figures[0]!.stylePreset = 'minimal';
  return p;
}

describe('project file round trip (Acceptance Test 7, generator part)', () => {
  it('reconstructs definitions, order, styling and view exactly', () => {
    const p = sample();
    const view = { xRange: [0.001, 0.031] as [number, number], yRanges: { 'stack-a': [-2, 2] as [number, number] } };
    const back = parseProjectFile(serializeProject(p, view));
    expect(back.project.signals).toEqual(p.signals);
    expect(back.project.figures[0]!.panels[0]!.traces).toEqual(p.figures[0]!.panels[0]!.traces);
    expect(back.project.figures[0]!.mode).toBe('stacked');
    expect(back.project.figures[0]!.stylePreset).toBe('minimal');
    expect(back.project.name).toBe('Inverter study');
    expect(back.view).toEqual(view);
  });

  it('reloaded signals evaluate identically', () => {
    const p = sample();
    const back = parseProjectFile(serializeProject(p)).project;
    for (let i = 0; i < p.signals.length; i++) {
      const s0 = compileSignal(p.signals[i]!);
      const s1 = compileSignal(back.signals[i]!);
      for (const t of [0, 0.0013, 0.0071, 0.0199, 0.05]) {
        expect(Object.is(s1.value(t), s0.value(t))).toBe(true);
      }
    }
  });

  it('stores definitions, not samples', () => {
    const text = serializeProject(sample());
    expect(text).toContain('"generator": "square"');
    expect(text.length).toBeLessThan(6000);
  });
});

describe('project file validation', () => {
  const good = () => JSON.parse(serializeProject(sample()));

  it('rejects non-WaveLab JSON and bad JSON', () => {
    expect(() => parseProjectFile('{"a":1}')).toThrow(/not a WaveLab project/);
    expect(() => parseProjectFile('{nope')).toThrow(ProjectFileError);
  });

  it('refuses files from a newer schema with a clear message', () => {
    const f = good();
    f.schemaVersion = 99;
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/newer WaveLab/);
  });

  it('reports the path of an invalid field', () => {
    const f = good();
    f.project.signals[1].timing.frequency = -5;
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow('signals[1].timing.frequency must be a positive number.');
    const g = good();
    g.project.signals[0].params.duty = 2;
    expect(() => parseProjectFile(JSON.stringify(g))).toThrow(/duty must be between 0 and 1/);
  });

  it('repairs the order list: drops dangling references, appends unlisted signals', () => {
    const f = good();
    f.project.figures[0].panels[0].traces = [{ signalId: 'zzz' }, { signalId: 'b' }];
    const p = parseProjectFile(JSON.stringify(f)).project;
    expect(p.figures[0]!.panels[0]!.traces.map((t) => t.signalId)).toEqual(['b', 'a', 'c']);
  });

  it('rejects duplicate ids', () => {
    const f = good();
    f.project.signals[1].id = 'a';
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/Duplicate signal id/);
  });
});
