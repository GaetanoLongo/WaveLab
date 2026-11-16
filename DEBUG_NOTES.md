# Debugging notes (to address later)

- [ ] **Removing dependent waveforms**: sometimes a waveform can't be removed, probably because other waveforms depend on it. Add a small popup warning about this.
- [ ] **Symbols/formulas not rendered** (e.g. in the modulation menu, `f_c` shows literally instead of f with subscript c). Check everywhere such symbols can appear.
- [ ] **PRBS**: are pseudo-random bit sequences deterministic (seeded) or random on each run? Investigate and document.
- [ ] **Editing plot annotations**: can an existing text annotation be modified? Can arrow thickness be changed?
- [ ] **Right-click**: custom context menu instead of the browser default?
- [ ] **UART clock**: when TX-ing a string over UART, no clock waveform is shown. Generate an associated clock waveform and show it only if the user requests it.

## Batch 2

- [ ] **PWM generator**: reference f1 must be > 0, so a DC signal can't be used as the modulating input. Decide whether to allow f = 0 (DC) / a DC reference.
- [ ] **Sidebars and measurement panel** can't be hidden or resized. Add collapse/hide and resize.
- [ ] **"Not in this figure" waveforms**: no way to get rid of them. Add a way to remove or hide them.
- [ ] **Legend**: unclear how it is shown/hidden. Make the toggle discoverable.
- [ ] **Lowpass filter**: suspected not to work properly. Lowpass on a PWM-modulated Vout recovers the original waveform, but it stays non-smooth however large the time parameter is made. Needs investigation (filter implementation, time-parameter meaning, sampling/resolution) before concluding it is a bug.

## Batch 3

- [ ] **Page freezes**: occasionally and seemingly at random, the page gets stuck and must be reloaded. No repro steps yet. When it happens, note the last action taken, which waveforms/parameters were active, and any console errors, to narrow it down (possibly an infinite loop or heavy computation on certain parameter values).
