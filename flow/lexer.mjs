// W1 — per-character classification of a JS source into code / string / template / regex / comment.
//
// HAND-ROLLED AND ASSUMED UNSOUND. That is not modesty, it is the design: flow/verify.mjs hands V8
// a rewrite built from this classification and makes V8 re-parse it, so a desync is REFUSED rather
// than published. The extractor this repo repaired in bin/lib/tracked-imports.mjs was right all
// along and had no floor; this one has a floor and is expected to be wrong sometimes.
//
// The single genuinely undecidable case without a full parser is regex-vs-division after `)` or
// `}`. When the guess is wrong the mask parse fails and the FILE becomes unknown — grey. It never
// becomes a finding, because an unreadable file is not a defect in the file.

const ID = /[\w$]/;

// After these, a `/` opens a REGEX. After an identifier, number, string, `)` or `]` it is division.
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do',
  'else', 'yield', 'await', 'default',
]);

// `}` is treated as allowing a regex (end of a block is far commoner here than end of an object
// literal followed by division). `)` is treated as NOT allowing one. Both are guesses with a floor.
const VALUE_ENDERS = new Set([')', ']', '+', '-']);

export const SPAN_KINDS = ['string', 'template', 'regex', 'line', 'block'];

/**
 * -> { ok, reason, spans, lineOf }
 *
 * `ok:false` means the lexer reached a state it cannot account for (an unterminated string, a block
 * comment running past EOF). The file is then UNKNOWN. It is never treated as clean and never
 * reported as a defect.
 *
 * Span: { kind, start, end, innerStart, innerEnd, quote, value, interpolated }
 *   start/end     cover the whole token including delimiters
 *   innerStart/End cover the interior only — what the mask rewrites
 *   value         the cooked value, or null when an escape this cannot decode appears
 */
export function classify(src) {
  const s = String(src);
  const n = s.length;
  const spans = [];
  let i = 0;
  let prev = null;              // last significant code token: {type:'word'|'punct'|'value', text}
  const tmpl = [];              // template frames awaiting their closing backtick
  let braces = 0;

  const bail = (reason, at) => ({ ok: false, reason: `${reason} at offset ${at}`, spans, lineOf: lineIndexer(s) });

  if (s.startsWith('#!')) {     // hashbang: legal in a module, not a comment token
    const e = s.indexOf('\n');
    const end = e === -1 ? n : e;
    spans.push({ kind: 'line', start: 0, end, innerStart: 2, innerEnd: end, quote: null, value: null });
    i = end;
  }

  while (i < n) {
    const c = s[i];

    if (c === '/' && s[i + 1] === '/') {
      const e = s.indexOf('\n', i);
      const end = e === -1 ? n : e;
      spans.push({ kind: 'line', start: i, end, innerStart: i + 2, innerEnd: end, quote: null, value: null });
      i = end;
      continue;
    }

    if (c === '/' && s[i + 1] === '*') {
      const e = s.indexOf('*/', i + 2);
      if (e === -1) return bail('unterminated block comment', i);
      spans.push({ kind: 'block', start: i, end: e + 2, innerStart: i + 2, innerEnd: e, quote: null, value: null });
      i = e + 2;
      continue;
    }

    if (c === "'" || c === '"') {
      const end = scanQuoted(s, i, c);
      if (end === -1) return bail(`unterminated ${c === "'" ? 'single' : 'double'}-quoted string`, i);
      spans.push({
        kind: 'string', start: i, end: end + 1, innerStart: i + 1, innerEnd: end, quote: c,
        value: cook(s.slice(i + 1, end)), interpolated: false,
      });
      i = end + 1;
      prev = { type: 'value', text: '' };
      continue;
    }

    if (c === '`') {
      const chunk = scanTemplateChunk(s, i + 1);
      if (chunk.end === -1) return bail('unterminated template literal', i);
      spans.push({
        kind: 'template', start: i, end: chunk.end + (chunk.kind === 'close' ? 1 : 2),
        innerStart: i + 1, innerEnd: chunk.end, quote: '`',
        value: cook(s.slice(i + 1, chunk.end)), interpolated: chunk.kind === 'subst',
        chunkOf: chunk.kind === 'subst' ? spans.length : null,
      });
      if (chunk.kind === 'close') { i = chunk.end + 1; prev = { type: 'value', text: '' }; continue; }
      tmpl.push({ braces, open: i });                 // `${` — back into code until the matching `}`
      braces += 1;
      i = chunk.end + 2;
      prev = null;
      continue;
    }

    if (c === '}' && tmpl.length && braces - 1 === tmpl[tmpl.length - 1].braces) {
      braces -= 1;
      const frame = tmpl.pop();
      const chunk = scanTemplateChunk(s, i + 1);
      if (chunk.end === -1) return bail('unterminated template literal', frame.open);
      spans.push({
        kind: 'template', start: i, end: chunk.end + (chunk.kind === 'close' ? 1 : 2),
        innerStart: i + 1, innerEnd: chunk.end, quote: '`',
        value: cook(s.slice(i + 1, chunk.end)), interpolated: true, chunkOf: frame.open,
      });
      if (chunk.kind === 'close') { i = chunk.end + 1; prev = { type: 'value', text: '' }; continue; }
      tmpl.push({ braces, open: frame.open });
      braces += 1;
      i = chunk.end + 2;
      prev = null;
      continue;
    }

    if (c === '{') { braces += 1; i += 1; prev = { type: 'punct', text: '{' }; continue; }
    if (c === '}') { braces -= 1; i += 1; prev = { type: 'punct', text: '}' }; continue; }

    if (c === '/') {
      if (regexAllowed(prev)) {
        const end = scanRegex(s, i);
        if (end === -1) return bail('unterminated regex literal', i);
        spans.push({
          kind: 'regex', start: i, end, innerStart: i + 1, innerEnd: s.lastIndexOf('/', end - 1),
          quote: '/', value: null,
        });
        i = end;
        prev = { type: 'value', text: '' };
        continue;
      }
      i += 1;
      prev = { type: 'punct', text: '/' };
      continue;
    }

    if (/\s/.test(c)) { i += 1; continue; }           // whitespace does not change `prev`

    if (ID.test(c)) {
      let j = i;
      while (j < n && ID.test(s[j])) j += 1;
      const word = s.slice(i, j);
      prev = /^\d/.test(word) ? { type: 'value', text: word } : { type: 'word', text: word };
      i = j;
      continue;
    }

    prev = { type: 'punct', text: c };
    i += 1;
  }

  if (tmpl.length) return bail('unterminated template literal', tmpl[0].open);
  return { ok: true, reason: null, spans, lineOf: lineIndexer(s) };
}

