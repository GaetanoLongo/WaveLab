# WaveLab mathematical conventions

These rules are part of the file format: changing them later needs a schema migration.

## Time and phase
- Global time `t` is in seconds. Every signal sits on the same global timeline.
- **Phase φ** (degrees) belongs to the signal's definition. **+φ leads**:
  `f(t) = g(ω·(t − delay) + φ)`. At 50 Hz, +120° = the signal happens 6.667 ms *earlier*.
- **Delay** (seconds) is the signal's position on the global timeline. Positive = shift right.
  Dragging a signal changes only its delay.
- Derived signals (expressions and operations) follow their inputs and cannot be dragged. To shift one,
  use the explicit Delay operation.

## Amplitude
- Amplitude = zero-to-peak. Offset = DC level.
- Square and pulse waves are stored as **high/low levels**. Amplitude/offset is shown as an
  equivalent view: amplitude = (high − low)/2, offset = (high + low)/2.

## Where each cycle starts (local phase 0)
| Waveform | At the start of each cycle |
|---|---|
| Sine | crosses zero going up |
| Cosine | positive peak |
| Square | goes high (high for `duty·T`, then low) |
| Pulse | starts rising (SPICE PULSE: rise → flat `width` → fall → low) |
| Triangle | minimum (maximum at T/2) |
| Sawtooth, rising | minimum, ramps up, jumps down at the end of the cycle |
| Sawtooth, falling | maximum, ramps down, jumps up at the end of the cycle |

## Value at discontinuities
- At a jump, `value(t)` returns the **right limit**. Feature records carry both limits.
- `NaN` means *undefined*: drawn as a gap, and it propagates through operations.

## Windows
- Default: infinite (repeats forever).
- Optional: a time interval, or N cycles. The window is given in *local* time (relative to the
  delay), so it moves with the signal. Outside the window the value is either 0 (default) or
  undefined.

## Plot behaviour
- Automatic vertical range = the signal's full range (one period, or its whole window), plus 8 %
  padding. It does **not** follow the visible time window, so zooming in time never rescales the
  vertical axis. Use Shift+wheel or Shift+drag for vertical zoom, and "Auto Y" to reset.
  For a signal without a period whose window holds more than 250 features (imported data, dense
  non-repeating switching), the exact scan covers the leading part of the window only; 512 evenly
  spaced samples of the whole window complete it, so a peak narrower than 1/512 of the window may be
  slightly cut. Signals that cannot be evaluated within 3 s are left out of the range.
- When a signal has more than about one feature per two pixels (e.g. 1 MHz viewed over 1 s), it is
  drawn as an exact min/max band (one vertical stroke per pixel column) instead of an aliased line.

## Moving and snapping
- Dragging a trace changes only its **delay**. Frequency, amplitude and phase are never touched.
  One drag = one undo step. Locked signals cannot be dragged (dragging them pans instead).
- Snap targets: t = 0 (always), the time grid, and the edges / zero crossings / peaks / cycle starts
  of the other visible signals, depending on the enabled modes. A feature snaps to a feature of the
  same family (edge ↔ edge, peak ↔ peak, …); t = 0 and grid lines accept any feature.
- Ties go first to real features over grid lines, then to like-for-like pairs (rising → rising),
  then to the pair nearest the pointer.
- Phase mode moves the signal in steps of N electrical degrees **of the dragged signal**.
  Dragging right is a lag (negative phase).
- Hold **Alt** to move freely. Snap settings are a per-browser preference, not part of the project.

## Phase difference ("Set difference", "Phase vs ref.")
- Defined between the **fundamental components** of two signals with the same frequency, each written
  as sin(2πft + θ). This makes "sine vs square" or "sine vs triangle" meaningful.
- θ of each shape at its cycle start: sine 0°, cosine +90°, triangle −90°, rising sawtooth 180°,
  falling sawtooth 0°, square 90° − 180°·duty, pulse 90° − 360°·(centre/T). The pulse centre
  assumes symmetric edges; with rise ≠ fall it is an approximation.
