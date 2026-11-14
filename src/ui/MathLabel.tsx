/** Renders math markup (V_{out}, \omega, I^2) as HTML with <sub>/<sup>. */

import { parseMath } from '../core/plot/mathtext';

export function MathLabel({ text }: { text: string }) {
  const runs = parseMath(text);
  if (runs.length === 1 && runs[0]!.shift === 'none') return <>{runs[0]!.text}</>;
  return (
    <>
      {runs.map((r, i) =>
        r.shift === 'sub' ? <sub key={i}>{r.text}</sub> : r.shift === 'sup' ? <sup key={i}>{r.text}</sup> : <span key={i}>{r.text}</span>,
      )}
    </>
  );
}
