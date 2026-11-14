/**
 * Expression language for derived signals.
 *
 *   Vout = Vin + Vref                 optional "Name =" prefix sets the signal name
 *   [Sine 2] * 2                      [brackets] for names that are not plain identifiers
 *   (Ref > Carrier)                   comparison → logic signal
 *   and(A, B), or, xor, not           logic (analog inputs use the signal's threshold)
 *   abs, min, max, clip(x, lo, hi), sqrt, exp, ln, log10, sin, cos, tan, sign, step
 *   delay(x, 1m)                      time shift by a constant (SI prefixes allowed: 1m = 1e-3)
 *   t, pi, e                          time and constants
 *   + - * / ^, unary -, !, > < >= <=, &&, ||
 *
 * Stored form references signals by id as #{id}, so renaming a signal never breaks
 * an expression. `print` converts an AST back to text using either form.
 */

export type BinOp = '+' | '-' | '*' | '/' | '^' | '>' | '<' | '>=' | '<=' | '&&' | '||';

export type Node =
  | { k: 'num'; v: number; text: string }
  | { k: 'ref'; id: string }
  | { k: 'time' }
  | { k: 'const'; name: 'pi' | 'e' }
  | { k: 'neg'; a: Node }
  | { k: 'not'; a: Node }
  | { k: 'bin'; op: BinOp; a: Node; b: Node }
  | { k: 'call'; fn: string; args: Node[] };

export class ExprError extends Error {
  constructor(
    message: string,
    /** Character offset in the source text. */
    readonly pos: number,
  ) {
    super(message);
  }
}

export interface FnSpec {
  min: number;
  max: number;
  /** Returns a logic (0/1) value. */
  logic?: boolean;
  doc: string;
}

export const FUNCTIONS: Record<string, FnSpec> = {
  abs: { min: 1, max: 1, doc: 'abs(x) — absolute value / full-wave rectification' },
  min: { min: 2, max: 16, doc: 'min(a, b, …) — smallest input' },
  max: { min: 2, max: 16, doc: 'max(a, b, …) — largest input; max(x, 0) is half-wave rectification' },
  clip: { min: 3, max: 3, doc: 'clip(x, lo, hi) — saturation between lo and hi' },
  sqrt: { min: 1, max: 1, doc: 'sqrt(x)' },
  exp: { min: 1, max: 1, doc: 'exp(x)' },
  ln: { min: 1, max: 1, doc: 'ln(x) — natural logarithm' },
  log10: { min: 1, max: 1, doc: 'log10(x)' },
  sin: { min: 1, max: 1, doc: 'sin(x) — x in radians' },
  cos: { min: 1, max: 1, doc: 'cos(x) — x in radians' },
  tan: { min: 1, max: 1, doc: 'tan(x) — x in radians' },
  sign: { min: 1, max: 1, doc: 'sign(x) — −1, 0 or 1' },
  step: { min: 1, max: 1, logic: true, doc: 'step(x) — 1 if x ≥ 0, else 0' },
  and: { min: 2, max: 16, logic: true, doc: 'and(a, b, …) — logic AND' },
  or: { min: 2, max: 16, logic: true, doc: 'or(a, b, …) — logic OR' },
  xor: { min: 2, max: 2, logic: true, doc: 'xor(a, b) — logic exclusive OR' },
  not: { min: 1, max: 1, logic: true, doc: 'not(x) — logic NOT' },
  delay: { min: 2, max: 2, doc: 'delay(x, d) — x shifted later by the constant time d' },
};

const RESERVED = new Set(['t', 'pi', 'e', ...Object.keys(FUNCTIONS)]);

// --- tokens ---------------------------------------------------------------------

type Tok =
  | { t: 'num'; v: number; text: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'name'; v: string; pos: number } // [bracketed name]
  | { t: 'ref'; v: string; pos: number } // #{id}
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number };

