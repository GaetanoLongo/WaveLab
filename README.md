# WaveLab

Browser-based mathematical waveform editor. Waveforms are mathematical objects, not drawings.

## Development
```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (math engine + acceptance tests)
npm run typecheck
npm run build      # production build into dist/
npx vite preview   # serve the build, then in another shell:
npm run e2e        # browser end-to-end checks: editor, snapping, files & export (Playwright)
```

## Status
| Milestone | Content | Status |
|---|---|---|
| M0 | Project setup, SI units, document model | ✅ |
| M1 | Signal engine: sine, cosine, square, pulse, triangle, sawtooth, DC | ✅ |
| M2 | Plot engine (overlay/stacked, zoom/pan, exact edges) | ✅ |
| M3 | Editor interface | ✅ |
| M4 | Positioning and snapping (configurable modes) | ✅ |
| M5 | Save/open .wlab, PNG/SVG/PDF export, math markup, GitHub Pages | ✅ |
| M6 | Mathematical operations, comparators, logic, expression editor, dependencies | ✅ |
| M7 | Integration, differentiation, moving average / RMS | ✅ |
| — | Phone & tablet layout | ✅ |
| M8 | Cursors and measurements | ✅ |
| M9 | Axes, styles and figure settings | ✅ |
| M10 | Exponential, damped sine, piecewise, bit sequences (NRZ/RZ/Manchester) | ✅ |

See [docs/CONVENTIONS.md](docs/CONVENTIONS.md) for the mathematical conventions.

## Cursors and measurements
"Time cursors" adds cursors 1 and 2 (all panels); "Level cursors" adds A and B in the measured signal's panel.
Drag them in the plot (they snap to edges, peaks and zero crossings; Alt = free) or type exact positions.
The panel shows values at the cursors, Δt, 1/Δt, ΔY, ΔAB, and for the interval between cursors 1–2 (or the
visible window): max, min, peak-to-peak, mean, RMS, duty cycle and frequency — all computed exactly, not
from samples. Cursors are saved in the project file and are left out of exports unless requested.

## Axes and figure style
- **Axes** (toolbar button, click the time range in the status bar, or double-click an axis): exact visible
  time interval, axis titles, fixed tick step, label decimals, manual vertical ranges, log scale (only for
  strictly positive data).
- **Figure settings** (gear button): presets Light technical, Dark technical, Presentation, Minimal/publication,
  plus overrides for background, plot area, grid colour/opacity, minor grid, font (sans/serif/mono) and size,
  legend position (corners, outside right, hidden), margins and a line-width multiplier. Saved in the project;
  applied on screen and in exports. Only Inter is embedded in PDFs.

## Phones and tablets
Below 760 px wide the plot sits on top with a tab bar (Add / Signals / Properties) underneath; the toolbar
keeps the essentials and moves the rest into a "⋯" menu. On touch screens: pinch to zoom the time axis,
drag with two fingers to pan, drag a trace with one finger to move it, double-tap to fit.

## Files and export
- **Projects** are saved as `.wlab` (readable JSON with the mathematical definitions, never samples).
  Ctrl+S saves, "Save as…" picks a new file, Ctrl+O or drag-and-drop opens one. In Chromium-based
  browsers Save writes back to the same file; in other browsers it downloads a copy.
- **Export** (Ctrl+Shift+S): PNG (1×/2×/4×, transparent option), SVG (vector, editable text),
  PDF (vector, Inter font embedded; page = figure size, A4, A3, Letter or custom).

## Math in labels
Signal names (shown in legends and axis titles) accept a small LaTeX-like markup:
`V_{out}`, `I_{RMS}^2`, `\omega t`, `\Delta t`, `\varphi`, `90^\circ`. Write `\_` for a literal underscore.

## Derived signals
Operations in the toolbox create new signals from the selected signal (A) and the next one in the
list (B); inputs are never modified. Every derived signal is an expression you can edit:
`Vout = Vin + Vref`, `Error = Vref - Vout`, `Power = V * I`, `PWM = Ref > Carrier`,
`clip(A, -1, 1)`, `delay(A, 1m)`, `and(Gate1, not(Gate2))`, `sin(2*pi*50*t)`,
`integral(V, 0, 0)`, `deriv(I)`, `dfinite(V, 1u)`, `dnum(V, 1u)`, `movavg(P, 20m)`, `rms(V, 20m)`.
Names with spaces or markup go in brackets: `[Sine 2]`. Logic results get configurable high/low levels.

## Deployment
`.github/workflows/deploy.yml` builds, tests and publishes to GitHub Pages on every push to `main`.
One-time setup: repository Settings → Pages → Source: **GitHub Actions**.

## Third-party assets
- Inter font (subset), © The Inter Project Authors, SIL Open Font License 1.1 — `public/fonts/Inter-LICENSE.txt`.
