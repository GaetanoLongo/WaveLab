/**
 * Milestone M2 demo: the plot engine with a fixed set of signals.
 * The editor (creating/editing signals) arrives in M3.
 */

import { useMemo, useState } from 'react';
import { defaultGenerator } from '../core/model/defaults';
import { paletteColor } from '../core/model/palette';
import type { GeneratorDef } from '../core/model/signal-defs';
import { LIGHT_TECHNICAL, type TraceInput } from '../core/plot/layout';
import type { Range } from '../core/plot/range';
import { fitTimeRange, zoomRange } from '../core/plot/viewport';
import { compileGenerator } from '../core/signals/generator';
import { formatSI } from '../core/units/si';
import { PlotView, type CursorInfo } from './plot/PlotView';

function demoTraces(): TraceInput[] {
  const sine = defaultGenerator('sine');
  if (sine.generator === 'sine') sine.params.amplitude = 325;

  const square = defaultGenerator('square');
  square.timing.frequency = 150;
  if (square.generator === 'square') Object.assign(square.params, { high: 12, low: 0, duty: 0.3 });

  const tri = defaultGenerator('triangle');
  tri.timing.frequency = 1000;

  const pulse = defaultGenerator('pulse');
  pulse.timing.frequency = 250;
  if (pulse.generator === 'pulse') Object.assign(pulse.params, { high: 5, low: 0, width: 1e-3, rise: 2e-4, fall: 1e-4 });

  const defs: Array<[string, GeneratorDef]> = [
    ['V_grid (50 Hz sine)', sine],
    ['V_sq (150 Hz, 30 %)', square],
    ['Carrier (1 kHz triangle)', tri],
    ['Gate (250 Hz pulse)', pulse],
  ];
  return defs.map(([name, def], i) => ({
    id: `s${i}`,
    name,
    signal: compileGenerator(def),
    color: paletteColor(i),
    lineWidth: 1.6,
    dash: 'solid',
    unit: 'V',
  }));
}

export function App() {
  const traces = useMemo(demoTraces, []);
  const fit = () => fitTimeRange(traces.map((t) => t.signal));
  const [mode, setMode] = useState<'overlay' | 'stacked'>('stacked');
  const [xRange, setXRange] = useState<Range>(fit);
  const [yRanges, setYRanges] = useState<Record<string, Range | null>>({});
  const [cursor, setCursor] = useState<CursorInfo | null>(null);

  const fitAll = () => {
    setXRange(fit());
    setYRanges({});
  };

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">WaveLab</strong>
        <span className="badge" title="The editor arrives in milestone M3">M2 preview · fixed demo signals</span>
        <div className="sep" />
        <div className="seg">
          <button className={mode === 'overlay' ? 'on' : ''} onClick={() => setMode('overlay')}>Overlay</button>
          <button className={mode === 'stacked' ? 'on' : ''} onClick={() => setMode('stacked')}>Stacked</button>
        </div>
        <button onClick={() => setXRange((r) => zoomRange(r, 0.5))} title="Zoom in (time)">Zoom +</button>
        <button onClick={() => setXRange((r) => zoomRange(r, 2))} title="Zoom out (time)">Zoom −</button>
        <button onClick={fitAll} title="Fit all (double-click the plot)">Fit all</button>
        <button onClick={() => setYRanges({})} title="Return all vertical axes to automatic scaling">Auto Y</button>
      </header>
      <main className="plot-area">
        <PlotView
          traces={traces}
          mode={mode}
          xRange={xRange}
          onXRangeChange={setXRange}
          yRanges={yRanges}
          onYRangeChange={(id, r) => setYRanges((m) => ({ ...m, [id]: r }))}
          onFit={fitAll}
          theme={LIGHT_TECHNICAL}
          onCursor={setCursor}
        />
      </main>
      <footer className="status">
        <span>
          View: {formatSI(xRange[0], 's')} → {formatSI(xRange[1], 's')} (span {formatSI(xRange[1] - xRange[0], 's')})
        </span>
        <span>{cursor ? `t = ${formatSI(cursor.t, 's', 6)}   y = ${formatSI(cursor.y, cursor.unit, 4)}` : ''}</span>
        <span className="hint">Wheel: zoom · Drag: pan · Shift+wheel: vertical zoom · Shift+drag: box zoom · Double-click: fit</span>
      </footer>
    </div>
  );
}
