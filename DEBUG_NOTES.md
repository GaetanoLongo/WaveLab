# Debugging notes (to address later)

- [ ] **Removing dependent waveforms**: sometimes a waveform can't be removed, probably because other waveforms depend on it. Add a small popup warning about this.
- [ ] **Symbols/formulas not rendered** (e.g. in the modulation menu, `f_c` shows literally instead of f with subscript c). Check everywhere such symbols can appear.
- [ ] **PRBS**: are pseudo-random bit sequences deterministic (seeded) or random on each run? Investigate and document.
- [ ] **Editing plot annotations**: can an existing text annotation be modified? Can arrow thickness be changed?
- [ ] **Right-click**: custom context menu instead of the browser default?
- [ ] **UART clock**: when TX-ing a string over UART, no clock waveform is shown. Generate an associated clock waveform and show it only if the user requests it.
