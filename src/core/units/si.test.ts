import { describe, expect, it } from 'vitest';
import { formatSI, parseSI } from './si';

describe('parseSI', () => {
  it.each([
    ['50', 50],
    ['50k', 50e3],
    ['2.5 kHz', 2.5e3],
    ['6.667m', 6.667e-3],
    ['1u', 1e-6],
    ['1µs', 1e-6],
    ['3M', 3e6],
    ['-3e-3', -3e-3],
    ['.5', 0.5],
  ])('parses %s', (text, expected) => {
    expect(parseSI(text)?.value).toBeCloseTo(expected, 15);
  });

  it('keeps the unit', () => {
    expect(parseSI('2.5 kHz')).toEqual({ value: 2500, unit: 'Hz' });
  });

  it('resolves a bare unit equal to the expected unit', () => {
    expect(parseSI('5 m', 'm')).toEqual({ value: 5, unit: 'm' });
    expect(parseSI('5 mm', 'm')?.value).toBeCloseTo(5e-3);
  });

  it('rejects a mismatching unit', () => {
    expect(parseSI('5 kV', 'Hz')).toBeNull();
    expect(parseSI('abc')).toBeNull();
    expect(parseSI('')).toBeNull();
  });
});

describe('formatSI', () => {
  it.each([
    [0.006667, 's', '6.667 ms'],
    [0.02, 's', '20 ms'],
    [50, 'Hz', '50 Hz'],
    [2500, 'Hz', '2.5 kHz'],
    [230, 'V', '230 V'],
    [1e-6, 's', '1 µs'],
    [0, 'V', '0 V'],
    [-0.5, 'A', '-500 mA'],
    [999.99999, 'V', '1 kV'],
  ])('formats %d %s', (v, unit, expected) => {
    expect(formatSI(v, unit)).toBe(expected);
  });
});
