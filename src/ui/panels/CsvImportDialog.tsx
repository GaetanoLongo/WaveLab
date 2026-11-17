/** Import measured data (CSV / TSV / text) as editable signals. */

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { guessTimeColumn, guessTimeUnit, MAX_CSV_CHARS, parseCsv, TIME_UNITS, type CsvTable, type TimeUnitId } from '../../core/io/csv';
import { formatSI } from '../../core/units/si';
import { MAX_IMPORT_POINTS } from '../../state/csvImport';
import { actions, editor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { Modal } from '../Modal';

interface Opened {
  name: string;
  table: CsvTable;
}
const useCsvDialog = create<{ file: Opened | null }>(() => ({ file: null }));
const close = () => useCsvDialog.setState({ file: null });

/** Read a text file and open the import dialog (also used for drag-and-drop). */
export async function openCsvFile(file: File): Promise<void> {
  if (file.size > MAX_CSV_CHARS) return void editor.setState({ notice: `“${file.name}” is larger than 60 MB: reduce it first.` });
  const table = parseCsv(await file.text());
  if (typeof table === 'string') {
    editor.setState({ notice: `Could not read “${file.name}”: ${table}` });
    window.alert(`Could not read “${file.name}” as data:\n\n${table}`);
    return;
  }
  useCsvDialog.setState({ file: { name: file.name, table } });
}

/** Let the user pick a file, then open it. */
export function chooseCsvFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,.tsv,.txt,.dat,text/csv,text/plain,text/tab-separated-values';
  input.className = 'hidden-file-input';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) void openCsvFile(f);
    input.remove();
  });
  input.addEventListener('cancel', () => input.remove());
  document.body.appendChild(input);
  input.click();
}

export function CsvImportDialog() {
  const file = useCsvDialog((s) => s.file);
  return file ? <Dialog key={file.name} file={file} /> : null;
}

function Dialog({ file }: { file: Opened }) {
  const { table, name } = file;
  const guessed = useMemo(() => guessTimeColumn(table), [table]);
  const [timeColumn, setTimeColumn] = useState<number | null>(guessed);
  const [timeUnit, setTimeUnit] = useState<TimeUnitId>(guessed !== null ? guessTimeUnit(table.header?.[guessed]) : 's');
  const [interval, setInterval_] = useState(1e-3);
  const [startAtZero, setStartAtZero] = useState(true);
  const [interp, setInterp] = useState<'linear' | 'step'>('linear');
  const [unit, setUnit] = useState('V');
  const labels = Array.from({ length: table.columns }, (_, c) => table.header?.[c] || `Column ${c + 1}`);
  const [chosen, setChosen] = useState<number[]>(() =>
    Array.from({ length: table.columns }, (_, c) => c).filter((c) => c !== guessed).slice(0, 8),
  );
  const [error, setError] = useState<string | null>(null);

  const scale = TIME_UNITS.find((u) => u.id === timeUnit)!.scale;
  const t0 = timeColumn === null ? 0 : table.rows[0]![timeColumn]! * scale;
  const t1 = timeColumn === null ? (table.rows.length - 1) * interval : table.rows[table.rows.length - 1]![timeColumn]! * scale;
  const cols = chosen.filter((c) => c !== timeColumn);

  const run = () => {
    const err = actions.createCsvImport(table, { timeColumn, timeUnit, sampleInterval: interval, startAtZero, columns: cols, interp, unit, fileName: name });
    if (err) return setError(err);
    close();
  };

  return (
    <Modal
      title={`Import data · ${name}`}
      onClose={close}
      className="pwm-dialog"
      footer={
        <>
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={run} disabled={cols.length === 0}>
            Import {cols.length} signal{cols.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="settings-grid">
        <section>
          <h3>Time</h3>
          <div className="field">
            <label>Time column</label>
            <select value={timeColumn ?? ''} onChange={(e) => setTimeColumn(e.target.value === '' ? null : Number(e.target.value))}>
              <option value="">None: evenly spaced samples</option>
              {labels.map((l, c) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {timeColumn !== null ? (
            <div className="field">
              <label>Time unit</label>
              <select value={timeUnit} onChange={(e) => setTimeUnit(e.target.value as TimeUnitId)}>
                {TIME_UNITS.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <NumberField label="Sample interval" unit="s" positive value={interval} onCommit={setInterval_} />
          )}
          <label className="check">
            <input type="checkbox" checked={startAtZero} onChange={(e) => setStartAtZero(e.target.checked)} />
            Start at t = 0
          </label>
          <h3>Signals</h3>
          {labels.map((l, c) =>
            c === timeColumn ? null : (
              <label key={c} className="check">
                <input type="checkbox" checked={chosen.includes(c)} onChange={(e) => setChosen((cur) => (e.target.checked ? [...cur, c] : cur.filter((x) => x !== c)))} />
                {l}
              </label>
            ),
          )}
          <div className="field">
            <label>Unit</label>
            <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="V, A, …" aria-label="Unit of the imported signals" />
          </div>
          <div className="field">
            <label>Between samples</label>
            <select value={interp} onChange={(e) => setInterp(e.target.value as 'linear' | 'step')}>
              <option value="linear">Straight lines</option>
              <option value="step">Held (steps)</option>
            </select>
          </div>
        </section>
        <section>
          <h3>Check</h3>
          <dl className="readout">
            <div>
              <dt>Rows</dt>
              <dd>{table.rows.length.toLocaleString('en')}</dd>
            </div>
            <div>
              <dt>Time span</dt>
              <dd>{startAtZero ? '0' : formatSI(t0, 's')} → {formatSI(startAtZero ? t1 - t0 : t1, 's')}</dd>
            </div>
            {timeColumn !== null && table.rows.length > 1 && (
              <div>
                <dt>Mean sample rate</dt>
                <dd>{formatSI((table.rows.length - 1) / Math.max(1e-300, t1 - t0), 'Hz')}</dd>
              </div>
            )}
          </dl>
          {table.skipped > 0 && <p className="warn">{table.skipped} line{table.skipped === 1 ? '' : 's'} could not be read as numbers and {table.skipped === 1 ? 'was' : 'were'} skipped.</p>}
          {table.rows.length > MAX_IMPORT_POINTS && (
            <p className="hint-text">More than {MAX_IMPORT_POINTS.toLocaleString('en')} rows: each signal is reduced to that size, keeping every peak.</p>
          )}
          {error && <p className="warn">{error}</p>}
          <h3>First rows</h3>
          <table className="csv-preview">
            <thead>
              <tr>
                {labels.map((l, c) => (
                  <th key={c}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.slice(0, 5).map((r, i) => (
                <tr key={i}>
                  {r.map((v, c) => (
                    <td key={c}>{Number(v.toPrecision(6))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hint-text">Creates ordinary editable signals in a new group; use the measurements, spectrum and operations on them like any other signal.</p>
        </section>
      </div>
    </Modal>
  );
}
