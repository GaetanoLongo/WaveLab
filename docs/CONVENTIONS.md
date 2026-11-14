# WaveLab mathematical conventions

These rules are part of the file format: changing them later needs a schema migration.

## Time and phase
- Global time `t` is in seconds. Every signal sits on the same global timeline.
- **Phase φ** (degrees) belongs to the signal's definition. **+φ leads**:
  `f(t) = g(ω·(t − delay) + φ)`. At 50 Hz, +120° = the signal happens 6.667 ms *earlier*.
- **Delay** (seconds) is the signal's position on the global timeline. Positive = shift right.
  Dragging a signal changes only its delay.
- Derived signals (from M6 on) follow their inputs and cannot be dragged. To shift one,
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
