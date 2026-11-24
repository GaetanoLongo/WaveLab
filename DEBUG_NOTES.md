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

## Second round: performance, share link, edge measurements, CSV import

- **Deep operation chains** (abs → low-pass → negate → moving average, repeated): a filter over a smooth input integrated numerically on every evaluation, and each integration evaluated the layer below, so cost multiplied per layer (never finished at depth 10; the original code took 11 s at depth 6). Smooth pieces are now tabulated once (Chebyshev, ≤ 8 time constants per table) and a periodic feature cache answers any window from one period. A 30-deep chain draws in ~0.5 s. Checked against an independent RK4 integration (1e-6).
- **Compute budget** (`core/signals/budget.ts`): hot loops call `checkBudget()`; the outermost evaluation of a signal (or one drawn trace, one measurement, one spectrum) is limited to 3–15 s. On overrun the signal is marked heavy for 15 s (answers "undefined" at once instead of retrying), the trace is left out and the status bar says why.
- **Share link**, **edge and pulse measurements** (rise/fall, widths, overshoot, settling; verified against τ·ln 9 and the second-order overshoot formula), **CSV import** (time column and unit detection, up to 150 000 points per trace with peak-preserving reduction).
- Keyboard and touch (stress areas `keyboard`, `touch`): dialogs take, trap and return focus; signal rows are reachable by keyboard with Shift+F10; controls are ≥ 32 px on touch screens.

Still open:
- Dense PWM with dead time and load at fc ≫ f₁ remains slow to create (5 s at 100 kHz, much more for three phases); the budget now stops it instead of freezing, but the exact filter integration per switching cycle is inherently expensive.
- Nested operators typed inside ONE expression (e.g. `lowpass(movavg(lowpass(x, …), …), …)`) do not get the per-layer period cache that separate signals get.

## Workflow tests (e2e/workflows.e2e.cjs)

Whole user sessions rather than single features: W1 half-bridge PWM → spectrum → export → save → reopen (identical figure); W2 scope CSV (semicolon, decimal comma, units in the header) → edge measurements checked against the closed form; W3 UART and SPI diagrams at several zooms and widths (no overlapping text); W5 300 random edits with undo/redo; W7 recovery (undo, unsaved-work guard, corrupted files, damaged share link).

- **Found and fixed:** a CSV with `;` separators and decimal commas was rejected ("Fewer than two rows") when the header had no commas, because the comma was judged a consistent delimiter. Detection now prefers the delimiter that gives numeric rows (unit tests added).
- Not covered / unverified: real phones and other browsers (Chromium only), first-time-user discoverability (needs a person). The W5 memory figure comes from `performance.memory`, which Chromium rounds coarsely, so it only rules out gross leaks.

## Found while preparing the user guides

- **Freeze on long imported tables (fixed):** the Properties "Points" table drew two inputs per data point. A 20 000-row CSV took 5 s to select and a 140 000-row one froze the page for over 30 s. Tables above 200 points are no longer listed (the panel states the count).
- **Imported data drawn clipped (fixed):** the automatic vertical range scans at most 250 features; a 1 200-point table was only scanned over its first part, so 0–5 V data was drawn in −1…1. When the scan is cut short, 512 evenly spaced samples of the window now complete the range (test added).
- Open: with 120 signals, undo/redo costs about 45 ms per step (the stress run flags 300 steps as slow, 13–14 s); it is the same before and after these changes.
- **CSV beyond the file limits (fixed, found while checking CONVENTIONS.md):** a value above 1e15 or a time beyond 1e6 s imported without complaint, but the saved project could not be reopened (same class as the earlier `1e999` bug). The import now refuses such data with a message (test added).

## Under-the-hood performance and robustness pass

Measured before and after with unit-level probes and Chromium CPU profiles (120-signal project). No change to the interface or to drawn output (the SVG text is byte-identical; a test checks it).