- "Set difference" changes the signal's **phase parameter**. The align buttons change its **delay**.

## Math markup in labels
- `_x` / `_{...}` subscript, `^x` / `^{...}` superscript, `\name` for Greek letters and symbols
  (LaTeX names: `\phi` = ϕ, `\varphi` = φ, as in LaTeX). `^\circ` gives the degree sign.
- No nesting: markup inside a sub/superscript group is shown literally (symbols still work).
- Malformed markup (e.g. an unclosed `{`) is shown as typed, never dropped.
- A signal name containing `_` is read as a subscript (`V_grid` → V with subscript g, followed by "rid").
  Use braces for longer subscripts (`V_{grid}`), or `\_` for a literal underscore.

## Derived signals (expressions)
- Stored as text with signals referenced by id (`#{id}`); the editor shows current names, so renaming
  never breaks an expression. A signal used by others cannot be deleted; circular references are refused.
- Comparisons (`> < >= <=`), `&& || !`, `and/or/xor/not` and `step()` produce **logic** values, mapped to
  the signal's high/low levels. Analog inputs of logic operators are true above the signal's threshold.
  There is no equality operator (meaningless for continuous signals).
- `x / 0`, `sqrt` / `ln` of negative values give **undefined** (gaps), never huge finite values.
- Derived signals are not draggable; use `delay(x, d)` (positive d = later).
- Exactness: input edges are kept exactly; comparator crossings and abs/clip/min/max corners are located by
  bisection (~1e-15 relative); peaks by golden-section search. Sampling only limits how close two switching
  events *inside one smooth segment* can be and still both be found: by default 1/64 of the shortest input
  period, configurable per signal ("Computation" → custom step).
- Switching events closer than 1e-14 s (relative to the time) are merged into one jump: the value before it is
  the left limit of the first event, the value after it the right limit of the last. A derived signal also
  probes just after each merged cluster, so a delayed edge 1e-15 s behind a kink is not lost.
- Period of a derived signal = least common multiple of its inputs' periods (when their ratios are rational
  with denominators ≤ 1000); otherwise it is treated as aperiodic.

## Calculus operators
- `integral(x, t0, y0)`: I(t) = y0 + ∫ from t0 to t of x (also defined for t < t0). Smooth segments between the
  input's features use adaptive Gauss–Legendre quadrature: exact for piecewise-polynomial inputs, ~1e-13
  relative otherwise. For periodic inputs the cost does not grow with |t − t0| (k·P + partial period), so there
  is no drift. Impulses of the input (from `deriv`) add steps, so `integral(deriv(x))` = x − x(t0⁺).
- `deriv(x)`: derivative of the smooth parts (4th-order differences that never straddle a feature, ~1e-9
  relative). Ideal jumps J become **impulses J·δ**: drawn as arrows labelled "δ·J", never as finite spikes,
  and ignored by the automatic vertical range. Impulses survive linear operations (sum, difference, scaling by a
  constant, delay); a non-linear operation shows a warning instead of silently dropping them.
- `dfinite(x, tr)`: each jump spread over a ramp of duration tr centred on the edge → rectangle J/tr.
- `dnum(x, h)`: plain central difference (x(t + h/2) − x(t − h/2)) / h.
- `movavg(x, W)`, `rms(x, W)`: **trailing** window [t − W, t]. Default window from the toolbox = one period of the input.
- Units from the toolbox: integral of V → V·s, derivative of V → V/s (editable).

## Measurements
- Interval = between time cursors 1 and 2 when both exist, otherwise the visible time window.
- Value at a cursor uses the right-limit convention (on an edge, the value after the edge).
- Max/min are exact (feature-based); mean and RMS are exact integrals (impulses from `deriv` count in the mean).
- Duty cycle = fraction of the interval above the mid level (max + min)/2; frequency = (n − 1)/(t_last − t_first)
  over same-direction crossings of that level (the direction with more crossings), "—" with fewer than two.