const SI: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
const ID_START = /[\p{L}_]/u;
const ID_PART = /[\p{L}\p{N}_]/u;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const start = i;
    if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new ExprError(`Invalid number`, i);
      i += m[0].length;
      let v = Number(m[0]);
      let text = m[0];
      const p = src[i];
      if (p !== undefined && p in SI && !ID_PART.test(src[i + 1] ?? '')) {
        v *= SI[p]!;
        text += p;
        i++;
      }
      out.push({ t: 'num', v, text, pos: start });
    } else if (ID_START.test(c)) {
      while (i < src.length && ID_PART.test(src[i]!)) i++;
      out.push({ t: 'id', v: src.slice(start, i), pos: start });
    } else if (c === '[') {
      const end = src.indexOf(']', i + 1);
      if (end < 0) throw new ExprError('Missing “]”', i);
      const name = src.slice(i + 1, end);
      if (!name.trim()) throw new ExprError('Empty signal name', i);
      out.push({ t: 'name', v: name, pos: start });
      i = end + 1;
    } else if (c === '#' && src[i + 1] === '{') {
      const end = src.indexOf('}', i + 2);
      if (end < 0) throw new ExprError('Malformed signal reference', i);
      out.push({ t: 'ref', v: src.slice(i + 2, end), pos: start });
      i = end + 1;
    } else {
      const two = src.slice(i, i + 2);
      if (['>=', '<=', '&&', '||'].includes(two)) {
        out.push({ t: 'op', v: two, pos: start });
        i += 2;
      } else if ('+-*/^(),<>!'.includes(c)) {
        out.push({ t: 'op', v: c, pos: start });
        i++;
      } else if (c === '=') {
        throw new ExprError('“=” is only allowed once, as “Name = expression”. Equality comparison is not supported.', i);
      } else {
        throw new ExprError(`Unexpected character “${c}”`, i);
      }
    }
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

// --- parser (precedence climbing) ------------------------------------------------

/** Resolves a display name to a signal id (null = unknown). */
export type NameResolver = (name: string) => string | null;

const BIN_PREC: Record<string, number> = { '||': 1, '&&': 2, '>': 3, '<': 3, '>=': 3, '<=': 3, '+': 4, '-': 4, '*': 5, '/': 5 };

export function parseExpr(src: string, resolve: NameResolver): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const next = () => toks[p++]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === 'op' && t.v === v;
  };
  const expect = (v: string) => {
    const t = next();
    if (t.t !== 'op' || t.v !== v) throw new ExprError(`Expected “${v}”`, t.pos);
  };

  const signal = (name: string, pos: number): Node => {
    const id = resolve(name);
    if (!id) throw new ExprError(`Unknown signal “${name}”`, pos);
    return { k: 'ref', id };
  };

  function primary(): Node {
    const t = next();
    switch (t.t) {
      case 'num':
        return { k: 'num', v: t.v, text: t.text };
      case 'ref':
        return { k: 'ref', id: t.v };
      case 'name':
        return signal(t.v, t.pos);
      case 'id': {
        if (isOp('(')) {
          const spec = FUNCTIONS[t.v];
          if (!spec) throw new ExprError(`Unknown function “${t.v}”`, t.pos);
          next();
          const args: Node[] = [];
          if (!isOp(')')) {
            args.push(expr(0));
            while (isOp(',')) {
              next();
              args.push(expr(0));
            }
          }
          expect(')');
          if (args.length < spec.min || args.length > spec.max) {
            const n = spec.min === spec.max ? `${spec.min}` : `${spec.min}–${spec.max}`;
            throw new ExprError(`${t.v}() takes ${n} argument${spec.max === 1 ? '' : 's'}`, t.pos);
          }
          if (t.v === 'delay' && usesSignalOrTime(args[1]!)) throw new ExprError('delay() needs a constant time as its 2nd argument', t.pos);
          return { k: 'call', fn: t.v, args };
        }
        if (t.v === 't') return { k: 'time' };
        if (t.v === 'pi' || t.v === 'e') return { k: 'const', name: t.v };
        return signal(t.v, t.pos);
      }
      case 'op':
        if (t.v === '(') {
          const e = expr(0);
          expect(')');
          return e;
        }
        if (t.v === '-') return { k: 'neg', a: unary() };
        if (t.v === '+') return unary();
        if (t.v === '!') return { k: 'not', a: unary() };
        throw new ExprError(`Unexpected “${t.v}”`, t.pos);
      case 'end':
        throw new ExprError('Expression is incomplete', t.pos);
    }
  }

  // Power binds tighter than unary minus on its left (−x^2 = −(x^2)), right-associative.
  function power(): Node {
    const base = primary();
    if (isOp('^')) {
      next();
      return { k: 'bin', op: '^', a: base, b: unary() };
    }
    return base;
  }

  function unary(): Node {
    if (isOp('-')) {
      next();
      return { k: 'neg', a: unary() };
    }
    if (isOp('+')) {
      next();
      return unary();
    }
    if (isOp('!')) {
      next();
      return { k: 'not', a: unary() };
    }
    return power();
  }

  function expr(minPrec: number): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (t.t !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      next();
      const right = expr(prec + 1);
      left = { k: 'bin', op: t.v as BinOp, a: left, b: right };
    }
    return left;
  }

  if (peek().t === 'end') throw new ExprError('Enter an expression', 0);
  const root = expr(0);
  const rest = peek();
  if (rest.t !== 'end') throw new ExprError(`Unexpected “${'v' in rest ? rest.v : ''}”`, rest.pos);
  return root;
}

