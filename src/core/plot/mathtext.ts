/**
 * Lightweight math markup for labels (signal names, axis titles, legend).
 *
 *   V_out, V_{out}      subscript (single character, or a {group})
 *   I^2, e^{-t/\tau}    superscript
 *   \omega \Delta \phi  Greek letters and common symbols (LaTeX names)
 *   90^\circ            degree sign
 *   \_ \^ \\ \{ \}      literal characters
 *   \hat{v} \bar{x} \vec{E} \dot{x} \tilde{H} \overline{AB}   accents (combining characters)
 *   \mathrm{max} \text{rms}  font commands: the argument is shown in the label font
 *   $…$                LaTeX math delimiters are ignored, so labels can be pasted from LaTeX
 *
 * Output is a list of runs rendered as SVG <tspan>s (still editable text in SVG
 * exports) or as HTML <sub>/<sup>. Sub/superscripts do not nest: markup inside
 * a group is shown literally, apart from symbols.
 */

export type Shift = 'none' | 'sub' | 'sup';

export interface Run {
  text: string;
  shift: Shift;
}

export const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
  rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ',
  Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', circ: '∘', deg: '°', degree: '°',
  infty: '∞', int: '∫', oint: '∮', sum: '∑', prod: '∏', sqrt: '√', partial: '∂', nabla: '∇',
  approx: '≈', sim: '∼', neq: '≠', ne: '≠', leq: '≤', le: '≤', geq: '≥', ge: '≥', ll: '≪', gg: '≫',
  equiv: '≡', propto: '∝', angle: '∠', perp: '⊥', parallel: '∥', ell: 'ℓ', hbar: 'ℏ', Re: 'ℜ', Im: 'ℑ',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftrightarrow: '⇔',
  uparrow: '↑', downarrow: '↓', ohm: 'Ω', micro: 'µ', minus: '−', ldots: '…', dots: '…',
  ',': ' ', ';': ' ', quad: ' ', ' ': ' ',
};

const LITERAL_ESCAPES = new Set(['_', '^', '\\', '{', '}', '$', '%', '#', '&']);

/** Accents rendered with Unicode combining characters (after each character of the argument). */
const ACCENTS: Record<string, string> = {
  hat: '\u0302',
  widehat: '\u0302',
  bar: '\u0304',
  overline: '\u0305',
  dot: '\u0307',
  ddot: '\u0308',
  tilde: '\u0303',
  widetilde: '\u0303',
  vec: '\u20d7',
};
/** Font commands: the argument is shown as is (the label font is used). */
const FONT_COMMANDS = new Set(['mathrm', 'text', 'textrm', 'mathit', 'mathbf', 'textbf', 'textit', 'mathsf', 'operatorname']);

/** Read "\name" (letters) or "\x" (single non-letter) starting at i (pointing at the backslash). */
function readCommand(src: string, i: number): { text: string; end: number } {
  const m = /^[A-Za-z]+/.exec(src.slice(i + 1));
  if (m) {
    const name = m[0];
    if (ACCENTS[name] !== undefined || FONT_COMMANDS.has(name)) {
      let j = i + 1 + name.length;
      while (src[j] === ' ') j++;
      const arg = readArgument(src, j);
      if (arg) {
        const mark = ACCENTS[name];
        const text = mark ? [...arg.text].map((c) => c + mark).join('') : arg.text;
        return { text, end: arg.end };
      }
    }
    const sym = SYMBOLS[name];
    return { text: sym ?? `\\${name}`, end: i + 1 + name.length };
  }
  const ch = src[i + 1];
  if (ch === undefined) return { text: '\\', end: i + 1 };
  if (LITERAL_ESCAPES.has(ch)) return { text: ch, end: i + 2 };
  const sym = SYMBOLS[ch];
  return { text: sym ?? `\\${ch}`, end: i + 2 };
}

/** Plain text of a group's content: symbols resolved, nested markup kept literally. */
function groupText(content: string): string {
  let out = '';
  for (let i = 0; i < content.length; ) {
    if (content[i] === '\\') {
      const c = readCommand(content, i);
      out += c.text;
      i = c.end;
    } else {
      out += content[i];
      i++;
    }
  }
  return out;
}

/** Read the argument after _ or ^ at position i: {group}, \command or one character. */
function readArgument(src: string, i: number): { text: string; end: number } | null {
  const ch = src[i];
  if (ch === undefined) return null;
  if (ch === '{') {
    let depth = 1;
    let j = i + 1;
    for (; j < src.length && depth > 0; j++) {
      if (src[j] === '\\') {
        j++;
        continue;
      }
      if (src[j] === '{') depth++;
      else if (src[j] === '}') depth--;
    }
    if (depth !== 0) return null; // unbalanced: treat literally
    return { text: groupText(src.slice(i + 1, j - 1)), end: j };
  }
  if (ch === '\\') return readCommand(src, i);
  return { text: ch, end: i + 1 };
}

export function parseMath(src: string): Run[] {
  const runs: Run[] = [];
  const push = (text: string, shift: Shift) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.shift === shift) last.text += text;
    else runs.push({ text, shift });
  };

  for (let i = 0; i < src.length; ) {
    const ch = src[i]!;
    if (ch === '$') {
      // LaTeX math delimiters ($…$) are accepted and ignored.
      i++;
      continue;
    }
    if (ch === '\\') {
      const c = readCommand(src, i);
      push(c.text, 'none');
      i = c.end;
    } else if (ch === '_' || ch === '^') {
      const arg = readArgument(src, i + 1);
      if (!arg || arg.text === '') {
        push(ch, 'none');
        i++;
        continue;
      }
      // ^\circ (or ^{\circ}) is the degree sign, not a superscript ring.
      if (ch === '^' && (arg.text === '∘' || arg.text === '°')) push('°', 'none');
      else push(arg.text, ch === '_' ? 'sub' : 'sup');
      i = arg.end;
    } else {
      push(ch, 'none');
      i++;
    }
  }
  return runs;
}

/** Text without markup, e.g. for file names and accessibility. */
export function plainText(src: string): string {
  return parseMath(src)
    .map((r) => r.text)
    .join('');
}

export const SHIFT_SIZE = 0.72;
export const SUB_DY = 0.28;
export const SUP_DY = -0.4;

/** Rough rendered width (in font-size units × size) for layout of legends. */
export function estimateWidth(src: string, fontSize: number): number {
  return parseMath(src).reduce((w, r) => w + r.text.length * fontSize * 0.58 * (r.shift === 'none' ? 1 : SHIFT_SIZE), 0);
}
