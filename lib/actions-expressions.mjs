// The GitHub Actions expression language: lexer, parser and evaluator written to the published
// grammar, with the `${{ }}` string transform workflows apply. Graded against GitHub's own
// @actions/expressions package by lib/test/actions-oracle.test.mjs; that package never ships.

const MAX_LENGTH = 21000;
const MAX_DEPTH = 50;
const OPEN = '${{';
const CLOSE = '}}';

export class ExpressionError extends Error {}

export class Dict {
  constructor() { this.keys = []; this.vals = []; this.index = new Map(); }
  add(key, value) {
    const k = String(key).toLowerCase();
    if (this.index.has(k)) return this;
    this.index.set(k, this.vals.length);
    this.keys.push(String(key));
    this.vals.push(value);
    return this;
  }
  get(key) { const i = this.index.get(String(key).toLowerCase()); return i === undefined ? undefined : this.vals[i]; }
  values() { return this.vals; }
  pairs() { return this.keys.map((key, i) => [key, this.vals[i]]); }
}

export class Filtered extends Array {}

export function toValue(plain) {
  if (plain === undefined || plain === null) return null;
  if (plain instanceof Dict || plain instanceof Filtered) return plain;
  if (Array.isArray(plain)) return plain.map(toValue);
  if (typeof plain === 'object') {
    const d = new Dict();
    for (const k of Object.keys(plain)) d.add(k, toValue(plain[k]));
    return d;
  }
  if (typeof plain === 'number' || typeof plain === 'string' || typeof plain === 'boolean') return plain;
  throw new TypeError(`not an expression value: ${typeof plain}`);
}

export function toPlain(v) {
  if (v instanceof Dict) { const o = {}; for (const [k, x] of v.pairs()) o[k] = toPlain(x); return o; }
  if (Array.isArray(v)) return Array.from(v, toPlain);
  return v;
}

