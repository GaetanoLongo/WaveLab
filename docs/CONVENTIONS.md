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
