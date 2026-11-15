import { describe, expect, it } from 'vitest';
import { defaultGenerator } from '../model/defaults';
import { LIGHT_TECHNICAL, panelsForGroups, type TraceInput } from '../plot/layout';
import { compileGenerator } from '../signals/generator';
import { figureToTikz, texLabel } from './tikz';

describe('TikZ export', () => {
  it('converts label markup to LaTeX', () => {
    expect(texLabel('v_{out} (V)')).toBe('v\\textsubscript{out} (V)');
    expect(texLabel('\\omega t')).toBe('$\\omega$ t');
    expect(texLabel('90^\\circ')).toBe('90$^\\circ$');
    expect(texLabel('50% & #1')).toBe('50\\% \\& \\#1');
    expect(texLabel('\\hat{v}')).toBe('$\\hat{v}$');
  });

  it('writes a groupplot with one panel per stacked signal, ms time axis, coordinates and annotations', () => {
    const tr = (id: string, kind: 'sine' | 'square'): TraceInput => ({
      id, name: id === 'a' ? 'v_{in}' : 'v_{out}', signal: compileGenerator(defaultGenerator(kind)), color: id === 'a' ? '#0072B2' : '#D55E00',
      lineWidth: 1.6, dash: 'solid', unit: 'V', showInLegend: true,
    });
    const traces = [tr('a', 'sine'), tr('b', 'square')];
    const tex = figureToTikz(
      {
        width: 800, height: 500, panels: panelsForGroups('stacked', [{ id: 'g', traces }], {}), xRange: [0, 0.04], xTitle: 'Time',
        showLegend: true, theme: LIGHT_TECHNICAL,
        annotations: [{ id: 'x', kind: 'dim-t', on: 'b', t0: 0, t1: 0.01, y0: 0.5, y1: 0.5, text: '', color: '#1c2330' }],
      },
      { standalone: true, samples: 200 },
    );
    expect(tex).toContain('\\documentclass[tikz,border=4pt]{standalone}');
    expect(tex).toContain('group size=1 by 2');
    expect(tex).toContain('xmin=0, xmax=40');
    expect(tex).toContain('xlabel={Time (ms)}');
    expect(tex).toContain('ylabel={v\\textsubscript{out} (V)}');
    expect((tex.match(/\\nextgroupplot/g) ?? []).length).toBe(2);
    expect(tex).toContain('\\definecolor{wl0}{HTML}{0072B2}');
    // Square wave: vertical edge at 10 ms kept as two points with the same x.
    expect(tex).toMatch(/\(10,1\) \(10,-1\)/);
    expect(tex).toContain('node[above, font=\\footnotesize] {$\\Delta$t = 10 ms}');
    expect(tex.trim().endsWith('\\end{document}')).toBe(true);
  });
});
