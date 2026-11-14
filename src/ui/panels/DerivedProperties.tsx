/** Properties of a derived (expression) signal: expression editor, logic levels, resolution. */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { storedAst } from '../../core/model/deps';
import type { DerivedSignalDef } from '../../core/model/project';
import { FUNCTIONS, isLogic, nameToken, refsOf, walk } from '../../core/expr/parse';
import { formatSI } from '../../core/units/si';
import { compiled } from '../../state/compiled';
import { actions, exprToDisplay, useEditor } from '../../state/store';
import { NumberField } from '../fields/NumberField';
import { MathLabel } from '../MathLabel';
import { GeneralGroup, Group, Readout, StyleParams, type UpdAny } from './PropertiesPanel';

export function DerivedProperties({ sig }: { sig: DerivedSignalDef }) {
  const project = useEditor((s) => s.project);
  const ast = storedAst(sig.expr);
  const logic = !!ast && isLogic(ast);
  const usesThreshold =
    !!ast && walk(ast).some((n) => n.k === 'not' || (n.k === 'bin' && (n.op === '&&' || n.op === '||')) || (n.k === 'call' && ['and', 'or', 'xor', 'not'].includes(n.fn)));
  const inputs = ast ? [...refsOf(ast)].map((id) => project.signals.find((s) => s.id === id)) : [];
  const updAny: UpdAny = (recipe, key) => actions.updateSignal(sig.id, recipe, key);
  const upd = (recipe: (s: DerivedSignalDef) => void, key?: string) =>
    actions.updateSignal(sig.id, (s) => void (s.kind === 'derived' && recipe(s)), key);
  const ev = compiled(sig, project);
  const dis = sig.locked;

  return (
    <section className="properties" aria-label="Properties">
      <h2>
        Properties <span className="kind">{logic ? 'Logic expression' : 'Expression'}</span>
      </h2>
      {dis && <p className="locked-note">Locked: unlock the signal in the list to edit it.</p>}
      <fieldset disabled={dis}>
        <GeneralGroup sig={sig} upd={updAny} />

        <Group title="Expression">
          <ExpressionField sig={sig} />
          <div className="inputs-row">
            <span className="muted">Inputs:</span>
            {inputs.length === 0 && <span className="muted">none</span>}
            {inputs.map((s, i) =>
              s ? (
                <button key={s.id} className="chip" title="Select this input" onClick={() => actions.select(s.id)}>
                  <span className="chip-dot" style={{ background: s.style.color }} />
                  <MathLabel text={s.name} />
                </button>
              ) : (
                <span key={i} className="chip missing">missing</span>
              ),
            )}
          </div>
          <details className="expr-help">
            <summary>Syntax help</summary>
            <p>
              Operators <code>+ - * / ^</code>, comparisons <code>&gt; &lt; &gt;= &lt;=</code>, logic <code>&amp;&amp; || !</code>. Names with spaces or
              markup go in brackets: <code>[Sine 2]</code>. Numbers accept SI prefixes: <code>1m</code> = 0.001. <code>t</code> is time,{' '}
              <code>pi</code>, <code>e</code> constants. Start with <code>Name =</code> to rename.
            </p>
            <ul>
              {Object.entries(FUNCTIONS).map(([k, f]) => (
                <li key={k}>
                  <code>{f.doc.split(' — ')[0]}</code>
                  {f.doc.includes(' — ') ? ` — ${f.doc.split(' — ')[1]}` : ''}
                </li>
              ))}
            </ul>
          </details>
        </Group>

        {(logic || usesThreshold) && (
          <Group title="Logic">
            {logic && (
              <>
                <NumberField label="High level" unit={sig.unit} value={sig.logicHigh} onCommit={(v) => upd((s) => void (s.logicHigh = v))} />
                <NumberField label="Low level" unit={sig.unit} value={sig.logicLow} onCommit={(v) => upd((s) => void (s.logicLow = v))} />
              </>
            )}
            {usesThreshold && (
              <NumberField
                label="Threshold"
                title="Analog inputs of and/or/xor/not/!/&&/|| count as 1 above this value"
                unit={sig.unit}
                value={sig.threshold}
                onCommit={(v) => upd((s) => void (s.threshold = v))}
              />
            )}
          </Group>
        )}

        <Group title="Computation" defaultOpen={false}>
          <div className="field">
            <label>Resolution</label>
            <select
              value={sig.resolution === null ? 'auto' : 'custom'}
              onChange={(e) => upd((s) => void (s.resolution = e.target.value === 'auto' ? null : (ev.scale ?? 0.02) / 64))}
            >
              <option value="auto">Automatic</option>
              <option value="custom">Custom step</option>
            </select>
          </div>
          {sig.resolution !== null && (
            <NumberField label="Step" unit="s" positive value={sig.resolution} onCommit={(v) => upd((s) => void (s.resolution = v))} />
          )}
          <Readout
            items={[
              ['Sampling', sig.resolution === null ? (ev.scale ? `${formatSI(ev.scale / 64, 's')} (1/64 of ${formatSI(ev.scale, 's')})` : 'view-based') : formatSI(sig.resolution, 's')],
              ['Period', ev.period ? formatSI(ev.period, 's') : 'aperiodic'],
            ]}
          />
          <p className="hint-text">
            Edges, corners and peaks are located exactly; the step only limits how close two switching events inside one segment may be
            and still both be found. This is separate from the on-screen drawing resolution.
          </p>
        </Group>

        <StyleParams sig={sig} upd={updAny} disabled={dis} />

        <div className="prop-actions">
          <button onClick={() => actions.invert(sig.id)} title={logic ? 'Swap high and low levels' : 'Negate the expression'}>
            Invert
          </button>
          <button onClick={() => actions.fitSelected()}>Fit to signal</button>
        </div>
      </fieldset>
    </section>
  );
}

