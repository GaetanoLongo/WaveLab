/**
 * TikZ / pgfplots export: the figure as LaTeX source (a standalone document or a
 * snippet for \input). Panels become a pgfplots groupplot sharing the time axis;
 * traces are \addplot coordinates sampled exactly (vertical edges kept); unit
 * prefixes, axis titles, log axes, legends and annotations follow the screen.
 * Requires: pgfplots (groupplots library), TikZ arrows.meta.
 */

import { dimensionLabel, resolveAnnotations } from '../plot/annotations';
import { computeLayout, timeTicks, type FigureInput } from '../plot/layout';
import { SYMBOLS, parseMath } from '../plot/mathtext';
import { sampleSignal } from '../plot/sampler';
import { niceTicks } from '../plot/ticks';
import { prefixFactorFor } from '../units/si';

export interface TikzOptions {
  /** Complete document (\documentclass{standalone}) or only the tikzpicture. */
  standalone: boolean;
  /** Samples per trace across the plot width. */
  samples: number;
}

// Unicode symbol → LaTeX math command (from the label markup table).
const TEX_OF = new Map<string, string>();
for (const [name, ch] of Object.entries(SYMBOLS)) if (/^[A-Za-z]+$/.test(name) && ch.trim() && !TEX_OF.has(ch)) TEX_OF.set(ch, `\\${name}`);
TEX_OF.set('°', '^\\circ');
TEX_OF.set('µ', '\\mu');
TEX_OF.set('−', '-');
const ACCENT_TEX: Record<string, string> = { '̂': 'hat', '̄': 'bar', '̅': 'overline', '̇': 'dot', '̈': 'ddot', '̃': 'tilde', '⃗': 'vec' };

function escapeText(s: string): string {
  let out = '';
  for (const ch of s) {
    if ('#$%&_{}'.includes(ch)) out += `\\${ch}`;
    else if (ch === '\\') out += '\\textbackslash{}';
    else if (ch === '~') out += '\\textasciitilde{}';
    else if (ch === '^') out += '\\textasciicircum{}';
    else if (TEX_OF.has(ch)) out += ch === '−' ? '-' : `$${TEX_OF.get(ch)}$`;
    else out += ch;
  }
  // Accented characters: x + combining mark → $\hat{x}$
  return out.replace(/(.)([̂̄̅̇̈̃⃗])/gu, (_m, c: string, mark: string) => `$\\${ACCENT_TEX[mark]}{${c}}$`);
}

/** Label markup (v_{out}, \omega, ^\circ) → LaTeX text-mode source. */
export function texLabel(src: string): string {
  return parseMath(src)
    .map((r) => {
      const t = escapeText(r.text);
      return r.shift === 'sub' ? `\\textsubscript{${t}}` : r.shift === 'sup' ? `\\textsuperscript{${t}}` : t;
    })
    .join('')
    .replace(/\$\$/g, ''); // join adjacent math runs
}

const num = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(7))) : 'nan');
const PX_TO_CM = 2.54 / 96;

