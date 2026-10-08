// W1 — declarations and call sites, read off flow/lexer.mjs's character classification.
//
// HAND-ROLLED AND ASSUMED UNSOUND, on the same terms flow/lexer.mjs states for itself. It never
// looks at raw source: every regex here runs over the MASK (flow/verify.mjs `maskFrom`), where the
// interior of every string, template chunk, regex literal and comment has already been replaced by
// filler of the same length. So `// export function ghost()` cannot mint a symbol, and offsets
// still index the original file.
//
// It is floored in both directions by codegraph/v8-surface.mjs, and the two directions are reported
// apart because only one of them lies to you:
//   - a name W1 exports that V8 does not  -> FALSE POSITIVE (a symbol that is not there)
//   - a name V8 exports that W1 does not  -> FALSE NEGATIVE (a hole in this extractor)
//
// STATED LIMITS, not buried in a coverage number:
//   - Only top-level declarations and class members become symbols. A function declared inside a
//     function is real and is not here; calls made from it attribute to its enclosing top-level
//     symbol, which is the honest answer rather than a wrong one.
//   - An arrow with an expression body has no brace range. Its body is taken to the next `;` at the
//     same depth, and when that cannot be found the symbol carries `body: null` and owns no calls.
//   - Object-literal methods are not declarations here. `{ foo() {} }` and `class X { foo() {} }`
//     are indistinguishable to a brace counter, and minting a symbol for the first would fabricate
//     a member of a class that does not exist.

import { classify } from '../flow/lexer.mjs';
import { maskFrom } from '../flow/verify.mjs';
import { SYMBOL_KINDS } from './schema.mjs';

// Words that take a `(` and are not calls. `new` is absent on purpose: `new Thing(` IS a reference
// to Thing, and dropping it would lose most constructor edges in this repository.
const NOT_CALLS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'instanceof', 'void', 'delete',
  'throw', 'yield', 'await', 'do', 'else', 'in', 'of', 'case', 'with', 'function', 'class',
  'import', 'export', 'const', 'let', 'var', 'super', 'this', 'try', 'finally', 'constructor',
  'async', 'static', 'get', 'set',
]);

const IDENT = '[A-Za-z_$][\\w$]*';

const RE_FUNCTION = new RegExp(`(?:\\bexport\\s+(default\\s+)?)?\\b(?:async\\s+)?function\\s*\\*?\\s*(${IDENT})`, 'g');
const RE_CLASS = new RegExp(`(?:\\bexport\\s+(default\\s+)?)?\\bclass\\s+(${IDENT})`, 'g');
const RE_BINDING = new RegExp(`(?:\\bexport\\s+)?\\b(?:const|let|var)\\s+(${IDENT})\\s*=`, 'g');
const RE_EXPORT_LIST = /\bexport\s*\{([^}]*)\}(\s*from\b)?/g;
// Any `export default`, not just `export default NAME;`. Measured 2026-09-04: W2 found `default`
// on 22 files W1 had no export for, every one an anonymous form — `export default { ... }`,
// `export default function () {}`. That is the false-negative direction doing its job, and it is
// the direction that would otherwise have made those surfaces look smaller than they are.
const RE_EXPORT_DEFAULT = /\bexport\s+default\b/g;
// `export default { a, b, c }` — a bundle reached by member access on the importer's side.
// Its members are NOT dead just because nothing binds them by name, and this is the flag that
// stops codegraph/query.mjs saying they are.
const RE_DEFAULT_OBJECT = /\bexport\s+default\s*\{/;
// `d` for the reason importBindings states: the specifier text is sliced from the source, not the mask.
const RE_REEXPORT_LIST = /\bexport\s*\{([^}]*)\}\s*from\s*(['"])(.*?)\2/gd;
const RE_REEXPORT_STAR = new RegExp(`\\bexport\\s*\\*\\s*(?:as\\s+(${IDENT})\\s*)?from\\s*(['"])(.*?)\\2`, 'gd');
const RE_CALL = new RegExp(`(${IDENT})\\s*\\(`, 'g');
const RE_MEMBER = new RegExp(`(?:^|[\\s;}])(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?\\*?\\s*(${IDENT})\\s*\\(`, 'g');

/** Brace depth at every offset, plus `{` -> matching `}`. One pass; the mask has no stray braces. */
export function braceIndex(masked) {
  const depth = new Int32Array(masked.length + 1);
  const match = new Map();
  const stack = [];
  let d = 0;
  for (let i = 0; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '{') { stack.push(i); d += 1; } else if (c === '}') {
      const open = stack.pop();
      if (open === undefined) return { ok: false, reason: `unbalanced } at ${i}`, depth: null, match: null };
      match.set(open, i);
      d -= 1;
    }
    depth[i + 1] = d;
  }
  if (stack.length) return { ok: false, reason: `${stack.length} unclosed {`, depth: null, match: null };
  return { ok: true, reason: null, depth, match };
}

// guard: a parameter pattern's braces are not the body
function afterParams(masked, from) {
  const lead = /^\s*(?:async\s+)?(?:function\b\s*\*?\s*(?:[A-Za-z_$][\w$]*)?\s*)?/.exec(masked.slice(from, from + 200));
  let i = from + (lead ? lead[0].length : 0);
  if (masked[i] !== '(') return from;
  for (let depth = 0; i < masked.length; i += 1) {
    if (masked[i] === '(') depth += 1;
    else if (masked[i] === ')' && --depth === 0) return i + 1;
  }
  return from;
}

/** Body range for a declaration whose header ends at `from`. -> [start, end] or null. */
function bodyRange(masked, from, brace, { params = false } = {}) {
  let start = params ? afterParams(masked, from) : from;
  const arrow = params ? /^\s*=>\s*/.exec(masked.slice(start, start + 64)) : null;
  if (arrow) {
    start += arrow[0].length;
    // guard: an arrow's body is a block or an expression
    if (masked[start] !== '{') return null;
  }
  for (let i = start; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '{') {
      const close = brace.match.get(i);
      return close === undefined ? null : [i, close];
    }
    if (c === ';') return null;
  }
  return null;
}