function usesSignalOrTime(n: Node): boolean {
  return refsOf(n).size > 0 || walk(n).some((x) => x.k === 'time');
}

export function walk(n: Node): Node[] {
  const out: Node[] = [n];
  switch (n.k) {
    case 'neg':
    case 'not':
      out.push(...walk(n.a));
      break;
    case 'bin':
      out.push(...walk(n.a), ...walk(n.b));
      break;
    case 'call':
      for (const a of n.args) out.push(...walk(a));
      break;
  }
  return out;
}

/** Ids of all signals an expression references. */
export function refsOf(n: Node): Set<string> {
  const s = new Set<string>();
  for (const x of walk(n)) if (x.k === 'ref') s.add(x.id);
  return s;
}

export function usesTime(n: Node): boolean {
  return walk(n).some((x) => x.k === 'time');
}

/** True if the node produces a logic value (0/1). */
export function isLogic(n: Node): boolean {
  if (n.k === 'not') return true;
  if (n.k === 'bin') return ['>', '<', '>=', '<=', '&&', '||'].includes(n.op);
  if (n.k === 'call') return !!FUNCTIONS[n.fn]?.logic;
  return false;
}

// --- printer ---------------------------------------------------------------------

/** How to write a signal reference when printing. */
export type RefPrinter = (id: string) => string;

export const storedRef: RefPrinter = (id) => `#{${id}}`;

/** Display form of a signal name: bare identifier when possible, otherwise [bracketed]. */
export function nameToken(name: string): string {
  const ident = /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !RESERVED.has(name);
  return ident ? name : `[${name}]`;
}

const PRINT_PREC: Record<string, number> = { ...BIN_PREC, '^': 7 };

export function print(n: Node, ref: RefPrinter, parentPrec = 0): string {
  switch (n.k) {
    case 'num':
      return n.text;
    case 'ref':
      return ref(n.id);
    case 'time':
      return 't';
    case 'const':
      return n.name;
    case 'neg': {
      const s = `-${print(n.a, ref, 6)}`;
      return parentPrec > 6 ? `(${s})` : s;
    }
    case 'not': {
      const s = `!${print(n.a, ref, 6)}`;
      return parentPrec > 6 ? `(${s})` : s;
    }
    case 'bin': {
      const prec = PRINT_PREC[n.op]!;
      const rightAssoc = n.op === '^';
      const a = print(n.a, ref, rightAssoc ? prec + 1 : prec);
      // The right operand of a left-associative operator gets prec + 1, so "A - (B - 1)" keeps its parentheses.
      const b = print(n.b, ref, rightAssoc ? prec : prec + 1);
      const s = n.op === '^' ? `${a}^${b}` : `${a} ${n.op} ${b}`;
      return prec < parentPrec ? `(${s})` : s;
    }
    case 'call':
      return `${n.fn}(${n.args.map((a) => print(a, ref)).join(', ')})`;
  }
}

/** Split an optional "Name = expression" prefix. */
export function splitAssignment(text: string): { name: string | null; expr: string } {
  const m = /^\s*(\[[^\]]+\]|[\p{L}_][\p{L}\p{N}_]*)\s*=(?![=])([\s\S]*)$/u.exec(text);
  if (!m) return { name: null, expr: text };
  const lhs = m[1]!;
  return { name: lhs.startsWith('[') ? lhs.slice(1, -1) : lhs, expr: m[2]! };
}
