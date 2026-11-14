/**
 * Interactive plot. Rendering goes through the same Scene → SVG path used by the
 * exporters; this component only adds mouse interaction:
 *   drag on a trace   move that signal in time (snapping; hold Alt to move freely)
 *   drag elsewhere    pan time axis
 *   click a trace     select it
 *   wheel             zoom time axis around the pointer
 *   Shift + wheel     zoom vertical axis of the panel under the pointer
 *   Shift + drag      box zoom (time + vertical range of that panel)
 *   double-click      fit all
 * Guides and the zoom box are drawn in an overlay that is never exported.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildFigure,
  panelAt,
  panelsForMode,
  pxToT,
  pxToY,
  timeTicks,
  tToPx,
  yToPx,
  type FigureLayout,
  type PlotTheme,
  type TraceInput,
} from '../../core/plot/layout';
import type { Range } from '../../core/plot/range';
import { sceneToSvg } from '../../core/plot/svg';
import { panRange, zoomRange } from '../../core/plot/viewport';
import { cycleStarts, snapPoints, type PointOptions, type SnapPoint } from '../../core/snap/points';
import { computeSnap, gridPoints, type SnapSettings } from '../../core/snap/snap';
import { formatSI } from '../../core/units/si';

export interface CursorInfo {
  t: number;
  y: number;
  panelId: string;
  unit: string;
}

export interface TimingInfo {
  delay: number;
  frequency: number;
  phaseDeg: number;
  periodic: boolean;
}

export interface PlotViewProps {
  traces: TraceInput[];
  mode: 'overlay' | 'stacked';
  xRange: Range;
  onXRangeChange(r: Range): void;
  yRanges: Record<string, Range | null>;
  onYRangeChange(panelId: string, r: Range | null): void;
  onFit(): void;
  theme: PlotTheme;
  showLegend?: boolean;
  onCursor?(info: CursorInfo | null): void;
  /** Click (without dragging) on a trace selects it; on empty space passes null. */
  onSelect?(signalId: string | null): void;
  /** Message drawn in the middle of an empty plot. */
  emptyMessage?: string;
  /** Horizontal moving of signals (all optional: omit to disable). */
  canMove?(id: string): boolean;
  getTiming?(id: string): TimingInfo | null;
  onMove?(id: string, delay: number, gestureKey: string): void;
  snap?: SnapSettings;
}

type Drag =
  | { kind: 'pan'; startX: number; startY: number; startRange: Range; moved: boolean }
  | { kind: 'box'; startX: number; startY: number; curX: number; curY: number }
  | {
      kind: 'move';
      id: string;
      key: string;
      startX: number;
      startDelay: number;
      anchors: SnapPoint[];
      targets: SnapPoint[];
      phaseStep?: { seconds: number; degrees: number };
      moved: boolean;
    };

interface Guide {
  t: number | null;
  label: string;
  x: number;
  y: number;
}

const WHEEL_STEP = 1.2;
let gestureCounter = 0;

