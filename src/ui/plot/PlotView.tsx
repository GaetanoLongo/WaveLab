/**
 * Interactive plot. Rendering goes through the same Scene → SVG path used by the
 * exporters; this component only adds mouse interaction:
 *   wheel             zoom time axis around the pointer
 *   Shift + wheel     zoom vertical axis of the panel under the pointer
 *   drag              pan time axis
 *   Shift + drag      box zoom (time + vertical range of that panel)
 *   double-click      fit all
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  buildFigure,
  panelAt,
  panelsForMode,
  pxToT,
  pxToY,
  type FigureLayout,
  type PlotTheme,
  type TraceInput,
} from '../../core/plot/layout';
import type { Range } from '../../core/plot/range';
import { sceneToSvg } from '../../core/plot/svg';
import { panRange, zoomRange } from '../../core/plot/viewport';

export interface CursorInfo {
  t: number;
  y: number;
  panelId: string;
  unit: string;
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
  onCursor?(info: CursorInfo | null): void;
}

type Drag =
  | { kind: 'pan'; startX: number; startRange: Range }
  | { kind: 'box'; startX: number; startY: number; curX: number; curY: number };

const WHEEL_STEP = 1.2;

export function PlotView(props: PlotViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [drag, setDrag] = useState<Drag | null>(null);
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
        showLegend: true,
        theme: props.theme,
      }),
    [size, panels, props.xRange, props.theme],
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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const { x, y } = localPos(e.currentTarget, e);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(
      e.shiftKey
        ? { kind: 'box', startX: x, startY: y, curX: x, curY: y }
        : { kind: 'pan', startX: x, startRange: props.xRange },
    );
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const { x, y } = localPos(e.currentTarget, e);
    reportCursor(layout, x, y, props);
    if (!drag) return;
    if (drag.kind === 'pan') {
      const span = drag.startRange[1] - drag.startRange[0];
      props.onXRangeChange(panRange(drag.startRange, (-(x - drag.startX) * span) / layout.plotW));
    } else {
      setDrag({ ...drag, curX: x, curY: y });
    }
  };

  const onPointerUp = () => {
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
  };

  return (
    <div
      ref={hostRef}
      className={`plot-host${drag?.kind === 'pan' ? ' panning' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => props.onCursor?.(null)}
      onDoubleClick={props.onFit}
    >
      <div className="plot-svg" dangerouslySetInnerHTML={{ __html: svg }} />
      {drag?.kind === 'box' && (
        <svg className="plot-overlay" width={size.w} height={size.h}>
          <rect
            x={Math.min(drag.startX, drag.curX)}
            y={Math.min(drag.startY, drag.curY)}
            width={Math.abs(drag.curX - drag.startX)}
            height={Math.abs(drag.curY - drag.startY)}
            className="zoom-box"
          />
        </svg>
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
