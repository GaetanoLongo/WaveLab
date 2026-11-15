/**
 * PNG / SVG / PDF export. All three start from the same Scene the screen uses,
 * built at the export size without on-screen decorations (selection halo, guides).
 */

import type { Scene } from '../../core/plot/scene';
import { buildFigure, panelsForGroups, resolveTheme, type FigureInput, type PlotTheme, type TraceInput } from '../../core/plot/layout';
import { figureToTikz } from '../../core/export/tikz';
import { sceneToSvg } from '../../core/plot/svg';
import { compiled } from '../../state/compiled';
import { actions, activeFigure, editor, figureGroups, orderedSignals, viewOf } from '../../state/store';
import { gridColumns } from '../../core/model/project';
import { composeScenes } from '../../core/plot/scene';
import { downloadBlob } from '../fileio';

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'csv' | 'tex';
export type PageSize = 'plot' | 'A4' | 'A3' | 'Letter' | 'custom';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  /** PNG: 1, 2 or 4. */
  scale: number;
  transparent: boolean;
  page: PageSize;
  /** Custom page size in mm. */
  pageW: number;
  pageH: number;
  orientation: 'portrait' | 'landscape';
  /** PDF: scale the plot to fit the page margins (otherwise 96 dpi actual size). */
  fit: boolean;
  fileName: string;
  /** Draw the measurement cursors into the exported figure. */
  includeCursors: boolean;
  /** The current figure, or all figures as a grid (one image). */
  content: 'figure' | 'grid';
  /** CSV: number of uniformly spaced samples over the visible time range. */
  csvSamples: number;
  /** CSV: add the exact edge/corner times of all signals (a jump gives two rows: before and after). */
  csvEdges: boolean;
  /** TikZ: a complete standalone document (else only the tikzpicture). */
  tikzStandalone: boolean;
}

export const DEFAULT_EXPORT: Omit<ExportOptions, 'fileName'> = {
  format: 'png',
  width: 1000,
  height: 600,
  scale: 2,
  transparent: false,
  page: 'plot',
  pageW: 160,
  pageH: 100,
  orientation: 'landscape',
  fit: true,
  includeCursors: false,
  content: 'figure',
  csvSamples: 1001,
  csvEdges: true,
  tikzStandalone: true,
};

const PAGE_MM: Record<'A4' | 'A3' | 'Letter', [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  Letter: [215.9, 279.4],
};
const MM_TO_PT = 72 / 25.4;
const PX_TO_PT = 0.75; // 96 dpi
const MARGIN_MM = 10;

/** Scene of the current project at the export size (no selection halo). */
/** Scene of the current figure, or of all figures as a grid, at the export size. */
export function buildExportScene(width: number, height: number, transparent: boolean, includeCursors = false, content: 'figure' | 'grid' = 'figure'): Scene {
  const st = editor.getState();
  if (content === 'grid' && st.project.figures.length > 1) {
    const figs = st.project.figures;
    const cols = gridColumns(figs.length, st.project.grid);
    const rows = Math.ceil(figs.length / cols);
    const cw = width / cols;
    const ch = height / rows;
    const cells = figs.map((f, i) => ({
      scene: buildFigureScene(f.id, cw, ch, transparent, includeCursors),
      x: (i % cols) * cw,
      y: Math.floor(i / cols) * ch,
    }));
    return composeScenes(cells, width, height, transparent ? null : cells[0]!.scene.background);
  }
  return buildFigureScene(st.activeFigureId, width, height, transparent, includeCursors);
}

function buildFigureScene(figId: string, width: number, height: number, transparent: boolean, includeCursors: boolean): Scene {
  return buildFigure(figureInputFor(figId, width, height, transparent, includeCursors)).scene;
}

/** Figure description at the export size (shared by the image exports and TikZ). */
function figureInputFor(figId: string, width: number, height: number, transparent: boolean, includeCursors: boolean): FigureInput {
  const st = editor.getState();
  const fig = activeFigure(st.project, figId);
  const view = viewOf(st, figId);
  const base: PlotTheme = resolveTheme(fig.stylePreset, fig.style);
  const theme: PlotTheme = transparent ? { ...base, background: null, plotBackground: 'none' } : base;
  const groups = figureGroups(st.project, fig.id).map(({ group, signals }) => ({
    id: group.id,
    name: group.name,
    share: group.share,
    traces: signals
      .filter((s) => s.style.visible)
      .map(
        (s): TraceInput => ({
          id: s.id,
          name: s.name,
          signal: compiled(s, st.project),
          color: s.style.color,
          lineWidth: s.style.lineWidth,
          dash: s.style.dash,
          unit: s.unit,
          showInLegend: s.style.showInLegend,
        }),
      ),
  }));
  return {
    width,
    height,
    panels: panelsForGroups(fig.mode, groups, view.yRanges),
    xRange: view.xRange,
    xTitle: 'Time',
    showLegend: fig.showLegend,
    theme,
    cursors: includeCursors ? cursorSpecFor(figId) : undefined,
    axes: fig.axes,
    annotations: fig.annotations,
  };
}