export function PlotView(props: PlotViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [guide, setGuide] = useState<Guide | null>(null);
  const [hoverMovable, setHoverMovable] = useState(false);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ w: Math.max(200, Math.floor(width)), h: Math.max(150, Math.floor(height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const panels = useMemo(
    () => panelsForMode(props.mode, props.traces, props.yRanges),
    [props.mode, props.traces, props.yRanges],
  );

  const { scene, layout } = useMemo(
    () =>
      buildFigure({
        width: size.w,
        height: size.h,
        panels,
        xRange: props.xRange,
        xTitle: 'Time',
        showLegend: props.showLegend ?? true,
        theme: props.theme,
      }),
    [size, panels, props.xRange, props.theme, props.showLegend],
  );
  const svg = useMemo(() => sceneToSvg(scene, `p${uid}-`), [scene, uid]);

  // Latest values for native event handlers.
  const live = useRef({ layout, props });
  live.current = { layout, props };

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { layout: l, props: p } = live.current;
      const { x, y } = localPos(el, e);
      const factor = e.deltaY > 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
      if (e.shiftKey) {
        const panel = panelAt(l, y);
        if (panel) p.onYRangeChange(panel.id, zoomRange(panel.yRange, factor, pxToY(panel, y)));
      } else {
        p.onXRangeChange(zoomRange(l.xRange, factor, pxToT(l, clampX(l, x))));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const startMove = (id: string, x: number): Drag | null => {
    const timing = props.getTiming?.(id);
    const tr = props.traces.find((t) => t.id === id);
    if (!timing || !tr) return null;
    const sn = props.snap;
    const [v0, v1] = layout.xRange;
    const span = v1 - v0;
    const r0 = v0 - span;
    const r1 = v1 + span;
    const anchors: SnapPoint[] = [];
    const targets: SnapPoint[] = [];
    if (sn?.enabled) {
      const opts = (tm: TimingInfo | null): PointOptions => ({
        edges: sn.edges,
        zeros: sn.zeros,
        peaks: sn.peaks,
        cycles: (sn.period || sn.grid) && !!tm?.periodic,
        cycleStarts: tm?.periodic ? (a, b) => cycleStarts(tm, a, b) : undefined,
      });
      anchors.push(...snapPoints(tr.signal, r0, r1, opts(timing), id));
      if (tr.signal.extent) anchors.push({ t: tr.signal.extent[0], group: 'cycle', label: 'Start', signalId: id });
      for (const other of props.traces) {
        if (other.id === id) continue;
        const tm = props.getTiming?.(other.id) ?? null;
        const pts = snapPoints(other.signal, r0, r1, { ...opts(tm), cycles: sn.period && !!tm?.periodic });
        for (const p of pts) targets.push({ ...p, label: `${p.label} · ${other.name}` });
        if (other.signal.extent) {
          targets.push({ t: other.signal.extent[0], group: 'cycle', label: `Start · ${other.name}`, signalId: other.id });
        }
      }
      targets.push({ t: 0, group: 'time-zero', label: 't = 0' });
      if (sn.grid) {
        const step = sn.gridStep ?? timeTicks(layout).minorStep;
        targets.push(...gridPoints(r0, r1, step).map((g) => ({ ...g, label: `Grid ${formatSI(g.t, 's')}` })));
      }
      targets.sort((a, b) => a.t - b.t);
    }
    const phaseStep =
      sn?.enabled && sn.phase && timing.periodic && sn.phaseStepDeg > 0
        ? { seconds: sn.phaseStepDeg / 360 / timing.frequency, degrees: sn.phaseStepDeg }
        : undefined;
    gestureCounter += 1;
    return {
      kind: 'move',
      id,
      key: `drag:${id}:${gestureCounter}`,
      startX: x,
      startDelay: timing.delay,
      anchors,
      targets,
      phaseStep,
      moved: false,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { x, y } = localPos(e.currentTarget, e);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.shiftKey) {
      setDrag({ kind: 'box', startX: x, startY: y, curX: x, curY: y });
      return;
    }
    const hit = hitTest(layout, props.traces, x, y);
    if (hit && props.onMove && props.canMove?.(hit)) {
      props.onSelect?.(hit);
      const d = startMove(hit, x);
      if (d) {
        setDrag(d);
        return;
      }
    }
    setDrag({ kind: 'pan', startX: x, startY: y, startRange: props.xRange, moved: false });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = localPos(e.currentTarget, e);
    reportCursor(layout, x, y, props);
    if (!drag) {
      const hit = props.onMove ? hitTest(layout, props.traces, x, y) : null;
      setHoverMovable(!!hit && !!props.canMove?.(hit));
      return;
    }
    const span = layout.xRange[1] - layout.xRange[0];
    if (drag.kind === 'pan') {
      if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      props.onXRangeChange(panRange(drag.startRange, (-(x - drag.startX) * span) / layout.plotW));
    } else if (drag.kind === 'move') {
      if (!drag.moved && Math.abs(x - drag.startX) < 3) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      const raw = ((x - drag.startX) * span) / layout.plotW;
      const thr = ((props.snap?.thresholdPx ?? 8) * span) / layout.plotW;
      const res =
        props.snap?.enabled && !e.altKey
          ? computeSnap(raw, drag.anchors, drag.targets, thr, drag.phaseStep, pxToT(layout, x))
          : { delta: raw, target: null, anchor: null, label: undefined };
      props.onMove?.(drag.id, drag.startDelay + res.delta, drag.key);
      const what = res.target
        ? `${res.anchor?.label ?? ''} → ${res.target.label}`
        : (res.label ?? (e.altKey ? 'Snapping off (Alt)' : ''));
      setGuide({
        t: res.target ? res.target.t : null,
        label: `Δt ${res.delta >= 0 ? '+' : '−'}${formatSI(Math.abs(res.delta), 's')}${what ? `   ${what}` : ''}`,
        x,
        y,
      });
    } else {
      setDrag({ ...drag, curX: x, curY: y });
    }
  };

  const onPointerUp = () => {
    if (drag?.kind === 'pan' && !drag.moved) {
      props.onSelect?.(hitTest(layout, props.traces, drag.startX, drag.startY));
    }
    if (drag?.kind === 'box') {
      const x0 = clampX(layout, Math.min(drag.startX, drag.curX));
      const x1 = clampX(layout, Math.max(drag.startX, drag.curX));
      if (x1 - x0 > 4) props.onXRangeChange([pxToT(layout, x0), pxToT(layout, x1)]);
      const panel = panelAt(layout, drag.startY);
      const yTop = Math.min(drag.startY, drag.curY);
      const yBot = Math.max(drag.startY, drag.curY);
      if (panel && yBot - yTop > 4) {
        const lo = pxToY(panel, Math.min(yBot, panel.y + panel.h));
        const hi = pxToY(panel, Math.max(yTop, panel.y));
        if (hi > lo) props.onYRangeChange(panel.id, [lo, hi]);
      }
    }
    setDrag(null);
    setGuide(null);
  };

  const top = layout.panels[0]?.y ?? 0;
  const lastPanel = layout.panels[layout.panels.length - 1];
  const bottom = lastPanel ? lastPanel.y + lastPanel.h : size.h;
  const cls = ['plot-host', drag?.kind === 'pan' && drag.moved && 'panning', drag?.kind === 'move' && 'moving', !drag && hoverMovable && 'can-move']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={hostRef}
      className={cls}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        setDrag(null);
        setGuide(null);
      }}
      onPointerLeave={() => props.onCursor?.(null)}
      onDoubleClick={props.onFit}
    >
      <div className="plot-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      {props.traces.length === 0 && props.emptyMessage && <div className="plot-empty">{props.emptyMessage}</div>}
      {(drag?.kind === 'box' || guide) && (
        <svg className="plot-overlay" width={size.w} height={size.h}>
          {drag?.kind === 'box' && (
            <rect
              x={Math.min(drag.startX, drag.curX)}
              y={Math.min(drag.startY, drag.curY)}
              width={Math.abs(drag.curX - drag.startX)}
              height={Math.abs(drag.curY - drag.startY)}
              className="zoom-box"
            />
          )}
          {guide?.t !== null && guide && (
            <line className="snap-guide" x1={tToPx(layout, guide.t)} x2={tToPx(layout, guide.t)} y1={top} y2={bottom} />
          )}
        </svg>
      )}
      {guide && (
        <div
          className="drag-tip"
          style={{ left: Math.min(guide.x + 14, size.w - 260), top: Math.max(4, guide.y - 34) }}
        >
          {guide.label}
        </div>
      )}
    </div>
  );
}