- Cursors are view state like the zoom: saved in the file, not part of undo, not marking the project unsaved.

## One-shot and table generators
- These start at the signal's **start time** (stored as the delay, so dragging moves them).
- Exponential: y = final + (initial − final)·e^(−(t − start)/τ) for t ≥ start, `initial` before.
- Damped sinusoid: y = offset + A·e^(−u/τ)·sin(2πf·u + φ), u = t − start, `offset` before; peaks are exact
  (tan(ωu + φ) = ωτ). Phase difference with other signals is not defined for it.
- Piecewise: points (t relative to start, sorted); equal times = vertical step; linear or step (hold)
  interpolation; repeat with period = last t − first t, otherwise the first/last values hold outside.
- Bit sequences: NRZ (level for the whole bit), RZ (a 1 is high for the first half), Manchester per
  IEEE 802.3 (0 = high→low, 1 = low→high at mid-bit; G. E. Thomas uses the opposite). Idle level outside a
  non-repeating frame: low.
- For fitting the view, exponential and damped signals report a region of interest of 5τ after the start.

## Spectrum
- Window [t0, t0 + N/f1]; bin k = harmonic order k/N. Amplitudes are one-sided peak values (DC = mean);
  RMS of a harmonic = peak/√2. Phase φ refers to cos(2π·h·f1·(t − t0) + φ) (a sine starting at t0 shows −90°).
- Linear stretches use exact closed forms; smooth stretches adaptive Gauss–Legendre (≥ 6 panels per
  wavelength of the highest order); impulses from deriv() are included exactly.
- THD = √(RMS² − DC² − V1²/2) / (V1/√2), with the exact RMS of the window.
- If the window is not a whole number of the signal's periods (or the signal is aperiodic) the result is the
  Fourier series of the window repeated, which spreads energy into neighbouring orders — flagged in the dialog.

## Value limits

Beyond these, floating-point precision (and computation time) run out, so they are
refused in the parameter fields, in expressions and when opening a file:

- times (delay, window edges, breakpoints, τ, bit time, expression time arguments,
  view range): within ±10⁶ s; the smallest positive time is 1 fs;
- frequency: 1 µHz to 1 THz;
- any other value: within ±10¹⁵.

`dfinite(x, tr)` requires a rise time no longer than the input's period. Signal names
must be unique and may not contain `]`.

## Recovery copy

While a project has unsaved changes, a copy is kept in this browser's local storage
and offered for restore at the next start. It is removed once the project is saved
or the changes are discarded.

## First-order lag: lowpass(x, τ[, t0, y0])

τ·y′ + y = x. Periodic x: the exact periodic steady state y(t0) = F / (1 − e^(−T/τ)) (F = response
over one period from 0). With t0, y0: y = y0 before t0, then the steady state plus
(y0 − y_ss(t0))·e^(−(t−t0)/τ) (aperiodic x: see below). Constant and linear pieces use
closed forms. A smooth piece is integrated adaptively (Gauss–Legendre) once, at 21 Chebyshev nodes per
stretch of at most 8τ, and later evaluated by barycentric interpolation (spectral convergence; checked against an independent RK4 integration to 1e-6),
so a filter fed by another filter costs a few dozen operations per call instead of a nested integration.
Each piece starts from the feature's *right* limit. **Aperiodic x** is "at rest until t0 (or 0)", but a query
far from the start is computed from rest 45τ earlier (the older state has decayed below 3·10⁻²⁰ of its
size), so the result differs from the exact walk from t0 by far less than the display resolution and
the cost does not grow with t. Impulses of x are ignored (warning).

## Rectifiers and phase control

- v_s = √2·V_s·sin ωt; three-phase v_a, v_b, v_c at 0°, −120°, +120° (V_s = RMS phase voltage).
- θ = ωt in degrees (0…360, rising sawtooth). α is measured from the natural commutation point.
- Ideal devices, no source inductance. "R load" circuits are exact; "continuous current" circuits
  assume the load current never reaches zero (check it on the computed current).