/** TikZ / pgfplots source of the current figure. */
export function tikzString(o: ExportOptions): string {
  const st = editor.getState();
  return figureToTikz(figureInputFor(st.activeFigureId, o.width, o.height, false, false), { standalone: o.tikzStandalone, samples: 600 });
}

/** Copy the export to the clipboard: PNG as an image, the text formats as text. */
export async function copyExport(o: ExportOptions): Promise<string> {
  if (!navigator.clipboard) throw new Error('the clipboard is not available in this browser');
  if (o.format === 'png' || o.format === 'pdf') {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard.write) throw new Error('this browser cannot copy images');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': renderPng({ ...o, format: 'png' }) })]);
    return 'PNG image copied to the clipboard.';
  }
  const text = o.format === 'svg' ? svgString(o) : o.format === 'csv' ? csvString(o) : tikzString(o);
  await navigator.clipboard.writeText(text);
  return `${o.format === 'tex' ? 'TikZ' : o.format.toUpperCase()} copied to the clipboard.`;
}

function cursorSpecFor(figId: string) {
  const st = editor.getState();
  const v = viewOf(st, figId);
  const target = figId === st.activeFigureId ? actions.measureTarget()?.id : orderedSignals(st.project, figId).find((s) => s.style.visible)?.id;
  return { t: v.cursors.t, y: v.cursors.y, yTraceId: v.cursors.target ?? target ?? null };
}

// --- fonts ---------------------------------------------------------------------

const fontCache = new Map<string, Promise<string>>();