function regexAllowed(prev) {
  if (!prev) return true;
  if (prev.type === 'value') return false;
  if (prev.type === 'word') return REGEX_AFTER_WORD.has(prev.text);
  return !VALUE_ENDERS.has(prev.text);
}

// -> index of the closing quote, or -1. Newline terminates a normal string, so an unterminated one
// is a lexer bail rather than a run to EOF.
function scanQuoted(s, start, q) {
  for (let i = start + 1; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (c === q) return i;
    if (c === '\n') return -1;
  }
  return -1;
}

// -> { end, kind } where kind is 'close' (backtick at end) or 'subst' (`${` at end)
function scanTemplateChunk(s, start) {
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '`') return { end: i, kind: 'close' };
    if (c === '$' && s[i + 1] === '{') return { end: i, kind: 'subst' };
  }
  return { end: -1, kind: null };
}

// -> index just past the flags, or -1
function scanRegex(s, start) {
  let cls = false;
  for (let i = start + 1; i < s.length; i += 1) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; }
    if (c === '\n') return -1;
    if (cls) { if (c === ']') cls = false; continue; }
    if (c === '[') { cls = true; continue; }
    if (c === '/') {
      let j = i + 1;
      while (j < s.length && /[a-z]/.test(s[j])) j += 1;
      return j;
    }
  }
  return -1;
}

/** Decode the escapes this understands. Anything else -> null, i.e. the VALUE is unknown. */
export function cook(raw) {
  if (!raw.includes('\\')) return raw;
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c !== '\\') { out += c; continue; }
    const d = raw[i + 1];
    i += 1;
    if (d === 'n') { out += '\n'; continue; }
    if (d === 't') { out += '\t'; continue; }
    if (d === 'r') { out += '\r'; continue; }
    if (d === '\\' || d === "'" || d === '"' || d === '`' || d === '/' || d === '$') { out += d; continue; }
    if (d === '\n') continue;                          // line continuation
    if (d === 'u' && raw[i + 1] === '{') {
      const close = raw.indexOf('}', i + 2);
      if (close === -1) return null;
      const cp = Number.parseInt(raw.slice(i + 2, close), 16);
      if (!Number.isFinite(cp)) return null;
      out += String.fromCodePoint(cp);
      i = close;
      continue;
    }
    if (d === 'u' || d === 'x') {
      const len = d === 'u' ? 4 : 2;
      const hex = raw.slice(i + 1, i + 1 + len);
      if (hex.length < len || !/^[0-9a-fA-F]+$/.test(hex)) return null;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += len;
      continue;
    }
    return null;                                        // unknown escape: refuse to guess the value
  }
  return out;
}

