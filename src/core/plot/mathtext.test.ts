import { describe, expect, it } from 'vitest';
import { parseMath, plainText } from './mathtext';

describe('math markup', () => {
  it('plain text passes through as one run', () => {
    expect(parseMath('Time (ms)')).toEqual([{ text: 'Time (ms)', shift: 'none' }]);
  });

  it('single-character and grouped subscripts', () => {
    expect(parseMath('V_out')).toEqual([
      { text: 'V', shift: 'none' },
      { text: 'o', shift: 'sub' },
      { text: 'ut', shift: 'none' },
    ]);
    expect(parseMath('V_{out} (V)')).toEqual([
      { text: 'V', shift: 'none' },
      { text: 'out', shift: 'sub' },
      { text: ' (V)', shift: 'none' },
    ]);
  });

  it('superscripts and symbols', () => {
    expect(parseMath('I_{RMS}^2')).toEqual([
      { text: 'I', shift: 'none' },
      { text: 'RMS', shift: 'sub' },
      { text: '2', shift: 'sup' },
    ]);
    expect(plainText('\\omega t + \\varphi')).toBe('ω t + φ');
    expect(plainText('\\Delta t')).toBe('Δ t');
    expect(parseMath('e^{-t/\\tau}')).toEqual([
      { text: 'e', shift: 'none' },
      { text: '-t/τ', shift: 'sup' },
    ]);
  });

  it('^\\circ is a degree sign', () => {
    expect(parseMath('90^\\circ')).toEqual([{ text: '90°', shift: 'none' }]);
    expect(parseMath('90^{\\circ}')).toEqual([{ text: '90°', shift: 'none' }]);
  });

  it('escapes and malformed input are shown literally', () => {
    expect(plainText('a\\_b')).toBe('a_b');
    expect(plainText('trailing_')).toBe('trailing_');
    expect(plainText('V_{open')).toBe('V_{open');
    expect(plainText('\\unknown x')).toBe('\\unknown x');
  });

  it('a symbol can be a subscript argument', () => {
    expect(parseMath('V_\\alpha')).toEqual([
      { text: 'V', shift: 'none' },
      { text: 'α', shift: 'sub' },
    ]);
  });
});

describe('math markup: LaTeX compatibility (F3)', () => {
  it('ignores $ delimiters and shows font-command arguments', () => {
    expect(parseMath('$v_{\\mathrm{out}}$')).toEqual([
      { text: 'v', shift: 'none' },
      { text: 'out', shift: 'sub' },
    ]);
    expect(plainText('V_{\\text{rms}}')).toBe('Vrms');
    expect(plainText('\\mathbf{B} field')).toBe('B field');
  });
  it('renders accents with combining characters', () => {
    expect(plainText('\\hat{v}')).toBe('v\u0302');
    expect(plainText('\\bar{x}_1')).toBe('x\u03041');
    expect(plainText('\\vec E')).toBe('E\u20d7');
    expect(plainText('\\overline{AB}')).toBe('A\u0305B\u0305');
  });
  it('keeps an escaped dollar sign', () => {
    expect(plainText('price \\$5')).toBe('price $5');
  });
});
