/** Figure style settings: preset + overrides (colours, text, legend, layout). Stored in the project. */

import { resolveTheme, THEMES, type LegendPosition, type StyleOverrides } from '../../core/plot/layout';
import { actions, useActiveFigure } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { Modal, useDialogs } from '../Modal';

const close = () => useDialogs.setState({ settings: false });

export function FigureSettingsDialog() {
  const open = useDialogs((s) => s.settings);
  return open ? <Dialog /> : null;
}

function Dialog() {
  const fig = useActiveFigure();
  const o: StyleOverrides = fig.style ?? {};
  const th = resolveTheme(fig.stylePreset, o);
  const set = (patch: StyleOverrides, key?: string) => actions.setStyle(patch, key);
  const font = o.font ?? 'sans';

  return (
    <Modal
      title="Figure settings"
      onClose={close}
      className="settings-dialog"
      footer={
        <>
          <button onClick={actions.resetStyle} disabled={!fig.style} title="Remove all overrides and use the preset as is">
            Reset to preset
          </button>
          <button className="primary" onClick={close}>
            Done
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <section>
          <h3>Style</h3>
          <div className="field">
            <label>Preset</label>
            <select value={fig.stylePreset} onChange={(e) => actions.setStylePreset(e.target.value)}>
              {Object.values(THEMES).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <p className="hint-text">Settings below override the preset for this project. Applies on screen and in exports.</p>

          <h3>Colours</h3>
          <div className="field">
            <label>Background</label>
            <div className="field-inline">
              <input
                type="color"
                value={th.background ?? '#ffffff'}
                disabled={th.background === null}
                onChange={(e) => set({ background: e.target.value }, 'style-bg')}
              />
              <label className="check">
                <input type="checkbox" checked={th.background === null} onChange={(e) => set({ background: e.target.checked ? null : '#ffffff' })} />
                None
              </label>
            </div>
          </div>
          <div className="field">
            <label>Plot area</label>
            <input type="color" value={th.plotBackground.startsWith('#') ? th.plotBackground : '#ffffff'} onChange={(e) => set({ plotBackground: e.target.value }, 'style-plotbg')} />
          </div>
          <div className="field">
            <label>Grid colour</label>
            <input type="color" value={th.gridMajor} onChange={(e) => set({ gridColor: e.target.value }, 'style-grid')} />
          </div>
          <NumberField
            label="Grid opacity"
            unit="%"
            plain
            scale={100}
            min={0}
            max={1}
            value={th.gridMajorOpacity}
            onCommit={(v) => set({ gridOpacity: v })}
          />
          <label className="check">
            <input type="checkbox" checked={th.gridMinorOpacity > 0} onChange={(e) => set({ minorGrid: e.target.checked })} />
            Minor grid lines
          </label>
        </section>

        <section>
          <h3>Text</h3>
          <div className="field">
            <label>Font</label>
            <select value={font} onChange={(e) => set({ font: e.target.value as StyleOverrides['font'] })}>
              <option value="sans">Sans-serif (Inter)</option>
              <option value="serif">Serif</option>
              <option value="mono">Monospace</option>
            </select>
          </div>
          {font !== 'sans' && (
            <p className="warn">
              Only Inter is embedded in PDF exports. With serif/monospace the PDF uses standard PDF fonts, which lack Greek letters and some
              symbols. PNG and SVG use the fonts installed on the computer.
            </p>
          )}
          <NumberField label="Font size" unit="px" plain min={6} max={40} value={th.fontSize} onCommit={(v) => set({ fontSize: v })} />

          <h3>Legend</h3>
          <label className="check">
            <input type="checkbox" checked={fig.showLegend} onChange={(e) => actions.setShowLegend(e.target.checked)} />
            Show legend (overlay mode)
          </label>
          <div className="field">
            <label>Position</label>
            <select value={th.legend} onChange={(e) => set({ legend: e.target.value as LegendPosition })}>
              <option value="top-right">Top right</option>
              <option value="top-left">Top left</option>
              <option value="bottom-right">Bottom right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="outside-right">Outside, right</option>
              <option value="none">Hidden</option>
            </select>
          </div>

          <h3>Layout</h3>
          <div className="field">
            <label>Margins</label>
            <select value={th.margins} onChange={(e) => set({ margins: e.target.value as StyleOverrides['margins'] })}>
              <option value="compact">Compact</option>
              <option value="normal">Normal</option>
              <option value="wide">Wide</option>
            </select>
          </div>
          <NumberField
            label="Line widths ×"
            plain
            min={0.25}
            max={5}
            value={th.lineScale}
            title="Multiplies every trace's line width (e.g. 1.8 for slides)"
            onCommit={(v) => set({ lineScale: v })}
          />
          <p className="hint-text">Figure size and aspect ratio are chosen when exporting (Export dialog).</p>
        </section>
      </div>
    </Modal>
  );
}
