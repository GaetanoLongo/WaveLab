import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import { emptyProject, type GeneratorSignalDef, type Project } from '../model/project';
import { compileSignal } from '../signals/compile';
import { parseProjectFile, ProjectFileError, serializeProject } from './project-file';

function sig(
  id: string,
  kind: Parameters<typeof defaultGenerator>[0],
  patch: (d: GeneratorSignalDef) => void = () => {},
): GeneratorSignalDef {
  const d: GeneratorSignalDef = {
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
      const s0 = compileSignal(p.signals[i]! as GeneratorSignalDef);
      const s1 = compileSignal(back.signals[i]! as GeneratorSignalDef);
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

describe('derived signals in project files', () => {
  const withDerived = () => {
    const p = sample();
    p.signals.push({
      id: 'd1',
      name: 'PWM',
      unit: 'V',
      locked: false,
      style: { color: '#D55E00', lineWidth: 1.6, dash: 'solid', visible: true, showInLegend: true },
      kind: 'derived',
      expr: '#{b} > #{a}',
      logicHigh: 15,
      logicLow: 0,
      threshold: 0.5,
      resolution: null,
    });
    return p;
  };

  it('round-trips the expression and logic settings', () => {
    const back = parseProjectFile(serializeProject(withDerived())).project;
    expect(back.signals[3]).toEqual(withDerived().signals[3]);
  });

  it('rejects references to missing signals', () => {
    const f = JSON.parse(serializeProject(withDerived()));
    f.project.signals[3].expr = '#{zzz} + 1';
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/uses a signal that is not in the file/);
  });

  it('rejects circular dependencies', () => {
    const f = JSON.parse(serializeProject(withDerived()));
    f.project.signals.push({ ...f.project.signals[3], id: 'd2', expr: '#{d1} + #{d3}' });
    f.project.signals.push({ ...f.project.signals[3], id: 'd3', expr: '#{d2} * 2' });
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/circular dependency/);
  });

  it('rejects unparsable expressions', () => {
    const f = JSON.parse(serializeProject(withDerived()));
    f.project.signals[3].expr = '#{a} +';
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/expr is invalid: Expression is incomplete/);
  });
});

describe('style and axis settings in project files', () => {
  it('round-trip and validate', () => {
    const p = sample();
    p.figures[0]!.style = { font: 'serif', fontSize: 14, legend: 'bottom-left', gridOpacity: 0.3, background: null, margins: 'wide', lineScale: 1.5 };
    p.figures[0]!.axes = { x: { title: 't', tickStep: 0.005, decimals: 1 }, y: { 'stack-a': { log: true, title: 'V_{a}' } } };
    const back = parseProjectFile(serializeProject(p)).project.figures[0]!;
    expect(back.style).toEqual(p.figures[0]!.style);
    expect(back.axes).toEqual(p.figures[0]!.axes);
    const f = JSON.parse(serializeProject(p));
    f.project.figures[0].style.legend = 'middle';
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/legend is not a valid position/);
  });
});

describe('new generators in project files (M10)', () => {
  it('round-trip exponential, damped, piecewise and bits; reject bad bits', () => {
    const p = sample();
    p.signals = [
      sig('e', 'exponential', (d) => d.generator === 'exponential' && Object.assign(d.params, { initial: 2, final: -1, tau: 0.003 })),
      sig('d', 'damped', (d) => (d.timing.frequency = 200)),
      sig('p', 'piecewise', (d) => d.generator === 'piecewise' && (d.params.interp = 'step')),
      sig('b', 'bits', (d) => d.generator === 'bits' && Object.assign(d.params, { bits: '1101', encoding: 'manchester', repeat: true })),
    ];
    p.figures[0]!.panels[0]!.traces = p.signals.map((s) => ({ signalId: s.id }));
    const back = parseProjectFile(serializeProject(p)).project;
    expect(back.signals).toEqual(p.signals);
    const f = JSON.parse(serializeProject(p));
    f.project.signals[3].params.bits = '10a1';
    expect(() => parseProjectFile(JSON.stringify(f))).toThrow(/only 0 and 1/);
    const g = JSON.parse(serializeProject(p));
    g.project.signals[2].params.points = [[0.01, 0], [0, 1]];
    expect(() => parseProjectFile(JSON.stringify(g))).toThrow(/sorted by time/);
  });
});