/** Base64 of a bundled font file (Inter, SIL OFL), fetched once on demand. */
export function fontBase64(file: 'Inter-Regular.ttf' | 'Inter-Bold.ttf'): Promise<string> {
  let p = fontCache.get(file);
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}fonts/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`font ${file}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then(toBase64);
    fontCache.set(file, p);
  }
  return p;
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function fontFaceCss(): Promise<string> {
  const [reg, bold] = await Promise.all([fontBase64('Inter-Regular.ttf'), fontBase64('Inter-Bold.ttf')]);
  return (
    `@font-face{font-family:'Inter';font-weight:400;src:url(data:font/ttf;base64,${reg}) format('truetype');}` +
    `@font-face{font-family:'Inter';font-weight:700;src:url(data:font/ttf;base64,${bold}) format('truetype');}`
  );
}

// --- exporters -------------------------------------------------------------------

export function svgString(o: ExportOptions): string {
  return sceneToSvg(buildExportScene(o.width, o.height, o.transparent, o.includeCursors, o.content), { xmlDeclaration: true, idPrefix: 'wl-' });
}

export async function exportSvg(o: ExportOptions): Promise<void> {
  downloadBlob(new Blob([svgString(o)], { type: 'image/svg+xml' }), `${o.fileName}.svg`);
}

export async function renderPng(o: ExportOptions): Promise<Blob> {
  return scenePng(buildExportScene(o.width, o.height, o.transparent, o.includeCursors, o.content), o.scale);
}

/** Rasterize a scene (fonts embedded) at `scale` × its pixel size. */
export async function scenePng(scene: Scene, scale: number): Promise<Blob> {
  const o = { width: scene.width, height: scene.height, scale };
  const svg = sceneToSvg(scene, { css: await fontFaceCss(), pixelScale: o.scale, idPrefix: 'wl-' });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(o.width * o.scale);
    canvas.height = Math.round(o.height * o.scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exportPng(o: ExportOptions): Promise<void> {
  downloadBlob(await renderPng(o), `${o.fileName}.png`);
}

/** Page size in points for the chosen options. */
export function pageSizePt(o: ExportOptions): [number, number] {
  if (o.page === 'plot') return [o.width * PX_TO_PT, o.height * PX_TO_PT];
  const [w, h] = o.page === 'custom' ? [o.pageW, o.pageH] : PAGE_MM[o.page];
  const [a, b] = [w * MM_TO_PT, h * MM_TO_PT];
  if (o.page === 'custom') return [a, b];
  return o.orientation === 'landscape' ? [Math.max(a, b), Math.min(a, b)] : [Math.min(a, b), Math.max(a, b)];
}

export async function renderPdf(o: ExportOptions): Promise<Blob> {
  const [{ jsPDF }, , reg, bold] = await Promise.all([
    import('jspdf'),
    import('svg2pdf.js'),
    fontBase64('Inter-Regular.ttf'),
    fontBase64('Inter-Bold.ttf'),
  ]);
  const [pw, ph] = pageSizePt(o);
  const doc = new jsPDF({ unit: 'pt', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });
  doc.addFileToVFS('Inter-Regular.ttf', reg);
  doc.addFont('Inter-Regular.ttf', 'Inter', 'normal');
  doc.addFileToVFS('Inter-Bold.ttf', bold);
  doc.addFont('Inter-Bold.ttf', 'Inter', 'bold');
  doc.setFont('Inter', 'normal');
  doc.setProperties({ title: o.fileName, creator: `WaveLab ${__APP_VERSION__}` });

  // Plot placement: exact page for "plot size", otherwise fitted inside margins or at 96 dpi.
  const natW = o.width * PX_TO_PT;
  const natH = o.height * PX_TO_PT;
  let w = natW;
  let h = natH;
  if (o.page !== 'plot' && o.fit) {
    const m = MARGIN_MM * MM_TO_PT;
    const k = Math.min((pw - 2 * m) / natW, (ph - 2 * m) / natH);
    w = natW * k;
    h = natH * k;
  }
  const x = (pw - w) / 2;
  const y = (ph - h) / 2;

  const svgText = sceneToSvg(buildExportScene(o.width, o.height, o.transparent, o.includeCursors, o.content), { idPrefix: 'wlpdf-' });
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden';
  host.innerHTML = svgText;
  document.body.appendChild(host);
  try {
    const el = host.querySelector('svg');
    if (!el) throw new Error('SVG generation failed');
    // Only Inter is embedded; other families map to the standard PDF fonts, whose encoding
    // has no Greek letters, minus sign or other symbols. Text needing them uses Inter.
    for (const t of Array.from(el.querySelectorAll('text'))) {
      const family = getComputedStyle(t).fontFamily;
      if (!/^\s*["']?Inter/i.test(family) && /[^\u0000-\u00ff]/.test(t.textContent ?? '')) t.setAttribute('font-family', 'Inter');
    }
    await doc.svg(el, { x, y, width: w, height: h });
  } finally {
    host.remove();
  }
  return doc.output('blob');
}

export async function exportPdf(o: ExportOptions): Promise<void> {
  downloadBlob(await renderPdf(o), `${o.fileName}.pdf`);
}

/**
 * Samples of the current figure's visible signals over the visible time range:
 * a uniform grid plus (optionally) the exact feature times, where jumps produce two
 * rows with the same time (left limit, then right limit).
 */
export function csvString(o: ExportOptions): string {
  const st = editor.getState();
  const sigs = orderedSignals(st.project).filter((s) => s.style.visible);
  const evs = sigs.map((s) => compiled(s, st.project));
  const [a, b] = st.view.xRange;
  const n = Math.max(2, Math.min(1_000_000, Math.round(o.csvSamples)));
  const times = new Map<number, boolean>(); // t → has a jump (needs left/right rows)
  for (let i = 0; i < n; i++) times.set(a + ((b - a) * i) / (n - 1), false);
  if (o.csvEdges) {
    for (const s of evs) {
      const q = s.features(a, b, 200_000);
      if (q.truncated) continue;
      for (const f of q.features) times.set(f.t, (times.get(f.t) ?? false) || f.kind === 'jump');
    }
  }
  const esc = (x: string) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
  const lines = [['t [s]', ...sigs.map((s) => esc(`${s.name}${s.unit ? ` [${s.unit}]` : ''}`))].join(',')];
  const num = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(12))) : '');
  for (const t of [...times.keys()].sort((x, y) => x - y)) {
    if (times.get(t)) lines.push([num(t), ...evs.map((s) => num(s.left ? s.left(t) : s.value(t)))].join(','));
    lines.push([num(t), ...evs.map((s) => num(s.value(t)))].join(','));
  }
  return lines.join('\n') + '\n';
}

export async function runExport(o: ExportOptions): Promise<void> {
  if (o.format === 'tex') {
    downloadBlob(new Blob([tikzString(o)], { type: 'application/x-tex' }), `${o.fileName}.tex`);
    return;
  }
  if (o.format === 'csv') {
    downloadBlob(new Blob([csvString(o)], { type: 'text/csv' }), `${o.fileName}.csv`);
    return;
  }
  if (o.format === 'svg') return exportSvg(o);
  if (o.format === 'png') return exportPng(o);
  return exportPdf(o);
}
