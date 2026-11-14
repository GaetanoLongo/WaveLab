/** Default trace colours: colour-blind-friendly, readable on white and in print. */
export const SIGNAL_PALETTE = [
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#009E73', // green
  '#CC79A7', // reddish purple
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#7A5195', // violet
  '#1C2330', // near black
] as const;

export function paletteColor(index: number): string {
  return SIGNAL_PALETTE[index % SIGNAL_PALETTE.length]!;
}
