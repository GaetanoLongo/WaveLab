/** Minimal stroke icon set (24×24 grid) plus true-shape waveform glyphs. */

import type { ReactNode } from 'react';
import { defaultGenerator } from '../core/model/defaults';
import type { GeneratorKind } from '../core/model/signal-defs';
import { sampleSignal } from '../core/plot/sampler';
import { compileGenerator } from '../core/signals/generator';

const P: Record<string, ReactNode> = {
  newFile: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M12 12v6M9 15h6" />
    </>
  ),
  open: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  save: (
    <>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </>
  ),
  saveAs: (
    <>
      <path d="M13 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v4" />
      <path d="M7 3v5h8M7 21v-6h5M18 15v6M15 18h6" />
    </>
  ),
  undo: (
    <>
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
    </>
  ),
  redo: (
    <>
      <path d="M21 7v6h-6" />
      <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2M14.5 11.5v6M11.5 14.5h6" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  paste: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" opacity="0.35" />
      <path d="M3 3l18 18" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.5-2" />
    </>
  ),
  zoomIn: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M11 8v6M8 11h6" />,
  zoomOut: <path d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3M8 11h6" />,
  fit: <path d="M3 8V3h5M21 8V3h-5M3 16v5h5M21 16v5h-5" />,
  spectrum: <path d="M4 20h17M6 20v-4M10 20V8M14 20v-7M18 20v-3" />,
  axes: <path d="M4 3v17h17M8 16l4-5 3 3 5-7" />,
  magnet: <path d="M6 3v8a6 6 0 0 0 12 0V3M6 7h4M14 7h4" />,
  export: (
    <>
      <path d="M12 3v12M7 8l5-5 5 5" />
      <path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" />
    </>
  ),
  grip: (
    <path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="3" />
  ),
  overlay: <path d="M3 12c3-6 6-6 9 0s6 6 9 0M3 8h18" />,
  stacked: <path d="M3 4h18v6H3zM3 14h18v6H3z" />,
};

export type IconName = keyof typeof P;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}

const glyphCache = new Map<string, string>();

/** Waveform glyph rendered from the real generator (1.5 cycles), so icons match the math. */
/** Glyph parameters per toolbox entry (variant = entry label) on a 0…1.5 time span. */
function glyphDef(kind: GeneratorKind, variant: string) {
  const def = defaultGenerator(kind);
  def.timing.frequency = 1;
  switch (def.generator) {
    case 'pulse':
      def.params = { ...def.params, width: 0.25, rise: 0.05, fall: 0.05 };
      break;
    case 'dc':
      def.params.level = 0.4;
      break;
    case 'sawtooth':
      if (variant === 'Inverted sawtooth') def.params.slope = 'falling';
      break;
    case 'exponential':
      def.params = variant === 'Exponential decay' ? { initial: 1, final: 0, tau: 0.3 } : { initial: 0, final: 1, tau: 0.3 };
      def.timing.delay = 0.1;
      break;
    case 'damped':
      def.timing.frequency = 2.4;
      def.params.tau = 0.55;
      break;
    case 'piecewise':
      def.params.points = [[0, 0], [0.15, 1], [0.45, 1], [0.6, 0], [0.75, 0]];
      break;
    case 'bits':
      def.params = {
        ...def.params,
        bits: '1011',
        bitTime: 0.35,
        encoding: variant === 'RZ' ? 'rz' : variant === 'Manchester' ? 'manchester' : 'nrz',
        ...(variant === 'PWM' ? { bits: '110100110', bitTime: 0.15 } : {}),
      };
      break;
  }
  return def;
}

export function WaveGlyph({ kind, variant = '', size = 28 }: { kind: GeneratorKind; variant?: string; size?: number }) {
  const key = `${kind}|${variant}`;
  let d = glyphCache.get(key);
  if (d === undefined) {
    const def = glyphDef(kind, variant);
    const W = 28;
    const H = 18;
    const { lines } = sampleSignal(compileGenerator(def), 0, 1.5, 40);
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of lines) for (const v of l.y) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
    if (def.generator === 'dc') (lo = -1), (hi = 1);
    const sx = (t: number) => 2 + (t / 1.5) * (W - 4);
    const sy = (v: number) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
    d = lines
      .map((l) => l.t.map((t, i) => `${i ? 'L' : 'M'}${sx(t).toFixed(1)} ${sy(l.y[i]!).toFixed(1)}`).join(''))
      .join('');
    glyphCache.set(key, d);
  }
  return (
    <svg width={size} height={(size * 18) / 28} viewBox="0 0 28 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