/** An expression-bodied arrow: from `=` to the next `;` at the same brace depth. */
function expressionBody(masked, from, brace) {
  const d = brace.depth[from];
  for (let i = from; i < masked.length; i += 1) {
    if (masked[i] === ';' && brace.depth[i] === d) return [from, i];
  }
  return null;
}

function lineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) if (src[i] === '\n') starts.push(i + 1);
  return (off) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

/** The innermost symbol whose body contains `at`, or null for module level. */
function enclosing(symbols, at) {
  let best = null;
  for (const s of symbols) {
    if (!s.body || at < s.body[0] || at >= s.body[1]) continue;
    if (!best || s.body[0] > best.body[0]) best = s;
  }
  return best ? best.name : null;
}

/** Class members, one brace depth inside the class body. */
function members(masked, range, className, brace, lineOf, symbols, declSpans) {
  const [open, close] = range;
  const want = brace.depth[open + 1];
  const body = masked.slice(open + 1, close);
  for (const hit of body.matchAll(RE_MEMBER)) {
    const at = open + 1 + hit.index + hit[0].indexOf(hit[1]);
    if (brace.depth[at] !== want) continue;
    if (NOT_CALLS.has(hit[1])) continue;
    const bodyAt = bodyRange(masked, at + hit[1].length, brace, { params: true });
    symbols.push({
      name: `${className}.${hit[1]}`, kind: 'method', line: lineOf(at), start: at,
      body: bodyAt, exported: false, depth: brace.depth[at],
    });
    declSpans.push([at, at + hit[1].length + 1]);
  }
}

/**
 * -> { ok, reason, masked, symbols, calls, exportedNames, reexports, defaultObjectLiteral }
 *
 * `ok:false` is UNKNOWN, never clean and never a finding: the caller drops the file from the graph
 * AND from every "nothing references this" answer, because an unread file cannot support one.
 */
