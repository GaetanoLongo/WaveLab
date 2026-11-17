import { describe, expect, it } from 'vitest';
import { fitLabel, textWidthPx } from './annotations';

describe('annotation label fitting', () => {
  it('keeps a label that fits', () => {
    expect(fitLabel("0x48 'H'", 200, 12)).toBe("0x48 'H'");
  });
  it('drops the leading word when the full label is too wide', () => {
    const w = textWidthPx("'H'", 12);
    expect(fitLabel("0x48 'H'", w + 1, 12)).toBe("'H'");
  });
  it('truncates a single long word with an ellipsis, or shows nothing when there is no room', () => {
    expect(fitLabel('Overshoot', 40, 12)).toMatch(/…$/);
    expect(fitLabel('Overshoot', 5, 12)).toBe('');
  });
});
