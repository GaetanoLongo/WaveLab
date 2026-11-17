# Debugging notes

Status after the fix pass. "Verified" = covered by a unit test and/or the e2e suite (`e2e/ux.e2e.cjs`); "not verified" = changed but not exercised end to end.

## Batch 1

- [x] **Removing dependent waveforms**: deleting a waveform that others use (or a locked one) now opens a popup naming the dependents (`alert` in the store, `AlertDialog` in `App.tsx`). Verified (unit + e2e).
- [x] **Symbols/formulas not rendered** (`f_c` literal): `NumberField` labels, readout labels and hint texts in the modulation, PWM and rectifier dialogs now go through `MathLabel`. Note: a subscript of more than one character needs braces, e.g. `V_{dc}`. Plain-string tooltips cannot show markup, so they use plain text. Verified in the modulation and PWM dialogs; other dialogs only by code search.
- [x] **PRBS**: it is deterministic (LFSR defined by order and initial state; Noise is seeded too). The UI now says so (hint and tooltip). Nothing is random per run.
- [x] **Annotations**: existing annotations were already editable (double-click one in the plot, or Annotations ▸ Edit annotations). Added a *line thickness* multiplier for arrows and dimension markers (screen, exports, TikZ, project file) and a tip in the dialog. Text size is not adjustable yet.
- [x] **Right-click**: custom context menus on plot traces, annotations, the plot background and signal-list rows replace the browser menu. Verified for the signal row and the plot background; trace and annotation menus are not verified end to end.
- [x] **UART clock**: option "Also create a bit clock (CLK)" in the protocol dialog (off by default; rising edge in the middle of each bit). Verified (unit test).

## Batch 2

- [x] **PWM generator, DC reference**: f₁ = 0 is accepted for single-phase topologies (DC reference, constant duty (1+m)/2; the check shows the mean value). Refused for three-phase. Verified (unit test).
- [x] **Sidebars and measurement panel**: Toolbox, Properties and Measure buttons in the toolbar hide/show them; drag the edges to resize (double-click resets); the state is remembered in the browser. Desktop layout only. Verified (e2e).
- [x] **"Not in this figure" waveforms**: each now has a delete button (refused with the popup if other signals use it). Verified (e2e).
- [x] **Legend**: toolbar "Legend" toggle and a context-menu entry (it was only in Figure settings). Verified (e2e).
- [ ] **Lowpass filter**: no defect found, not reproduced. Numerically the filter behaves as a first-order filter should (checked on PWM outputs, τ from 1 ms to 1 s): the PWM ripple and the recovered fundamental both shrink as 1/τ, and the relative ripple falls as 1/τ (about 2 % at τ = 10 ms, 0.2 % at 0.1 s, 0.1 % at 1 s). If it still looks jagged, send the expression (e.g. `lowpass(v_{AB}, 0.1)`), the PWM settings and the zoom level. A second-order filter (RLC low-pass) suppresses ripple faster.

## Batch 3

- [~] **Page freezes**: one concrete cause found and fixed (not necessarily the only one). A first-order or second-order filter applied to an input that never repeats (e.g. PWM whose reference and carrier frequencies are not commensurate, such as f_c = 14 Hz with f₁ = 170.37 Hz, with a load current) was computed by walking from t = 0 to the requested time. Querying t = 100 s took about 15 s of blocked page. It now uses a bounded history of 45 time constants (the older state has decayed below 1e-19). A regression test was added (`src/core/signals/lowpass.test.ts`). **The change to `lowpass.ts` and `filter2.ts` and that test had not been type-checked or run when this was written** (the shell was unavailable): run `npm run typecheck && npm test` before relying on it. Other causes of random freezes may exist; if it recurs, note the last action and the signals involved.

## Also fixed along the way

- Comparator edges (and other switching instants) that fell exactly on the internal sampling grid were missed. This showed up as missing PWM edges for a DC reference (e.g. m = 0.5), and could affect any signal whose crossing lands exactly on a grid point.
- Deleting a signal no longer changes the selection unless the deleted signal was the selected one.