export function kindOf(v) {
  if (v === null || v === undefined) return 'null';
  if (v instanceof Dict) return 'dict';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

const isPrimitive = (v) => { const k = kindOf(v); return k !== 'dict' && k !== 'array'; };

export function coerceString(v) {
  switch (kindOf(v)) {
    case 'null': return '';
    case 'boolean': return v ? 'true' : 'false';
    case 'number': return v === 0 ? '0' : String(+v.toFixed(15));
    case 'string': return v;
    case 'array': return 'Array';
    default: return 'Object';
  }
}

export function toNumber(v) {
  switch (kindOf(v)) {
    case 'null': return 0;
    case 'boolean': return v ? 1 : 0;
    case 'number': return v;
    case 'string': return Number(v);
    default: return NaN;
  }
}

export function truthy(v) {
  switch (kindOf(v)) {
    case 'null': return false;
    case 'boolean': return v;
    case 'number': return !(v === 0 || Number.isNaN(v));
    case 'string': return v.length > 0;
    default: return true;
  }
}

// Uppercases every character except the dotless i, as GitHub's comparison does.
export const upperSpecial = (s) => s.split('ı').map((p) => p.toUpperCase()).join('ı');

function coerce(l, r) {
  const lk = kindOf(l); const rk = kindOf(r);
  if (lk === rk) return [l, r];
  if (lk === 'number' && rk === 'string') return [l, Number(r)];
  if (lk === 'string' && rk === 'number') return [Number(l), r];
  if (lk === 'null' || lk === 'boolean') return coerce(toNumber(l), r);
  if (rk === 'null' || rk === 'boolean') return coerce(l, toNumber(r));
  return [l, r];
}

export function equals(a, b) {
  const [l, r] = coerce(a, b);
  const k = kindOf(l);
  if (k !== kindOf(r)) return false;
  switch (k) {
    case 'null': return true;
    case 'number': return !Number.isNaN(l) && !Number.isNaN(r) && l == r;
    case 'string': return upperSpecial(l) === upperSpecial(r);
    case 'boolean': return l === r;
    default: return l === r;
  }
}

function ordered(a, b, test) {
  const [l, r] = coerce(a, b);
  const k = kindOf(l);
  if (k !== kindOf(r)) return false;
  switch (k) {
    case 'number': return !Number.isNaN(l) && !Number.isNaN(r) && test(l, r);
    case 'string': return test(upperSpecial(l), upperSpecial(r));
    case 'boolean': return test(l ? 1 : 0, r ? 1 : 0);
    default: return false;
  }
}
export const greaterThan = (a, b) => ordered(a, b, (l, r) => l > r);
export const lessThan = (a, b) => ordered(a, b, (l, r) => l < r);

export function toJson(v) {
  const walk = (x, pad) => {
    const k = kindOf(x);
    if (k === 'null') return 'null';
    if (k === 'number') return Number.isFinite(x) ? JSON.stringify(x) : 'null';
    if (k === 'boolean' || k === 'string') return JSON.stringify(x);
    const inner = pad + '  ';
    if (k === 'array') {
      if (x.length === 0) return '[]';
      return '[\n' + Array.from(x, (i) => inner + walk(i, inner)).join(',\n') + '\n' + pad + ']';
    }
    const pairs = x.pairs();
    if (pairs.length === 0) return '{}';
    return '{\n' + pairs.map(([key, val]) => `${inner}${JSON.stringify(key)}: ${walk(val, inner)}`).join(',\n') + '\n' + pad + '}';
  };
  return walk(v, '');
}

export function fromJson(v) {
  const s = coerceString(v);
  if (s.trim() === '') throw new ExpressionError('empty input');
  let parsed;
  try { parsed = JSON.parse(s); } catch (e) { throw new ExpressionError(`Error parsing JSON when evaluating fromJson: ${e.message}`); }
  return toValue(parsed);
}

// ── lexer ────────────────────────────────────────────────────────────────────────────────────────
const BOUNDARY = new Set(['(', '[', ')', ']', ',', '.', '!', '>', '<', '=', '&', '|']);
const isBoundary = (c) => BOUNDARY.has(c) || /\s/.test(c);
const isDigit = (c) => c >= '0' && c <= '9';
const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
const legalIdentifier = (s) => s.length > 0 && (isAlpha(s[0]) || s[0] === '_') && [...s.slice(1)].every((c) => isAlpha(c) || isDigit(c) || c === '_' || c === '-');

export function lexExpression(input) {
  if (input.length > MAX_LENGTH) throw new ExpressionError(`Exceeded max expression length ${MAX_LENGTH}`);
  const tokens = [];
  let start = 0; let at = 0;
  const previous = () => (tokens.length ? tokens[tokens.length - 1].type : 'eof');
  const push = (type, value) => tokens.push({ type, lexeme: input.slice(start, at), value, pos: start });
  const symbol = (lexeme) => new ExpressionError(`Unexpected symbol: '${lexeme}'. Located at position ${start + 1} within expression: ${input}`);
  const number = () => {
    while (at < input.length && (!isBoundary(input[at]) || input[at] === '.')) at++;
    const lexeme = input.slice(start, at);
    const value = Number(lexeme);
    if (Number.isNaN(value)) throw symbol(lexeme);
    push('number', value);
  };
  const identifier = () => {
    while (at < input.length && !isBoundary(input[at])) at++;
    const lexeme = input.slice(start, at);
    let type = 'identifier'; let value;
    if (previous() !== 'dot') {
      if (lexeme === 'true') type = 'true';
      else if (lexeme === 'false') type = 'false';
      else if (lexeme === 'null') type = 'null';
      else if (lexeme === 'NaN') { type = 'number'; value = NaN; }
      else if (lexeme === 'Infinity') { type = 'number'; value = Infinity; }
    }
    if (!legalIdentifier(lexeme)) throw symbol(lexeme);
    push(type, value);
  };
  const string = () => {
    while (at < input.length && (input[at] !== "'" || input[at + 1] === "'")) {
      if (input[at] === "'") at++;
      at++;
    }
    if (at >= input.length) throw symbol(input.slice(start));
    at++;
    push('string', input.slice(start + 1, at - 1).replace("''", "'"));
  };
  while (at < input.length) {
    start = at;
    const c = input[at++];
    switch (c) {
      case '(': push('lparen'); break;
      case ')': push('rparen'); break;
      case '[': push('lbracket'); break;
      case ']': push('rbracket'); break;
      case ',': push('comma'); break;
      case '*': push('star'); break;
      case '.': {
        const p = previous();
        if (p !== 'identifier' && p !== 'rbracket' && p !== 'rparen' && p !== 'star') number(); else push('dot');
        break;
      }
      case '-': case '+': number(); break;
      case '!': if (input[at] === '=') { at++; push('bangEqual'); } else push('bang'); break;
      case '<': if (input[at] === '=') { at++; push('lessEqual'); } else push('less'); break;
      case '>': if (input[at] === '=') { at++; push('greaterEqual'); } else push('greater'); break;
      case '=': if (input[at] === '=') { at++; push('equalEqual'); } else identifier(); break;
      case '&': if (input[at] === '&') { at++; push('and'); } else identifier(); break;
      case '|': if (input[at] === '|') { at++; push('or'); } else identifier(); break;
      case ' ': case '\r': case '\t': case '\n': break;
      case "'": string(); break;
      default: if (isDigit(c)) number(); else identifier();
    }
  }
  start = at;
  push('eof');
  return tokens;
}

// ── parser ───────────────────────────────────────────────────────────────────────────────────────
export const builtinFunctions = Object.freeze({
  case: { minArgs: 3, maxArgs: Number.MAX_SAFE_INTEGER },
  contains: { minArgs: 2, maxArgs: 2 },
  endswith: { minArgs: 2, maxArgs: 2 },
  format: { minArgs: 1, maxArgs: 255 },
  fromjson: { minArgs: 1, maxArgs: 1 },
  join: { minArgs: 1, maxArgs: 2 },
  startswith: { minArgs: 2, maxArgs: 2 },
  tojson: { minArgs: 1, maxArgs: 1 },
});

// Splits a schema allowed-context list such as ["github", "always(0,0)", "hashFiles(1,255)"].
export function splitAllowedContext(allowed) {
  const contexts = []; const functions = [];
  for (const item of allowed) {
    const m = /^([a-zA-Z0-9_]+)\(([0-9]+),([0-9]+|MAX)\)$/.exec(item);
    if (m) functions.push({ name: m[1], minArgs: Number(m[2]), maxArgs: m[3] === 'MAX' ? Number.MAX_SAFE_INTEGER : Number(m[3]) });
    else contexts.push(item);
  }
  return { contexts, functions };
}

export function parseExpression(input, { contexts = [], functions = [] } = {}) {
  const tokens = typeof input === 'string' ? lexExpression(input) : input;
  const known = new Set(contexts.map((c) => c.toLowerCase()));
  const ext = new Map(functions.map((f) => [f.name.toLowerCase(), f]));
  let at = 0; let depth = 0;
  const peek = () => tokens[at];
  const atEnd = () => peek().type === 'eof';
  const prev = () => tokens[at - 1];
  const next = () => { if (!atEnd()) at++; return prev(); };
  const check = (t) => !atEnd() && peek().type === t;
  const match = (...types) => { for (const t of types) if (check(t)) { next(); return true; } return false; };
  const fail = (what, tok) => new ExpressionError(`${what}: '${tok.lexeme}'. Located at position ${tok.pos + 1} within expression: ${typeof input === 'string' ? input : ''}`);
  const consume = (t) => { if (!check(t)) throw fail('Unexpected symbol', peek()); next(); };
  const enter = () => { if (++depth > MAX_DEPTH) throw new ExpressionError(`Exceeded max expression depth ${MAX_DEPTH}`); };
  const leave = () => { depth--; };

  const expression = () => { enter(); try { return logicalOr(); } finally { leave(); } };
  const logicalOr = () => {
    let expr = logicalAnd();
    if (check('or')) {
      enter();
      try { const node = { type: 'logical', op: '||', args: [expr] }; expr = node; while (match('or')) node.args.push(logicalAnd()); } finally { leave(); }
    }
    return expr;
  };
  const logicalAnd = () => {
    let expr = equality();
    if (check('and')) {
      enter();
      try { const node = { type: 'logical', op: '&&', args: [expr] }; expr = node; while (match('and')) node.args.push(equality()); } finally { leave(); }
    }
    return expr;
  };
  const OPS = { bangEqual: '!=', equalEqual: '==', greater: '>', greaterEqual: '>=', less: '<', lessEqual: '<=' };
  const equality = () => {
    let expr = comparison();
    while (match('bangEqual', 'equalEqual')) expr = { type: 'binary', op: OPS[prev().type], left: expr, right: comparison() };
    return expr;
  };
  const comparison = () => {
    let expr = unary();
    while (match('greater', 'greaterEqual', 'less', 'lessEqual')) expr = { type: 'binary', op: OPS[prev().type], left: expr, right: unary() };
    return expr;
  };
  const unary = () => {
    if (match('bang')) { enter(); try { return { type: 'unary', op: '!', expr: unary() }; } finally { leave(); } }
    return index();
  };
  const index = () => {
    let expr = call();
    let entered = 0;
    if (expr.type === 'group' || expr.type === 'call' || expr.type === 'context') {
      for (;;) {
        if (match('lbracket')) {
          const idx = match('star') ? { type: 'star' } : expression();
          consume('rbracket');
          enter(); entered++;
          expr = { type: 'index', expr, index: idx };
        } else if (match('dot')) {
          enter(); entered++;
          if (match('identifier')) expr = { type: 'index', expr, index: { type: 'literal', value: prev().lexeme } };
          else if (match('star')) expr = { type: 'index', expr, index: { type: 'star' } };
          else throw fail('Unexpected symbol', peek());
        } else break;
      }
    }
    while (entered-- > 0) leave();
    return expr;
  };
  const call = () => {
    if (!check('identifier')) return primary();
    const id = next();
    if (!match('lparen')) {
      if (!known.has(id.lexeme.toLowerCase())) throw fail('Unrecognized named-value', id);
      return { type: 'context', name: id.lexeme };
    }
    const args = [];
    while (!match('rparen')) {
      args.push(expression());
      if (!check('rparen')) consume('comma');
    }
    const name = id.lexeme.toLowerCase();
    const f = builtinFunctions[name] || ext.get(name);
    if (!f) throw fail('Unrecognized function', id);
    if (args.length < f.minArgs) throw fail('Too few parameters supplied', id);
    if (args.length > f.maxArgs) throw fail('Too many parameters supplied', id);
    if (name === 'case' && args.length % 2 === 0) throw fail('Expected an odd number of parameters', id);
    return { type: 'call', name: id.lexeme, args };
  };
  const primary = () => {
    if (match('false')) return { type: 'literal', value: false };
    if (match('true')) return { type: 'literal', value: true };
    if (match('null')) return { type: 'literal', value: null };
    if (match('number')) return { type: 'literal', value: prev().value };
    if (match('string')) return { type: 'literal', value: prev().value };
    if (match('lparen')) {
      const expr = expression();
      if (atEnd()) throw new ExpressionError(`Unexpected end of expression after '${prev().lexeme}'`);
      consume('rparen');
      return { type: 'group', expr };
    }
    if (atEnd()) throw new ExpressionError(`Unexpected end of expression after '${prev() ? prev().lexeme : ''}'`);
    throw fail('Unexpected symbol', peek());
  };

  if (atEnd()) return undefined;
  const ast = expression();
  if (!atEnd()) throw fail('Unexpected symbol', peek());
  return ast;
}

export function containsStatusFunction(ast) {
  if (!ast) return false;
  switch (ast.type) {
    case 'call': {
      const n = ast.name.toLowerCase();
      if (n === 'success' || n === 'failure' || n === 'cancelled' || n === 'always') return true;
      return ast.args.some(containsStatusFunction);
    }
    case 'binary': return containsStatusFunction(ast.left) || containsStatusFunction(ast.right);
    case 'unary': return containsStatusFunction(ast.expr);
    case 'logical': return ast.args.some(containsStatusFunction);
    case 'group': return containsStatusFunction(ast.expr);
    case 'index': return containsStatusFunction(ast.expr) || containsStatusFunction(ast.index);
    default: return false;
  }
}

// ── evaluator ────────────────────────────────────────────────────────────────────────────────────
function formatString(args) {
  const fs = coerceString(args[0]);
  const out = [];
  let i = 0;
  const charAt = (n) => (n < fs.length ? fs[n] : '\0');
  while (i < fs.length) {
    const lb = fs.indexOf('{', i); const rb = fs.indexOf('}', i);
    if (lb >= 0 && (rb < 0 || rb > lb)) {
      if (charAt(lb + 1) === '{') { out.push(fs.slice(i, lb + 1)); i = lb + 2; continue; }
      if (rb > lb + 1) {
        let n = 0;
        while (isDigit(charAt(lb + 1 + n))) n++;
        if (n > 0) {
          const argIndex = parseInt(fs.slice(lb + 1, lb + 1 + n), 10);
          if (1 + argIndex > args.length - 1) throw new ExpressionError(`The following format string references more arguments than were supplied: ${fs}`);
          if (lb > i) out.push(fs.slice(i, lb));
          out.push(coerceString(args[1 + argIndex]));
          i = rb + 1;
          continue;
        }
      }
      throw new ExpressionError(`The following format string is invalid: ${fs}`);
    } else if (rb >= 0) {
      if (charAt(rb + 1) === '}') { out.push(fs.slice(i, rb + 1)); i = rb + 2; } else throw new ExpressionError(`The following format string is invalid: ${fs}`);
    } else { out.push(fs.slice(i)); break; }
  }
  return out.join('');
}

const builtinCalls = {
  case: (...args) => {
    for (let i = 0; i < args.length - 1; i += 2) {
      if (kindOf(args[i]) !== 'boolean') throw new ExpressionError('case predicate must evaluate to a boolean value');
      if (args[i]) return args[i + 1];
    }
    return args[args.length - 1];
  },
  contains: (search, item) => {
    if (isPrimitive(search)) return isPrimitive(item) && coerceString(search).toLowerCase().includes(coerceString(item).toLowerCase());
    if (kindOf(search) === 'array') return search.some((v) => equals(item, v));
    return false;
  },
  startswith: (s, v) => isPrimitive(s) && isPrimitive(v) && upperSpecial(coerceString(s)).startsWith(upperSpecial(coerceString(v))),
  endswith: (s, v) => isPrimitive(s) && isPrimitive(v) && upperSpecial(coerceString(s)).endsWith(upperSpecial(coerceString(v))),
  format: (...args) => formatString(args),
  join: (a, sep) => {
    if (isPrimitive(a)) return coerceString(a);
    if (kindOf(a) === 'array') return Array.from(a, coerceString).join(sep !== undefined && isPrimitive(sep) ? coerceString(sep) : ',');
    return '';
  },
  tojson: (v) => toJson(v),
  fromjson: (v) => fromJson(v),
};

function indexInto(obj, idx) {
  const star = idx === undefined;
  const key = !star && isPrimitive(idx) ? coerceString(idx) : undefined;
  const n = star ? NaN : toNumber(idx);
  const int = !Number.isNaN(n) && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  const k = kindOf(obj);
  if (k === 'array' && obj instanceof Filtered) {
    const out = new Filtered();
    for (const item of obj) {
      if (item instanceof Dict) {
        if (star) out.push(...item.values());
        else if (key !== undefined) { const v = item.get(key); if (v !== undefined) out.push(v); }
      } else if (Array.isArray(item)) {
        if (star) out.push(...item);
        else if (int !== undefined && int < item.length) out.push(item[int]);
      }
    }
    return out;
  }
  if (k === 'array') {
    if (star) { const out = new Filtered(); out.push(...obj); return out; }
    return int !== undefined && int < obj.length ? obj[int] : null;
  }
  if (k === 'dict') {
    if (star) { const out = new Filtered(); out.push(...obj.values()); return out; }
    if (key !== undefined) { const v = obj.get(key); if (v !== undefined) return v; }
    return null;
  }
  return star ? new Filtered() : null;
}

export function evaluateExpression(ast, context, { functions = [] } = {}) {
  if (typeof ast === 'string') ast = parseExpression(ast, { contexts: contextNames(context), functions });
  const ctx = toValue(context) || new Dict();
  const ext = new Map(functions.map((f) => [f.name.toLowerCase(), f]));
  const walk = (n) => {
    switch (n.type) {
      case 'literal': return n.value;
      case 'unary': return !truthy(walk(n.expr));
      case 'binary': {
        const l = walk(n.left); const r = walk(n.right);
        switch (n.op) {
          case '==': return equals(l, r);
          case '!=': return !equals(l, r);
          case '>': return greaterThan(l, r);
          case '>=': return equals(l, r) || greaterThan(l, r);
          case '<': return lessThan(l, r);
          default: return equals(l, r) || lessThan(l, r);
        }
      }
      case 'logical': {
        let result;
        for (const arg of n.args) {
          result = walk(arg);
          if ((n.op === '&&' && !truthy(result)) || (n.op === '||' && truthy(result))) break;
        }
        return result;
      }
      case 'group': return walk(n.expr);
      case 'context': { const v = ctx.get(n.name); return v === undefined ? null : v; }
      case 'index': return indexInto(walk(n.expr), n.index.type === 'star' ? undefined : walk(n.index));
      case 'call': {
        const args = n.args.map(walk);
        const name = n.name.toLowerCase();
        const f = builtinCalls[name] || ext.get(name)?.call;
        if (!f) throw new ExpressionError(`Function '${n.name}' cannot be evaluated here`);
        return f(...args);
      }
      default: throw new ExpressionError(`unknown node ${n.type}`);
    }
  };
  return ast === undefined ? null : walk(ast);
}

const contextNames = (context) => (context instanceof Dict ? context.keys : Object.keys(context || {}));

// ── the `${{ }}` string transform ────────────────────────────────────────────────────────────────
// A string that is one expression yields it; a string with text around or between expressions
// becomes format('…', e1, e2) with braces and quotes escaped, as GitHub's reader does.
export function templateExpression(raw) {
  let start = raw.indexOf(OPEN);
  if (start < 0) return null;
  const segments = [];
  let i = 0;
  while (i < raw.length) {
    if (i === start) {
      let end = -1; let inString = false;
      for (i += OPEN.length; i < raw.length; i++) {
        if (raw[i] === "'") inString = !inString;
        else if (!inString && raw[i] === '}' && raw[i - 1] === '}') { end = i; i++; break; }
      }
      if (end < start) return { error: 'The expression is not closed. An unescaped ${{ sequence was found, but the closing }} sequence was not found.' };
      segments.push({ expression: raw.slice(start + OPEN.length, end + 1 - CLOSE.length).trim() });
      start = raw.indexOf(OPEN, i);
    } else if (i < start) {
      segments.push({ literal: raw.slice(i, start) });
      i = start;
    } else {
      segments.push({ literal: raw.slice(i) });
      break;
    }
  }
  if (segments.length === 1 && segments[0].expression !== undefined) {
    const literal = stringLiteralOf(segments[0].expression);
    if (literal !== undefined) return { literal };
    return { expression: segments[0].expression, segments };
  }
  const fmt = []; const args = [];
  for (const s of segments) {
    if (s.literal !== undefined) fmt.push(s.literal.replace(/'/g, "''").replace(/\{/g, '{{').replace(/\}/g, '}}'));
    else { fmt.push(`{${args.length}}`); args.push(s.expression); }
  }
  return { expression: `format('${fmt.join('')}'${args.map((a) => `, ${a}`).join('')})`, segments };
}

// `${{ 'text' }}` is the escape for a literal string; it collapses back to that string.
function stringLiteralOf(expr) {
  const out = []; let inString = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") { inString = !inString; if (inString && i !== 0) out.push(c); }
    else if (!inString) return undefined;
    else out.push(c);
  }
  return out.join('');
}

export function expressionSites(raw) {
  const sites = [];
  let from = 0;
  for (;;) {
    const start = raw.indexOf(OPEN, from);
    if (start < 0) return sites;
    let inString = false; let end = -1;
    for (let i = start + OPEN.length; i < raw.length; i++) {
      if (raw[i] === "'") inString = !inString;
      else if (!inString && raw[i] === '}' && raw[i - 1] === '}') { end = i + 1; break; }
    }
    if (end < 0) { sites.push({ start, end: raw.length, expression: null }); return sites; }
    sites.push({ start, end, expression: raw.slice(start + OPEN.length, end - CLOSE.length).trim() });
    from = end;
  }
}