interface Suggestion {
  label: string;
  insert: string;
  detail: string;
}

/** Expression editor: Enter applies, Shift+Enter = newline, Escape reverts; autocomplete for names/functions. */
function ExpressionField({ sig }: { sig: DerivedSignalDef }) {
  const project = useEditor((s) => s.project);
  const display = exprToDisplay(project, sig.expr);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; pos: number } | null>(null);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Caret position to restore right after the next render (before paint, so fast typing is safe). */
  const pendingCaret = useRef<number | null>(null);
  const text = draft ?? display;

  useLayoutEffect(() => {
    const pos = pendingCaret.current;
    if (pos !== null && ref.current) {
      pendingCaret.current = null;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
    }
  });

  const prefix = useMemo(() => {
    const before = text.slice(0, caret);
    const m = /(\[[^\]]*|[\p{L}_][\p{L}\p{N}_]*)$/u.exec(before);
    return m ? m[1]! : '';
  }, [text, caret]);

  const suggestions = useMemo<Suggestion[]>(() => {
    if (draft === null || !prefix || dismissed) return [];
    const q = prefix.replace(/^\[/, '').toLowerCase();
    const sigs = project.signals
      .filter((s) => s.id !== sig.id)
      .map((s) => ({ label: s.name, insert: nameToken(s.name), detail: s.kind === 'derived' ? 'expression' : s.kind }));
    const fns = Object.entries(FUNCTIONS).map(([k, f]) => ({ label: `${k}()`, insert: `${k}(`, detail: f.doc.split(' — ')[1] ?? '' }));
    const consts = [
      { label: 't', insert: 't', detail: 'time' },
      { label: 'pi', insert: 'pi', detail: 'π' },
    ];
    const pool = prefix.startsWith('[') ? sigs : [...sigs, ...fns, ...consts];
    return pool.filter((x) => x.label.toLowerCase().startsWith(q) && x.insert !== prefix).slice(0, 8);
  }, [draft, prefix, dismissed, project, sig.id]);

  const accept = (sug: Suggestion) => {
    const before = text.slice(0, caret - prefix.length);
    const after = text.slice(caret);
    const next = before + sug.insert + after;
    const pos = before.length + sug.insert.length;
    pendingCaret.current = pos;
    setDraft(next);
    setCaret(pos);
    setActive(0);
  };

  const commit = () => {
    if (draft === null || draft === display) {
      setDraft(null);
      setError(null);
      return true;
    }
    const err = actions.setExpression(sig.id, draft);
    if (err) {
      setError(err);
      return false;
    }
    setDraft(null);
    setError(null);
    return true;
  };

  return (
    <div className="expr-field">
      <div className="expr-wrap">
        <textarea
          ref={ref}
          className={`expr-input${error ? ' invalid' : ''}`}
          value={text}
          rows={Math.min(4, Math.max(1, Math.ceil(text.length / 34)))}
          spellCheck={false}
          aria-label="Expression"
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setCaret(e.target.selectionStart);
            setActive(0);
            setDismissed(false);
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onBlur={() => {
            // Leave invalid drafts visible with their error; valid ones are applied.
            if (suggestions.length === 0) commit();
          }}
          onKeyDown={(e) => {
            if (suggestions.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                return;
              }
              if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                accept(suggestions[active]!);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setDismissed(true);
                return;
              }
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (commit()) ref.current?.blur();
            } else if (e.key === 'Escape') {
              setDraft(null);
              setError(null);
              ref.current?.blur();
            }
          }}
        />
        {suggestions.length > 0 && (
          <ul className="suggest" role="listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.label}
                role="option"
                aria-selected={i === active}
                className={i === active ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
              >
                <span>{s.label}</span>
                <span className="detail">{s.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <div className="field-error expr-error" role="alert">
          {error.message}
          <pre>
            {text.slice(Math.max(0, error.pos - 24), error.pos)}
            <mark>{text.slice(error.pos, error.pos + 1) || ' '}</mark>
            {text.slice(error.pos + 1, error.pos + 16)}
          </pre>
        </div>
      )}
      {draft !== null && !error && <div className="hint-text">Enter to apply · Shift+Enter new line · Esc to cancel</div>}
    </div>
  );
}