## Stress-test pass (e2e/stress.e2e.cjs)

Run: `npm run build && npx vite preview`, then `node e2e/stress.e2e.cjs [outDir] [tools,waveforms,dialogs,views,export,layouts,monkey]`.
Covers every toolbox entry, ~13 fuzz values in every property field of 22 waveforms (+ undo/redo), every PWM / rectifier / modulation / protocol option combination, zoom/pan extremes, axes ranges, spectrum on every signal, exports in each format, save and reopen, 8 viewport sizes, and a 400-step random-action run.

Fixed because of it:
- **Freeze (17 s):** three-phase PWM with dead time and load. A delayed gate edge was lost to rounding, so the filter integrated numerically across a hidden step. Edges 1e-15 s apart were also merged and their jump lost. Regression tests added.
- **Slow zoom-out (up to 2.3 s per wheel step, 16 s per 80 steps):** the sampler queried every feature of a dense periodic signal over the whole window. It now uses one period. Now ≈ 70 ms per step.
- **Measurement panel** recomputed on every wheel step even when collapsed. It now waits for the view to settle and does nothing while collapsed.
- Toolbox buttons ran off the screen at 320 px width.
- I²C "P" marker overlapped the last "A" at some lengths; protocol labels overlap (earlier pass).
- A number field could take the focus back after Enter (made one e2e test fail about half the time).

Still open:
- ~~Creating a three-phase DPWM with dead time and load blocked the page for ≈ 6 s.~~ Fixed: the filters started each piece from `value(t)` at a feature time, which can be a hair before a merged jump, so pieces were wrongly judged non-linear and integrated numerically. They now start from the feature's right limit. Creation now takes ≈ 1.4 s, which is the drawing of the 38 signals; a load current's measurements dropped from ≈ 1 s to ≈ 0.1 s.
- **Cosmetic text crowding** with 15+ stacked panels: y tick labels (1 / 0 / −1) and truncated axis titles touch in very small panels; the corner labels of a constant signal (0.90 / 0.0) touch.
- Long I²C messages (11+ bytes) at the default zoom: the A and P markers sit close together (they separate when zooming in).
- Non-integer carrier ratio with a load (e.g. fc = 14 Hz, f₁ = 170.37 Hz) was flagged once as a freeze in the harness; run alone it is fast (0.1 s), so the flag was probably carry-over from the previous slow step, but it was not proven.

## Fuzz tests (src/state/fuzz.test.ts) and the second stress pass

- Random expressions (160 per run, seeded), mutated project files (400 per run) and the save → load → save round trip. The mutated files never produced an unexpected error.
- **Found and fixed:** the three-phase load setup listed three signals in two groups of one figure; reopening a saved file silently dropped them from the second group. A test now checks every builder (all PWM topologies and options, modulation, protocols) for double membership and dangling traces.
- **Found and fixed:** the automatic vertical range scanned a fixed 1 s window for signals without a period (20 s for the dead-time load currents at fc = 14 Hz, f₁ = 170.37 Hz). It is now bounded by feature count (250), identical for ordinary signals.
- **Found and fixed:** text collisions: tick labels across short panels and the time/value label corner, long axis titles, I²C markers.
- Dense PWM (fc ≫ f₁) with dead time or load: the first view is limited to 100 carrier cycles and the dialog warns; creating at fc = 100 kHz still takes ~5 s (single phase) and far longer for three phases (the exact filter integrates thousands of switching cycles).

Still open:
- Arguments at the allowed extremes can stall the page for 3–10 s: `movavg(x, 1e6)`, `dnum(x, 1e6)`, `integral(movavg(...))`, or a 1 s window over a 1 kHz signal through moving-window operators (~2 ms per feature). A real fix is a compute budget that aborts runaway evaluations (one deadline checked in the scanning and integration loops, caught where traces are drawn) or running the engine in a Web Worker.
- A user annotation placed on the axis labels overlaps them (by design: annotations are drawn on top).