- Three-phase thyristor bridge: the most positive (negative) phase is selected with a delay of
  α/(360 f), i.e. each thyristor keeps conducting for α past the natural commutation.

## PWM: zero-sequence references and loads

- Three-phase modulating signal v_ref,k = v_k + v₀ with v₀ = (m/6) sin 3θ (third harmonic),
  −(max + min)/2 (space vector), or 1 − max / −1 − min by the sign of max + min (DPWM1; rails at
  ±(1 + 10⁻⁶) so a clamped reference never touches the carrier peak). Linear up to m = 2/√3.
- A reference frequency of 0 is a DC reference for single-phase topologies (constant duty (1 + m)/2;
  three-phase refuses it).
- When the carrier is much faster than the reference *and* dead time or a load is requested, the signals
  have very many edges: the first view is limited to 100 carrier cycles and the dialog warns.
- Load currents: single-phase lowpass((v − E)/R, L/R); three-phase balanced star with isolated neutral:
  v_aN = (2v_A0 − v_B0 − v_C0)/3, i_a = lowpass(v_aN/R, L/R).
- With dead time and a load: v_X0,dt = V_dc·(S_X+ + (1 − S_X+ − S_X−)·[i_X < 0]); the leg current
  direction comes from the current computed with the ideal voltages (first-order model, accurate
  except where the current ripple crosses zero).

## Power

P = mean(v·i), S = V_rms·I_rms, PF = P/S, N = √(S² − P²). Fundamentals from the exact Fourier series over
whole periods of the automatic fundamental starting at the interval start: Q₁ = V₁I₁ sin φ₁ (RMS values,
φ₁ = angle of v₁ − angle of i₁, positive = inductive), DPF = cos φ₁.
Crest factor = max |x| / RMS; form factor = RMS / mean |x|.

## Signal generation

- Chirp: u = t − start, linear φ = φ₀ + 2π(f₀u + (f₁ − f₀)u²/2T), logarithmic
  φ = φ₀ + 2πf₀T((f₁/f₀)^(u/T) − 1)/ln(f₁/f₀); outside [0, T) the value is the offset (or the sweep
  repeats with period T). Extrema where φ = π/2 + nπ, solved exactly.
- Noise: sample k (time start + k·Δt) from a 32-bit integer hash of (seed, k); Gaussian by Box–Muller.
  The `length` samples are normalised to exactly the mean and σ (σ < 0 inverts) and repeat. Linear
  interpolation lowers the RMS of the AC part below σ; "hold" keeps it exact.
- PRBS-n: Fibonacci LFSR with the standard maximal-length taps (e.g. PRBS-7 x⁷ + x⁶ + 1,
  PRBS-15 x¹⁵ + x¹⁴ + 1), output = register LSB, NRZ, period 2ⁿ − 1 bits.
- quantize(x, q) = q·round(x/q) (ties away from −∞, as Math.round); zoh(x, Ts) = x(k·Ts) on [k·Ts, (k+1)·Ts).
- Modulation: m(t) normalised to ±1; FM phase 2π·Δf·∫m dt (from t = 0); θ_c is a 0…2π ramp so the result is
  periodic. Spectrum THD is shown only when the fundamental exceeds 0.1 % of the RMS.

## Second-order filters: lowpass2 / bandpass2 / highpass2 (x, f0, Q)

H_LP = ω₀²/(s² + (ω₀/Q)s + ω₀²), H_BP = (ω₀/Q)s/(…) (unity gain at f₀), H_HP = s²/(…), ω₀ = 2πf₀.
Series RLC driven by v: capacitor voltage = LP with f₀ = 1/(2π√(LC)), Q = √(L/C)/R; resistor voltage = BP;
inductor voltage = HP. Stepping uses the closed-form state transition e^{Ah} (cos/sin, cosh/sinh or critical
case) and, for constant and linear input pieces, the exact forced response via A⁻¹; smooth pieces use
Gauss–Legendre sub-steps. Periodic input: periodic steady state x(0) = (I − e^{AT})⁻¹F; aperiodic: at rest
before t = 0, with a far query started from rest 45/(slowest decay rate) earlier, as for `lowpass`.
First-order high-pass: `x − lowpass(x, τ)`.