- **Exponential compile lookups (fixed):** each `compiled()` call walked the whole dependency tree again, once per *path*. Expressions that share inputs (b = a + x, c = b + a, d = c + b, …) have a number of paths that doubles per layer: 24 layers took 0.13 s per lookup, paid for every trace on every redraw; 30 layers would take seconds. Signals are now resolved once per project version (`state/compiled.ts`): ≈ 0 ms.
- **Quadratic feature merges (fixed):** `integral()`, `abs()` and squares (used by `rms()`) merged zero crossings by searching the whole feature list once per crossing. `integral()` of a 1 kHz sine over 10 s: 3 s → 15 ms.
- **Nested operators in one expression (fixed, was "still open"):** `lowpass(movavg(…))` written inline now gets the same per-period feature cache as separate signals. Panning a 4-deep inline chain: 0.27 s → 7 ms per redraw.
- **Redraw caches:** the samples of each trace, its pixel polylines and its SVG path text are reused while the time window and panel mapping are unchanged, and the automatic vertical range is computed once per signal. Selecting, moving cursors, dragging annotations and undo/redo of unrelated edits no longer re-sample and re-serialize every trace (path text: ≈ 3.5× less JS time per click). What remains per redraw is mostly the browser parsing and painting the SVG.
- **Linear expression walk:** `walk()`/`refsOf()` copied every subtree's node list into its parent (quadratic in depth); now iterative.
- **Stack overflow on deep expressions (fixed, bug):** an expression nested a few thousand levels deep (`((((…))))`, `1+1+…+1` with 5 000 terms, `----…x`) threw an uncaught `RangeError` when typed, and crashed the drawing when it came from a file or share link. Expressions are now limited to 500 levels (builders use at most 4) and deeper ones get the message "The expression is nested too deeply (more than 500 levels)"; files containing one are refused with that message.
- **Placeholder range kept forever (fixed, bug):** the one-period range cache could store the "undefined" answer of a signal that had just run over its compute budget, so its automatic vertical range stayed wrong until it was edited. Caches now skip answers given while a signal is marked heavy (test added; it fails without the fix).
- **Spectrum freeze (fixed, bug, found by the stress `dialogfuzz` area):** the per-harmonic loops had no budget check, so the dialog's 8 s budget could not stop them; 1000 periods × max order 2000 (2·10⁶ bins) on a PWM signal froze the page for minutes. The loops now check the budget (the request is abandoned and shown as unresolved, as designed). Also: the signal scale and the bar chart's top used `Math.max(...array)` (an engine argument-limit crash for very long lists) and the chart searched the order list once per bar (quadratic).
- **Eye diagram computation outside the budget (fixed, bug):** 2000 traces of a derived signal could block for ≈ 9 s; it now runs within the same budget as a plot trace (≈ 4 s at most, then the traces are left out and the status bar says why).
- **e2e `figures` "figures restored" failed (test race, fixed):** after New project the page already shows one tab, so the check could read the tabs before the opened file was applied. It now waits for the second figure. Failed identically on the previous build.
- Tests: `src/state/perf.test.ts` (timings with generous limits, and cached = fresh answers), nesting-limit tests in `expr.test.ts` and `project-file.test.ts`, budget tests in `spectrum.test.ts`, a deep-expression check in `e2e/robustness.e2e.cjs` (fails on the previous build with four "Maximum call stack size exceeded" page errors).

Still open:
- With 120 signals, a click or undo step is ≈ 60–80 ms, dominated by the browser re-parsing and repainting the whole plot SVG (it is replaced as one `innerHTML` string). Updating only the changed elements would need the plot rendered as DOM elements instead of a string.
- **Eye diagram with many traces:** computing is fast, but 2000 traces make a 14–27 MB SVG and the browser freezes for over 8 s parsing it (stress `dialogfuzz`, Eye view with 2000 traces). Fixing it means drawing the eye differently (merged/decimated strokes or a canvas), which changes its look: not done.
- Stress findings unchanged from the previous build (same list on both): text overlaps in very short stacked panels and annotation fuzz, a 6 s step timeout while the spectrum budget runs, and two harness click timeouts. The `dialogfuzz` "undefined shown" finding is a false positive: the eye info text itself says "closed / undefined".
- e2e `files` needs `pdfinfo` (poppler) for its PDF checks; it fails where poppler is not installed (e.g. Windows without it).