export function extract(src) {
  const empty = { masked: null, symbols: [], calls: [], exportedNames: [], reexports: [] };
  const c = classify(src);
  if (!c.ok) return { ok: false, reason: `lexer bailed: ${c.reason}`, ...empty };
  const m = maskFrom(src, c.spans);
  if (!m.ok) return { ok: false, reason: `mask failed: ${m.error}`, ...empty };
  const masked = m.masked;
  const brace = braceIndex(masked);
  if (!brace.ok) return { ok: false, reason: `brace scan failed: ${brace.reason}`, ...empty };

  const lineOf = lineIndex(masked);
  const symbols = [];
  const declSpans = [];
  const exported = new Set();

  const add = (name, kind, start, headerEnd, isExport, body) => {
    if (!SYMBOL_KINDS.includes(kind)) throw new Error(`unknown symbol kind ${kind}`);
    symbols.push({ name, kind, line: lineOf(start), start, body: body || null, exported: !!isExport, depth: brace.depth[start] });
    declSpans.push([start, headerEnd]);
    if (isExport) exported.add(name);
  };

  for (const hit of masked.matchAll(RE_FUNCTION)) {
    const start = hit.index;
    if (brace.depth[start] !== 0) continue;   // a function inside a function is real and is not a symbol here
    const isExport = masked.startsWith('export', start);
    add(hit[2], 'function', start, start + hit[0].length, isExport, bodyRange(masked, start + hit[0].length, brace, { params: true }));
    if (hit[1]) exported.add('default');
  }
  for (const hit of masked.matchAll(RE_CLASS)) {
    const start = hit.index;
    if (brace.depth[start] !== 0) continue;
    const isExport = masked.startsWith('export', start);
    const body = bodyRange(masked, start + hit[0].length, brace);
    add(hit[2], 'class', start, start + hit[0].length, isExport, body);
    if (hit[1]) exported.add('default');
    if (body) members(masked, body, hit[2], brace, lineOf, symbols, declSpans);
  }
  for (const hit of masked.matchAll(RE_BINDING)) {
    const start = hit.index;
    if (brace.depth[start] !== 0) continue;   // locals are not module symbols; `const err` is not a surface
    const eq = start + hit[0].length;
    const tail = masked.slice(eq, eq + 200);
    const isFn = /^\s*(?:async\s+)?(?:function\b|class\b)/.test(tail);
    const isArrow = /^\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(tail);
    let body = bodyRange(masked, eq, brace, { params: isFn || isArrow });
    if (!body && isArrow) body = expressionBody(masked, eq, brace);
    add(hit[1], isFn || isArrow ? 'function' : 'const', start, eq, masked.startsWith('export', start), body);
  }
  // `export { x as y } from './z'` declares no local symbol AND does put `y` on the surface. Both
  // halves matter: skipping the statement outright lost the name (measured against W2 on
  // admin/routes/remediation.mjs, `llmBaseUrl`), and minting a symbol for it would invent a
  // declaration that is in another file.
  for (const hit of masked.matchAll(RE_EXPORT_LIST)) {
    for (const part of hit[1].split(',')) {
      const bits = part.trim().split(/\s+as\s+/);
      if (bits[0]) exported.add((bits[1] || bits[0]).trim());
    }
  }
  for (const hit of masked.matchAll(RE_EXPORT_DEFAULT)) { void hit; exported.add('default'); }
  const reexports = reexportsOf(masked, src, exported, lineOf);

  // Calls. A declaration header is not a call site, so anything inside one is skipped.
  const inDecl = (i) => declSpans.some((sp) => i >= sp[0] && i < sp[1]);
  const calls = [];
  for (const hit of masked.matchAll(RE_CALL)) {
    const name = hit[1];
    if (NOT_CALLS.has(name)) continue;
    if (inDecl(hit.index)) continue;
    // `obj.foo(` is not a call to a module-level `foo`.
    if (hit.index > 0 && /[.?]/.test(masked[hit.index - 1])) continue;
    calls.push({ name, line: lineOf(hit.index), at: hit.index, from: enclosing(symbols, hit.index) });
  }

  symbols.sort((a, b) => a.start - b.start || a.name.localeCompare(b.name));
  calls.sort((a, b) => a.at - b.at);
  return {
    ok: true,
    reason: null,
    masked,
    symbols,
    calls,
    exportedNames: [...exported].sort(),
    reexports,
    defaultObjectLiteral: RE_DEFAULT_OBJECT.test(masked),
  };
}

/** `a`, `a as b` — masked comments dropped first, since their filler would read as a name. */
function listEntries(body) {
  const out = [];
  for (const part of body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, ' ').split(',')) {
    const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part.trim());
    if (m) out.push({ name: m[1], as: m[2] || m[1] });
  }
  return out;
}

/**
 * Exports that resolve into another module. -> [{ exported, spec, imported, kind, line }]
 *
 * `kind` is 'named' | 'namespace' (imported '*') | 'star' (`export * from`, exported '*'). This is
 * the set codegraph/v8-surface.mjs reads off V8's resolution, so it has to include the two shapes
 * that do not look like re-exports: `import { x } …; export { x }`, which the spec makes an indirect
 * export, and a name the module imports from a specifier it also `export *`s, which reaches the
 * surface through the star. Adds `export * as ns` and the star-carried names to `exported`.
 */