## Serial protocols

- Bit sequences may idle low or high outside the frame (UART and I²C idle high).
- UART: start bit 0, data LSB first, parity (even/odd) over the data bits, 1–2 stop bits, optional idle bits;
  optionally a bit clock (CLK, one period per bit, rising edge in the middle of the bit = sampling point).
- SPI: mode = 2·CPOL + CPHA; CPHA 0 samples on the leading clock edge (data changes on the trailing edge),
  CPHA 1 samples on the trailing edge; CS active low, MSB first unless chosen otherwise; one idle half-period
  of clock before the first and after the last bit.
- I²C: START = SDA falling while SCL high; data changes in the middle of SCL low; 7-bit address + R/W
  (1 = read); ACK = 0, NACK (1) after the last byte of a read; STOP = SDA rising while SCL high.

## XY and eye views

XY: the curve (x(t), y(t)) over the visible window with both signals' feature times included (exact corners,
jumps as two points); "equal scales" gives both axes the same data span. Eye: windows of 2 UI starting at
t0 + k·UI, k = 0…N − 1; the eye height is (lowest value above the threshold) − (highest value below it) at the
centre (1 UI), the threshold being the middle of the signal's range.

## Edge and pulse measurements
Computed on the curve drawn in the measured window. The two levels, *top* and *base*, are the most-occupied
levels in the upper and lower half of the range (a two-pass histogram, so ringing and noise do not move them);
with no two clear levels, 10 % and 90 % of min–max are used and the panel says so. The swing is top − base.
Rise and fall time: 10 %–90 % of the swing. Pulse widths: between 50 % crossings. Overshoot / undershoot:
excursion beyond top / below base, in % of the swing, shown only above 0.5 % of the swing. Settling time:
from the first 50 % crossing until the signal enters a band of ±2 % **of the swing** around the top level and
stays there until the plateau ends (the next fall through 50 %); not reported if it never enters the band.

## CSV import
Delimiter: the candidate (`,` `;` tab, space) that gives several columns consistently *and* the most fully
numeric rows (so `;` with decimal commas is not read as comma-separated). A decimal comma is assumed only
when the delimiter is not a comma and a field looks like `1,5`. Only finite numbers are values (`1e999` is
rejected). The time column is the first strictly increasing column; its unit comes from the header
(`ms`, `[us]`, …). More than 150 000 rows: each signal is reduced to about 150 000 points, keeping the minimum
and maximum of every bucket (so no peak is lost). Imported data becomes *piecewise* generators (straight lines or steps). Data outside the project file's limits
(|time| > 10⁶ s, |value| > 10¹⁵) is refused with a message, because such a project could not be reopened.
A table of more than 200 points is not listed row by row in the Properties panel.

## Share links
`#share=` followed by one letter and base64url text. `d` = raw-deflate-compressed project JSON, `r` = the JSON
uncompressed (used when compression does not help). Decompression is capped at 8 MB. A link longer than
8 000 characters triggers a warning (some chat tools cut long URLs). The fragment after `#` is never sent to
a server.

## Compute budget
Signals are evaluated synchronously, so a pathological one would freeze the page. Hot loops call
`checkBudget()`; the outermost evaluation of a derived signal has 3 s (`setComputeBudget`). On overrun the
signal is flagged "heavy" for 15 s, answers *undefined* at once, is left out of the drawing, and the status
bar says why. Drawing a figure shares an 8 s allowance across all traces (each trace at most 4 s), the automatic
vertical range 3 s per signal, a spectrum 8 s, a measurement-panel pass 4 s. Editing the project recompiles
the signal and clears the flag.