export function figureToTikz(input: FigureInput, o: TikzOptions): string {
  const layout = computeLayout(input);
  const th = input.theme;
  const [t0, t1] = layout.xRange;
  const [tf] = prefixFactorFor(Math.max(Math.abs(t0), Math.abs(t1)), 1);
  const xt = timeTicks(layout, input.axes?.x);
  const xs = input.axes?.x;
  const xTitle = xs?.title?.trim() ? xs.title : `${input.xTitle} (${xt.unitLabel})`;

  // Colours.
  const colours = new Map<string, string>();
  const colour = (hex: string) => {
    const h = hex.replace('#', '').toUpperCase();
    if (!colours.has(h)) colours.set(h, `wl${colours.size}`);
    return colours.get(h)!;
  };
  const dashOf = (d: string) => (d === 'dashed' ? 'dashed' : d === 'dotted' ? 'dotted' : d === 'dashdot' ? 'dashdotted' : 'solid');

  const n = Math.max(1, layout.panels.length);
  const widthCm = input.width * PX_TO_CM;
  const heightCm = Math.max(2, (input.height * PX_TO_CM) / n);
  const anns = resolveAnnotations(input.annotations, layout, (id) => input.panels.flatMap((p) => p.traces).find((t) => t.id === id)?.unit);

  const body: string[] = [];
  body.push(
    `\\begin{groupplot}[group style={group size=1 by ${n}, vertical sep=0.35cm, x descriptions at=edge bottom},`,
    `  width=${widthCm.toFixed(2)}cm, height=${heightCm.toFixed(2)}cm, scale only axis=false,`,
    `  xmin=${num(t0 / tf)}, xmax=${num(t1 / tf)}, xlabel={${texLabel(xTitle)}},`,
    `  grid=major, major grid style={line width=0.2pt, draw=gray!35}, tick label style={font=\\small}, label style={font=\\small},`,
    `  scaled ticks=false, legend style={font=\\footnotesize, draw=gray!60}, legend cell align=left]`,
  );

  layout.panels.forEach((pl, idx) => {
    const pin = input.panels[idx];
    const traces = pin?.traces ?? [];
    const units = new Set(traces.map((t) => t.unit));
    const unit = units.size === 1 ? [...units][0]! : '';
    const ys = input.axes?.y?.[pl.id];
    const [lo, hi] = pl.yRange;
    const yt = pl.log ? null : niceTicks(lo, hi, 5, unit, 1e12, { step: ys?.tickStep, decimals: ys?.decimals });
    const [yf] = pl.log ? [1] : prefixFactorFor(Math.max(Math.abs(lo), Math.abs(hi)), 1e12);
    const base = pin?.title ?? (traces.length === 1 ? traces[0]!.name : '');
    const unitLabel = yt?.unitLabel ?? unit;
    const yTitle = ys?.title?.trim() ? ys.title : unitLabel ? (base ? `${base} (${unitLabel})` : unitLabel) : base;
    const opts = [`ymin=${num(lo / yf)}`, `ymax=${num(hi / yf)}`, `ylabel={${texLabel(yTitle)}}`];
    if (pl.log) opts.push('ymode=log');
    const legend = input.showLegend && th.legend !== 'none' && traces.filter((t) => t.showInLegend !== false).length > 1;
    if (legend) opts.push(`legend pos=${th.legend === 'top-left' ? 'north west' : th.legend === 'bottom-left' ? 'south west' : th.legend === 'bottom-right' ? 'south east' : th.legend === 'outside-right' ? 'outer north east' : 'north east'}`);
    body.push(`\\nextgroupplot[${opts.join(', ')}]`);
    for (const tr of traces) {
      const s = sampleSignal(tr.signal, t0, t1, Math.max(50, o.samples));
      const style = `${colour(tr.color)}, line width=${(tr.lineWidth * th.lineScale * 0.75).toFixed(2)}pt, ${dashOf(s.mode === 'envelope' ? 'solid' : tr.dash)}`;
      s.lines.forEach((line, k) => {
        const pts: string[] = [];
        for (let i = 0; i < line.t.length; i++) {
          const v = line.y[i]!;
          if (pl.log && !(v > 0)) continue;
          pts.push(`(${num(line.t[i]! / tf)},${num(v / yf)})`);
        }
        if (!pts.length) return;
        const forget = k > 0 || !legend || tr.showInLegend === false ? ', forget plot' : '';
        body.push(`\\addplot[${style}${forget}] coordinates {`);
        for (let i = 0; i < pts.length; i += 8) body.push(`  ${pts.slice(i, i + 8).join(' ')}`);
        body.push('};');
        if (k === 0 && legend && tr.showInLegend !== false) body.push(`\\addlegendentry{${texLabel(tr.name)}}`);
      });
      if (tr.signal.impulses) body.push(`% ${texLabel(tr.name).replace(/\n/g, ' ')}: ideal impulses (δ) are not exported to TikZ.`);
    }
    // Annotations of this panel, in axis coordinates.
    for (const r of anns.filter((x) => x.panel.id === pl.id)) {
      const a = r.a;
      const c = colour(a.color);
      const lw = (base: number) => (base * (a.width ?? 1)).toFixed(2);
      const P = (t: number, v: number) => `(axis cs:${num(t / tf)},${num(v / yf)})`;
      if (a.kind === 'text') body.push(`\\node[anchor=west, text=${c}, font=\\small] at ${P(a.t0, a.y0)} {${texLabel(a.text)}};`);
      else if (a.kind === 'arrow') {
        body.push(`\\draw[${c}, -{Stealth[length=5pt]}, line width=${lw(0.6)}pt] ${P(a.t0, a.y0)} -- ${P(a.t1, a.y1)};`);
        if (a.text) body.push(`\\node[anchor=${a.t1 > a.t0 ? 'east' : 'west'}, text=${c}, font=\\small] at ${P(a.t0, a.y0)} {${texLabel(a.text)}};`);
      } else if (a.kind === 'dim-t') {
        body.push(`\\draw[${c}, {Bar[]Stealth[length=4pt]}-{Stealth[length=4pt]Bar[]}, line width=${lw(0.5)}pt] ${P(a.t0, a.y0)} -- node[above, font=\\footnotesize] {${texLabel(dimensionLabel(a, r.unit))}} ${P(a.t1, a.y0)};`);
      } else {
        body.push(`\\draw[${c}, {Bar[]Stealth[length=4pt]}-{Stealth[length=4pt]Bar[]}, line width=${lw(0.5)}pt] ${P(a.t0, a.y0)} -- node[right, font=\\footnotesize] {${texLabel(dimensionLabel(a, r.unit))}} ${P(a.t0, a.y1)};`);
      }
    }
  });
  body.push('\\end{groupplot}');

  const defs = [...colours].map(([hex, name]) => `\\definecolor{${name}}{HTML}{${hex}}`);
  const pic = ['\\begin{tikzpicture}', ...defs, ...body, '\\end{tikzpicture}'];
  const header = `% Generated by WaveLab. Requires pgfplots (groupplots library) and the TikZ arrows.meta library.`;
  if (!o.standalone) {
    return [header, '% In the preamble: \\usepackage{pgfplots} \\usepgfplotslibrary{groupplots} \\usetikzlibrary{arrows.meta} \\pgfplotsset{compat=1.17}', ...pic, ''].join('\n');
  }
  return [
    header,
    '\\documentclass[tikz,border=4pt]{standalone}',
    '\\usepackage{pgfplots}',
    '\\usepgfplotslibrary{groupplots}',
    '\\usetikzlibrary{arrows.meta}',
    '\\pgfplotsset{compat=1.17}',
    '\\begin{document}',
    ...pic,
    '\\end{document}',
    '',
  ].join('\n');
}