function reexportsOf(masked, src, exported, lineOf) {
  const out = [];
  const specAt = (hit) => src.slice(hit.indices[3][0], hit.indices[3][1]);
  for (const hit of masked.matchAll(RE_REEXPORT_LIST)) {
    const spec = specAt(hit);
    for (const e of listEntries(hit[1])) {
      out.push({ exported: e.as, spec, imported: e.name, kind: 'named', line: lineOf(hit.index) });
    }
  }
  for (const hit of masked.matchAll(RE_REEXPORT_STAR)) {
    const spec = specAt(hit);
    const line = lineOf(hit.index);
    if (hit[1]) {
      out.push({ exported: hit[1], spec, imported: '*', kind: 'namespace', line });
      exported.add(hit[1]);
    } else out.push({ exported: '*', spec, imported: '*', kind: 'star', line });
  }
  const bindings = importBindings(masked, src);
  const imported = new Map(bindings.filter((b) => b.local).map((b) => [b.local, b]));
  for (const hit of masked.matchAll(RE_EXPORT_LIST)) {
    if (hit[2]) continue;
    for (const e of listEntries(hit[1])) {
      const b = imported.get(e.name);
      if (!b) continue;
      out.push(b.kind === 'star'
        ? { exported: e.as, spec: b.spec, imported: '*', kind: 'namespace', line: lineOf(hit.index) }
        : { exported: e.as, spec: b.spec, imported: b.exported, kind: 'named', line: lineOf(hit.index) });
    }
  }

  // A star carries every name its target exports; the names knowable here are the ones this module
  // demands of the same specifier. An explicit export shadows the star, and a name two stars both
  // carry is ambiguous and on neither surface — V8's rule, so W1 states the same one.
  const stars = new Map();
  for (const r of out) if (r.kind === 'star' && !stars.has(r.spec)) stars.set(r.spec, r.line);
  const demanded = new Map();
  const demand = (spec, name) => { if (!demanded.has(spec)) demanded.set(spec, new Set()); demanded.get(spec).add(name); };
  for (const b of bindings) if (b.kind === 'named' || b.kind === 'default') demand(b.spec, b.exported);
  for (const r of out) if (r.kind === 'named') demand(r.spec, r.imported);
  const carriers = new Map();
  for (const spec of stars.keys()) {
    for (const n of demanded.get(spec) || []) {
      if (n === 'default' || exported.has(n)) continue;
      carriers.set(n, [...(carriers.get(n) || []), spec]);
    }
  }
  for (const [n, specs] of carriers) {
    if (specs.length !== 1) continue;
    out.push({ exported: n, spec: specs[0], imported: n, kind: 'named', line: stars.get(specs[0]) });
    exported.add(n);
  }
  return out.sort((a, b) => a.exported.localeCompare(b.exported) || a.spec.localeCompare(b.spec));
}
// `d` (hasIndices) is load-bearing: the match runs on the MASK, where a specifier's interior is
// filler, so the specifier TEXT is sliced out of the original source at the same offsets. maskFrom
// preserves length exactly, which is what makes one set of offsets index both.

const RE_IMPORT_STMT = /^[ \t]*import\b([\s\S]*?)from\s*(['"])(.*?)\2/gmd;
const RE_IMPORT_BARE = /^[ \t]*import\s*(['"])(.*?)\1/gmd;

/**
 * Local bindings each static import introduces. -> [{ spec, local, exported, kind }]
 *
 * W2 reports the names V8 DEMANDS of a specifier, which are the names as EXPORTED. It cannot report
 * the local alias, because a namespace has no opinion about what the importer called it. So this is
 * the half of the module edge only a lexical read can supply, and the half V8 floors is `exported`:
 * every `exported` here must appear among W2's demanded names for that specifier, or the two
 * witnesses have diverged and the file's edges are held as unknown.
 *
 * `kind` is 'named' | 'default' | 'star' | 'bare'. A star import binds a namespace object, so a call
 * through it (`ns.thing()`) is a member call and never resolves to a symbol here.
 */
export function importBindings(masked, src = masked) {
  const out = [];
  for (const hit of masked.matchAll(RE_IMPORT_STMT)) {
    const clause = hit[1].trim();
    const at = hit.indices[3];
    const spec = src.slice(at[0], at[1]);
    if (!clause) continue;
    const braces = /\{([\s\S]*)\}/.exec(clause);
    const head = clause.slice(0, braces ? clause.indexOf('{') : clause.length).replace(/,\s*$/, '').trim();
    if (head) {
      const star = /^\*\s*as\s+([A-Za-z_$][\w$]*)$/.exec(head);
      if (star) out.push({ spec, local: star[1], exported: '*', kind: 'star' });
      else if (/^[A-Za-z_$][\w$]*$/.test(head)) out.push({ spec, local: head, exported: 'default', kind: 'default' });
    }
    if (!braces) continue;
    for (const part of braces[1].split(',')) {
      const t = part.trim();
      if (!t) continue;
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(t);
      if (m) out.push({ spec, local: m[2] || m[1], exported: m[1], kind: 'named' });
    }
  }
  for (const hit of masked.matchAll(RE_IMPORT_BARE)) {
    const at = hit.indices[2];
    out.push({ spec: src.slice(at[0], at[1]), local: null, exported: null, kind: 'bare' });
  }
  return out;
}