/** offset -> 1-based line. Evidence only; nothing keys identity on it. */
export function lineIndexer(src) {
  let starts = null;
  return (offset) => {
    if (!starts) {
      starts = [0];
      for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);
    }
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * W3 — the dumb witness. No state machine at all: line-local quoted runs, straight off the raw text.
 *
 * It over-reports freely and that is fine; it exists because its failure mode is NOT the mask
 * lexer's. The mask desyncs across lines on a regex or comment; this one fails only on an odd number
 * of quotes within a single line (`don't`). Two witnesses that fail the same way are one witness.
 */
export function rawQuotedRuns(src) {
  const out = [];
  let off = 0;
  for (const line of String(src).split('\n')) {
    for (const re of [/'([^'\n]{1,300})'/g, /"([^"\n]{1,300})"/g, /`([^`\n]{1,300})`/g]) {
      for (const m of line.matchAll(re)) out.push({ value: m[1], start: off + m.index });
    }
    off += line.length + 1;
  }
  return out;
}

// ── structure over the MASKED source ────────────────────────────────────────────────────────────
// Not a second tokenizer. These read only the output of maskFrom() — the rewrite V8 has already
// accepted — where every string, template chunk, regex and comment interior is filler. A bracket
// inside a literal is therefore not a bracket here, and literal VALUES still come only from
// classify()'s spans. All they do is count brackets in code V8 agreed is code.

const OPEN = { '(': ')', '[': ']', '{': '}' };
const CLOSE = new Set([')', ']', '}']);

/** Offset of the bracket closing the one at `open`, or -1 when it never closes. */
export function matchBracket(masked, open) {
  const want = [OPEN[masked[open]]];
  if (!want[0]) return -1;
  for (let i = open + 1; i < masked.length; i += 1) {
    const c = masked[i];
    if (OPEN[c]) want.push(OPEN[c]);
    else if (CLOSE.has(c)) {
      if (c !== want.pop()) return -1;
      if (!want.length) return i;
    }
  }
  return -1;
}

/**
 * -> [{ start, end }] — the top-level comma-separated arguments inside the bracket at `open`,
 * trimmed of whitespace. Empty when the bracket is empty; null when it never closes.
 */
export function splitArgs(masked, open) {
  const close = matchBracket(masked, open);
  if (close === -1) return null;
  const out = [];
  let depth = 0;
  let from = open + 1;
  const push = (to) => {
    let a = from;
    let b = to;
    while (a < b && /\s/.test(masked[a])) a += 1;
    while (b > a && /\s/.test(masked[b - 1])) b -= 1;
    if (b > a) out.push({ start: a, end: b });
  };
  for (let i = open + 1; i < close; i += 1) {
    const c = masked[i];
    if (OPEN[c]) depth += 1;
    else if (CLOSE.has(c)) depth -= 1;
    else if (c === ',' && depth === 0) { push(i); from = i + 1; }
  }
  push(close);
  return out;
}

/**
 * -> { namespaces:Set, named:Map<local, imported> } for the bindings this module takes from any
 * specifier in `from`: `import * as X`, `import X`, `import { a as b }`, `const X = require(...)`,
 * `const { a: b } = require(...)`. Read off the masked code in front of each specifier literal the
 * lexer found; a default import is treated as the namespace, which is what `node:` builtins give.
 */
export function importedNames(masked, spans, from) {
  const want = new Set(from);
  const namespaces = new Set();
  const named = new Map();
  for (const sp of spans) {
    if (sp.kind !== 'string' || !want.has(sp.value)) continue;
    const before = masked.slice(Math.max(0, sp.start - 400), sp.start);
    let clause = null;
    const imp = /\bimport\s+([^;]*?)\s+from\s*$/.exec(before);
    if (imp) clause = imp[1];
    const req = /\b(?:const|let|var)\s+([^=;]+?)\s*=\s*require\s*\(\s*$/.exec(before);
    if (!clause && req) clause = req[1].replace(/:/g, ' as ');
    if (!clause) continue;
    const brace = /\{([^}]*)\}/.exec(clause);
    if (brace) {
      for (const part of brace[1].split(',')) {
        const m = /^\s*([\w$]+)(?:\s+as\s+([\w$]+))?\s*$/.exec(part);
        if (m) named.set(m[2] || m[1], m[1]);
      }
    }
    const ns = /\*\s*as\s+([\w$]+)/.exec(clause);
    if (ns) namespaces.add(ns[1]);
    const def = /^\s*([\w$]+)\s*(?:,|$)/.exec(clause);
    if (def) namespaces.add(def[1]);
  }
  return { namespaces, named };
}
