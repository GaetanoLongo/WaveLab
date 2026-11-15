/**
 * Numeric input with SI prefixes and units ("6.667m", "50 kHz", "1µs").
 * Shows a formatted value; commits on Enter or blur; Escape reverts.
 * Invalid input is flagged and not committed.
 */

import { useId, useRef, useState } from 'react';
import { formatSI, parseSI } from '../../core/units/si';

export interface NumberFieldProps {
  label: string;
  value: number;
  unit?: string;
  /** Display multiplier (e.g. 100 for a fraction shown in %). */
  scale?: number;
  /** Plain formatting without SI prefixes (degrees, %). */
  plain?: boolean;
  min?: number;
  max?: number;
  /** Exclusive minimum (e.g. frequency > 0). */
  positive?: boolean;
  digits?: number;
  disabled?: boolean;
  title?: string;
  onCommit(value: number): void;
}

export function formatField(v: number, unit: string, plain: boolean, digits: number): string {
  if (!Number.isFinite(v)) return '';
  if (plain) {
    const s = Number(v.toPrecision(digits)).toString();
    if (!unit) return s;
    return unit === '°' ? `${s}°` : `${s} ${unit}`;
  }
  return formatSI(v, unit, digits);
}

/** Default magnitude limits per unit (overridable with min/max). */
const LIMITS: Record<string, { maxAbs: number; minPositive: number }> = {
  s: { maxAbs: 1e6, minPositive: 1e-15 },
  Hz: { maxAbs: 1e12, minPositive: 1e-6 },
  '': { maxAbs: 1e15, minPositive: 1e-300 },
};

export function NumberField(p: NumberFieldProps) {
  const unit = p.unit ?? '';
  const scale = p.scale ?? 1;
  const digits = p.digits ?? 6;
  const shown = formatField(p.value * scale, unit, p.plain ?? false, digits);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const ref = useRef<HTMLInputElement>(null);
  /** Set before a programmatic blur (Enter/Escape) so the blur handler does not commit again. */
  const skipBlur = useRef(false);

  const validate = (raw: string): { v?: number; err?: string } => {
    const r = parseSI(raw, unit || undefined);
    if (!r) return { err: unit ? `Enter a number, optionally with an SI prefix and “${unit}”` : 'Enter a number' };
    const v = r.value / scale;
    if (p.positive && !(v > 0)) return { err: 'Must be greater than 0' };
    // Sanity limits by unit: beyond these, floating-point precision (and computation time) run out.
    const lim = LIMITS[unit] ?? LIMITS['']!;
    if (!Number.isFinite(v) || Math.abs(v) > lim.maxAbs) return { err: `Must be within ±${formatField(lim.maxAbs * scale, unit, p.plain ?? false, 4)}` };
    if (p.positive && v < lim.minPositive) return { err: `Minimum is ${formatField(lim.minPositive * scale, unit, p.plain ?? false, 4)}` };
    if (p.min !== undefined && v < p.min) return { err: `Minimum is ${formatField(p.min * scale, unit, p.plain ?? false, 4)}` };
    if (p.max !== undefined && v > p.max) return { err: `Maximum is ${formatField(p.max * scale, unit, p.plain ?? false, 4)}` };
    return { v };
  };

  const commit = () => {
    const { v, err } = validate(text);
    if (err !== undefined || v === undefined) {
      setError(err ?? 'Invalid');
      return false;
    }
    setError(null);
    setEditing(false);
    if (v !== p.value) p.onCommit(v);
    return true;
  };

  return (
    <div className="field">
      <label htmlFor={id} title={p.title}>
        {p.label}
      </label>
      <input
        id={id}
        ref={ref}
        className={error ? 'invalid' : ''}
        value={editing ? text : shown}
        disabled={p.disabled}
        title={error ?? p.title}
        aria-invalid={error ? true : undefined}
        spellCheck={false}
        onFocus={(e) => {
          setText(shown);
          setEditing(true);
          const el = e.currentTarget;
          requestAnimationFrame(() => el.select());
        }}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(validate(e.target.value).err ?? null);
        }}
        onBlur={() => {
          if (skipBlur.current) {
            skipBlur.current = false;
            return;
          }
          // Invalid text on blur is discarded (the stored value is shown again).
          if (editing && !commit()) {
            setEditing(false);
            setError(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (commit()) {
              skipBlur.current = true;
              ref.current?.blur();
            }
          } else if (e.key === 'Escape') {
            setEditing(false);
            setError(null);
            skipBlur.current = true;
            ref.current?.blur();
          }
        }}
      />
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}