function localPos(el: HTMLElement, e: { clientX: number; clientY: number }) {
  const r = el.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function clampX(l: FigureLayout, x: number) {
  return Math.max(l.plotX, Math.min(l.plotX + l.plotW, x));
}

function reportCursor(l: FigureLayout, x: number, y: number, p: PlotViewProps) {
  if (!p.onCursor) return;
  const panel = panelAt(l, y);
  if (!panel || x < l.plotX || x > l.plotX + l.plotW) {
    p.onCursor(null);
    return;
  }
  const units = new Set(p.traces.filter((t) => panel.traceIds.includes(t.id)).map((t) => t.unit));
  p.onCursor({
    t: pxToT(l, x),
    y: pxToY(panel, y),
    panelId: panel.id,
    unit: units.size === 1 ? [...units][0]! : '',
  });
}

/** Nearest trace within 6 px of the pointer (vertical distance, or on a vertical edge). */
function hitTest(l: FigureLayout, traces: TraceInput[], x: number, y: number): string | null {
  const panel = panelAt(l, y);
  if (!panel || x < l.plotX || x > l.plotX + l.plotW) return null;
  const t = pxToT(l, x);
  const pxT = (l.xRange[1] - l.xRange[0]) / l.plotW;
  let best: string | null = null;
  let bestD = 6;
  for (const tr of traces) {
    if (!panel.traceIds.includes(tr.id)) continue;
    const v = tr.signal.value(t);
    const d = Number.isNaN(v) ? Infinity : Math.abs(yToPx(panel, v) - y);
    if (d < bestD) {
      bestD = d;
      best = tr.id;
    }
    // Vertical edges: a jump within ±3 px whose span covers the pointer.
    for (const f of tr.signal.features(t - 3 * pxT, t + 3 * pxT, 50).features) {
      if (f.kind !== 'jump') continue;
      const ya = yToPx(panel, f.left);
      const yb = yToPx(panel, f.right);
      if (y >= Math.min(ya, yb) - 3 && y <= Math.max(ya, yb) + 3 && bestD > 0.5) {
        bestD = 0.5;
        best = tr.id;
      }
    }
  }
  return best;
}
