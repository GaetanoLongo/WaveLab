/** Toolbar popover with the snapping configuration (application preference). */

import { useEffect, useRef, useState } from 'react';
import { updateSnap, useSettings } from '../../state/settings';
import { NumberField } from '../fields/NumberField';
import { Icon } from '../icons';

const MODES = [
  ['grid', 'Time grid', 'Align to fixed time intervals'],
  ['edges', 'Signal edges', 'Align rising/falling edges and corners'],
  ['zeros', 'Zero crossings', 'Align zero crossings (and to t = 0)'],
  ['peaks', 'Peaks', 'Align maxima and minima'],
  ['phase', 'Phase', 'Move in steps of electrical degrees of the dragged signal'],
  ['period', 'Period', 'Align complete cycles (cycle starts)'],
] as const;

export function SnapMenu() {
  const snap = useSettings((s) => s.snap);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="popover-anchor" ref={ref}>
      <button
        className={`icon tb${snap.enabled ? ' active' : ''}`}
        title="Grid & snap settings"
        aria-label="Grid & snap settings"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="magnet" />
      </button>
      {open && (
        <div className="popover snap-menu" role="dialog" aria-label="Snap settings">
          <label className="check strong">
            <input type="checkbox" checked={snap.enabled} onChange={(e) => updateSnap({ enabled: e.target.checked })} />
            Snapping enabled
          </label>
          <p className="hint-text">Hold Alt while dragging to move freely. t = 0 is always a target.</p>
          <fieldset disabled={!snap.enabled}>
            {MODES.map(([k, label, title]) => (
              <label key={k} className="check" title={title}>
                <input type="checkbox" checked={snap[k]} onChange={(e) => updateSnap({ [k]: e.target.checked })} />
                <span>{label}</span>
                <span className="mode-desc">{title}</span>
              </label>
            ))}
            <div className="snap-params">
              <div className="field">
                <label>Grid step</label>
                <select
                  value={snap.gridStep === null ? 'auto' : 'custom'}
                  onChange={(e) => updateSnap({ gridStep: e.target.value === 'auto' ? null : 0.001 })}
                >
                  <option value="auto">Auto (minor ticks)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
              {snap.gridStep !== null && (
                <NumberField label="Custom step" unit="s" positive value={snap.gridStep} onCommit={(v) => updateSnap({ gridStep: v })} />
              )}
              <NumberField label="Phase step" unit="°" plain positive max={180} value={snap.phaseStepDeg} onCommit={(v) => updateSnap({ phaseStepDeg: v })} />
              <NumberField label="Capture radius" unit="px" plain min={1} max={40} value={snap.thresholdPx} onCommit={(v) => updateSnap({ thresholdPx: v })} />
            </div>
          </fieldset>
        </div>
      )}
    </div>
  );
}
