#!/usr/bin/env node
/*
 * bare-catch-ratchet.mjs — hold the line on bare `catch {`: the existing population is
 * grandfathered, NEW members are refused. Conversion is a separate, staged act — most bare
 * catches here are legitimate, and a bad conversion is a crash loop on the supervised panel.
 *
 * Identity is a SET of place keys with per-key multiplicity, never a total count (a count is
 * defeated by an intra-tree swap):
 *   key = "<repo-relative path>::<chain of enclosing NAMED scopes, joined by '>'>"
 * The key excludes the line number (house rule). Residual blind spots, accepted deliberately:
 * intra-key swaps; renames/moves (refused until --rekey'd, see REKEY below); `catch (e) {}`; dynamic swallows
 * (`.catch(() => null)`); files outside SCOPE.
 *
 * Detection is a small hand-written lexer (no parser in node: builtins) that blanks comments,
 * strings, templates and regex literals; the regex/division ambiguity is covered by a balance
 * self-check — an unlexable or unbalanced file FAILS CLOSED, never reads as clean.
 *
 * Acceptance is a state predicate, not a clock: tracked set never gains a member AND the critical
 * modules hold zero. An absent baseline is exit 3, never a silent pass or re-seed.
 *
 * exit codes:
 *   0  pass · 1 FINDINGS (the ratchet biting) · 2 FAILURE (fail closed) · 3 NOT SEEDED (ENOENT)
 *
 * usage:
 *   node bin/bare-catch-ratchet.mjs                  # check against the baseline
 *   node bin/bare-catch-ratchet.mjs --status         # check + acceptance predicate + top offenders
 *   node bin/bare-catch-ratchet.mjs --json           # machine-readable result on stdout
 *   node bin/bare-catch-ratchet.mjs --seed [--force] # write the baseline (explicit, journaled)
 *   node bin/bare-catch-ratchet.mjs --tighten        # bank improvements ONLY; never raises a count
 *   node bin/bare-catch-ratchet.mjs --accept --reason "<why>"   # the visible escape hatch
 *   node bin/bare-catch-ratchet.mjs --rekey <from> <to>          # code MOVED: carry its baseline entries
 *
 * Env, read at call time (a const at import defeats test overrides):
 *   CW_BARE_CATCH_ROOT      scan root            (default: the repo containing this file)
 *   CW_BARE_CATCH_BASELINE  baseline path        (default: bin/bare-catch-baseline.json)
 *   CW_NOW                  timestamp for writes (determinism)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { writeJSONAtomic } from '../cra/lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

// Call-time, every time. See the env note in the header.
export const scanRoot = () => process.env.CW_BARE_CATCH_ROOT || REPO;
export const baselinePath = () => process.env.CW_BARE_CATCH_BASELINE || join(REPO, 'bin', 'bare-catch-baseline.json');
export const nowStamp = () => process.env.CW_NOW || new Date().toISOString();

// ── SCOPE ───────────────────────────────────────────────────────────────────────────────────────
// Shipped, first-party, non-test code. Every exclusion widens the out-of-scope blind spot, so the
// list stays short and each entry has a reason.
export const SKIP_DIRS = new Set([
  'node_modules', '.git', 'reports', 'tmp', '.npm-cache', 'coverage',
  'test', 'tests', 'fixtures', '__fixtures__',        // not shipped code
  'vendor',                                            // not ours to convert
  'data',                                              // generated caches/artifacts (monitor/data, map/data, sitemap/data)
  'archive',                                           // superseded cycle artifacts
]);
const CODE_EXT = /\.(mjs|js|cjs)$/;
const IS_TEST = /(^|[.-])(test|spec)\.(mjs|js|cjs)$/;

/** Every in-scope source file under `root`, repo-relative and SORTED (determinism). */
export function collectFiles(root = scanRoot()) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      if (e.code === 'ENOENT') return;            // only ENOENT is legitimate absence
      throw e;                                     // EACCES and friends are failures, not empty dirs
    }
    for (const ent of entries.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (ent.name.startsWith('.')) continue;
      const full = join(dir, ent.name);
      if (ent.isDirectory()) { if (!SKIP_DIRS.has(ent.name)) walk(full); continue; }
      if (!ent.isFile()) continue;
      if (!CODE_EXT.test(ent.name) || IS_TEST.test(ent.name)) continue;
      out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

// ── LEXER ───────────────────────────────────────────────────────────────────────────────────────
const KW_BEFORE_REGEX = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw',
  'case', 'do', 'else', 'yield', 'await',
]);
const IDENT = /[A-Za-z0-9_$]/;

/** Blank every non-code region to same-length spaces, keeping newlines so offsets and line numbers
 *  survive; `${ … }` inside a template is code. Throws on an unterminated construct. */
export function stripNonCode(src) {
  const out = new Array(src.length);
  const blank = (i) => { out[i] = src[i] === '\n' ? '\n' : ' '; };
  // Mode stack so `${}` can re-enter code inside a template literal, to any depth.
  const modes = [{ kind: 'code', braces: 0 }];
  let lastSig = '';        // last significant CODE character emitted
  let lastWord = '';       // last identifier emitted, for the regex/division decision
  let i = 0;
  while (i < src.length) {
    const m = modes[modes.length - 1];
    const c = src[i];
    if (m.kind === 'code') {
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') blank(i++); continue; }
      if (c === '/' && src[i + 1] === '*') {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) throw new Error('unterminated block comment');
        while (i <= end + 1) blank(i++);
        continue;
      }
      if (c === "'" || c === '"') { i = blankQuoted(src, i, out, c); lastSig = c; lastWord = ''; continue; }
      if (c === '`') { modes.push({ kind: 'template' }); blank(i++); lastSig = '`'; lastWord = ''; continue; }
      if (c === '/' && regexCanStartHere(lastSig, lastWord)) { i = blankRegex(src, i, out); lastSig = '/'; lastWord = ''; continue; }
      if (c === '}' && modes.length > 1 && m.braces === 0) { modes.pop(); blank(i++); continue; }   // closes a `${`; blanked, like its opener
      if (c === '{') m.braces++;
      if (c === '}') m.braces--;
      out[i] = c;
      if (!/\s/.test(c)) {
        lastSig = c;
        lastWord = IDENT.test(c) ? lastWord + c : '';
      }
      i++;
      continue;
    }
    // template literal body
    if (c === '\\') { blank(i++); if (i < src.length) blank(i++); continue; }
    if (c === '`') { modes.pop(); blank(i++); lastSig = '`'; lastWord = ''; continue; }
    if (c === '$' && src[i + 1] === '{') {
      // Blank BOTH interpolation delimiters, so depth is unchanged and no phantom scope is pushed.
      blank(i++); blank(i++);
      modes.push({ kind: 'code', braces: 0 });
      lastSig = '('; lastWord = '';                  // an interpolation opens an expression position
      continue;
    }
    blank(i++);
  }
  if (modes.length !== 1) throw new Error('unterminated template literal');
  return out.join('');
}

function blankQuoted(src, i, out, quote) {
  out[i] = ' '; i++;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { out[i] = ' '; i++; if (i < src.length) { out[i] = src[i] === '\n' ? '\n' : ' '; i++; } continue; }
    out[i] = c === '\n' ? '\n' : ' ';
    i++;
    if (c === quote) return i;
    if (c === '\n') throw new Error('unterminated string literal');
  }
  throw new Error('unterminated string literal');
}

function blankRegex(src, i, out) {
  out[i] = ' '; i++;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') throw new Error('unterminated regex literal');
    out[i] = ' '; i++;
    if (c === '\\') { if (i < src.length) { out[i] = ' '; i++; } continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      while (i < src.length && /[a-z]/.test(src[i])) { out[i] = ' '; i++; }   // flags
      return i;
    }
  }
  throw new Error('unterminated regex literal');
}

/** Regex vs division: previous-significant-token heuristic; the balance self-check in scanSource
 *  makes a wrong call loud. */
function regexCanStartHere(lastSig, lastWord) {
  if (!lastSig) return true;
  if (lastWord && KW_BEFORE_REGEX.has(lastWord)) return true;
  if (IDENT.test(lastSig)) return false;              // identifier/number → division
  if (lastSig === ')' || lastSig === ']') return false;
  if (lastSig === '}') return false;                  // ambiguous; division is the safer default
  return '(,=:[!&|?{};+-*%^~<>'.includes(lastSig);
}

// ── SCOPE NAMING ────────────────────────────────────────────────────────────────────────────────
const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'do', 'else', 'try', 'finally', 'return']);
const MODIFIERS = new Set(['async', 'get', 'set', 'static', 'function', 'export', 'default', 'new', 'await']);

const skipWsBack = (t, j) => { while (j >= 0 && /\s/.test(t[j])) j--; return j; };
function identBack(t, j) {
  const end = j;
  while (j >= 0 && IDENT.test(t[j])) j--;
  return { word: t.slice(j + 1, end + 1), j };
}
function matchingParenBack(t, j) {   // t[j] === ')'
  let d = 0;
  while (j >= 0) {
    if (t[j] === ')') d++;
    else if (t[j] === '(') { d--; if (d === 0) return j; }
    j--;
  }
  return -1;
}

/** Name of the scope opened by the `{` at braceIdx, or null for an unnamed block (inherits its
 *  parent). Best-effort: unnameable is null — coarser, never wrong-named. */
export function scopeNameAt(t, braceIdx) {
  let j = skipWsBack(t, braceIdx - 1);
  if (j < 0) return null;

  if (t[j] === '>' && t[j - 1] === '=') {                       // … => {
    j = skipWsBack(t, j - 2);
    if (t[j] === ')') { const p = matchingParenBack(t, j); if (p < 0) return '<arrow>'; j = skipWsBack(t, p - 1); }
    else if (IDENT.test(t[j])) { j = skipWsBack(t, identBack(t, j).j); }   // single-param arrow
    else return '<arrow>';
    { const mod = identBack(t, j); if (mod.word === 'async') j = skipWsBack(t, mod.j); }   // `= async (…) => {`
    if (t[j] === '=' && t[j - 1] !== '=' && t[j - 1] !== '!' && t[j - 1] !== '<' && t[j - 1] !== '>') {
      const a = identBack(t, skipWsBack(t, j - 1));
      return a.word && !MODIFIERS.has(a.word) ? a.word : '<arrow>';
    }
    if (t[j] === ':') {
      const a = identBack(t, skipWsBack(t, j - 1));
      return a.word && !MODIFIERS.has(a.word) ? a.word : '<arrow>';
    }
    return '<arrow>';
  }

  if (t[j] === ')') {                                            // … ( … ) {
    const p = matchingParenBack(t, j);
    if (p < 0) return null;
    j = skipWsBack(t, p - 1);
    const a = identBack(t, j);
    if (!a.word) {                                               // e.g. `function (…) {` written oddly
      return null;
    }
    if (BLOCK_KEYWORDS.has(a.word)) return null;                 // if/for/while/switch/catch/…
    if (a.word === 'function') {                                 // anonymous function expression
      const b = identBack(t, skipWsBack(t, a.j));
      if (b.word && !MODIFIERS.has(b.word) && !BLOCK_KEYWORDS.has(b.word)) return b.word;
      let k = skipWsBack(t, a.j);
      if (b.word === 'async') k = skipWsBack(t, b.j);            // `= async function (…) {`
      if (t[k] === '=' || t[k] === ':') {
        const c = identBack(t, skipWsBack(t, k - 1));
        if (c.word && !MODIFIERS.has(c.word)) return c.word;
      }
      return '<anon-function>';
    }
    return a.word;                                               // function decl, method, or ctor
  }

  if (IDENT.test(t[j])) {                                        // `class X {`, `try {`, `else {`, `X extends Y {`
    const a = identBack(t, j);
    if (BLOCK_KEYWORDS.has(a.word)) return null;
    const b = identBack(t, skipWsBack(t, a.j));
    if (b.word === 'class') return a.word;
    if (a.word === 'class') return '<anon-class>';
    // `class A extends B {` — walk back over `extends B`
    if (b.word === 'extends') {
      const c = identBack(t, skipWsBack(t, b.j));
      const d = identBack(t, skipWsBack(t, c.j));
      if (d.word === 'class') return c.word;
    }
    return null;
  }
  return null;
}

// ── SCAN ────────────────────────────────────────────────────────────────────────────────────────
const BARE_CATCH = /\bcatch\s*\{/g;

/** Every bare `catch {` as { symbol, line }; line is reporting only, never a key. Throws on a file
 *  that does not lex or balance (fail closed). */
export function scanSource(src, label = '<source>') {
  let t;
  try {
    t = stripNonCode(src);
  } catch (e) {
    throw new Error(`${label}: unlexable (${e.message})`);
  }
  // Self-check: refuse to report a number derived from a strip we cannot trust.
  let bal = 0, paren = 0, brack = 0;
  for (const c of t) {
    if (c === '{') bal++; else if (c === '}') bal--;
    else if (c === '(') paren++; else if (c === ')') paren--;
    else if (c === '[') brack++; else if (c === ']') brack--;
    if (bal < 0 || paren < 0 || brack < 0) throw new Error(`${label}: unbalanced after strip (negative depth) — lexer confidence lost`);
  }
  if (bal !== 0 || paren !== 0 || brack !== 0) {
    throw new Error(`${label}: unbalanced after strip (braces ${bal}, parens ${paren}, brackets ${brack}) — lexer confidence lost`);
  }

  const marks = [];
  BARE_CATCH.lastIndex = 0;
  for (let m; (m = BARE_CATCH.exec(t)); ) marks.push(m.index + m[0].length - 1);   // index of the `{`
  if (!marks.length) return [];

  // One walk of the braces, snapshotting the named-scope chain at each mark.
  const lineOf = buildLineIndex(t);
  const stack = [];
  const sites = [];
  let next = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '{') {
      if (next < marks.length && marks[next] === i) {
        const chain = stack.filter(Boolean);
        sites.push({ symbol: chain.length ? chain.join('>') : '<module>', line: lineOf(i) });
        next++;
        stack.push(null);                    // the catch block itself is unnamed
        continue;
      }
      stack.push(scopeNameAt(t, i));
    } else if (c === '}') {
      stack.pop();
    }
  }
  return sites;
}

function buildLineIndex(t) {
  const starts = [0];
  for (let i = 0; i < t.length; i++) if (t[i] === '\n') starts.push(i + 1);
  return (idx) => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

export const keyFor = (file, symbol) => `${file}::${symbol}`;

/** Measure the whole tree → { counts, sites, files }. An unreadable or unlexable file throws —
 *  never zero findings. */
export function measureTree({ root = scanRoot(), files = null } = {}) {
  const list = files || collectFiles(root);
  const counts = {};
  const sites = [];
  for (const rel of list) {
    let src;
    try {
      src = readFileSync(join(root, rel), 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') continue;                 // raced away between walk and read
      throw new Error(`${rel}: unreadable (${e.code || e.message})`);
    }
    for (const s of scanSource(src, rel)) {
      const k = keyFor(rel, s.symbol);
      counts[k] = (counts[k] || 0) + 1;
      sites.push({ key: k, file: rel, symbol: s.symbol, line: s.line });
    }
  }
  const sorted = {};
  for (const k of Object.keys(counts).sort()) sorted[k] = counts[k];
  sites.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.line - b.line));
  return { counts: sorted, sites, files: list };
}

export const totalOf = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);
export const digestOf = (counts) =>
  createHash('sha256').update(Object.entries(counts).map(([k, v]) => `${k}\t${v}`).join('\n')).digest('hex').slice(0, 16);

// ── CRITICAL MODULES ────────────────────────────────────────────────────────────────────────────
// Modules where a swallowed bug manufactures a false clean. Exact paths, not globs — the list is
// meant to be argued with one file at a time. Target ZERO; not a hard failure until conversion is
// staged (--strict-critical / CW_BARE_CATCH_STRICT_CRITICAL=1). Ordered by blast radius.
export const CRITICAL_FILES = [
  // JSONL loops swallow every line and still return { ran: true } — a false clean for the scanners.
  'monitor/extractors.mjs',
  // ...and the part modules it is being split into, each holding catch sites that were in it when
  // it was listed here. Added by the move (--rekey), not argued afresh: same code, same reason.
  'monitor/extractors/socket.mjs',
  'monitor/extractors/secrets.mjs',
  'monitor/extractors/supply-chain.mjs',
  'monitor/extractors/posture.mjs',
  'monitor/extractors/dast.mjs',
  'monitor/extractors/tree-contents.mjs',
  'monitor/extractors/sast-lint.mjs',
  'monitor/extractors/agent-surface.mjs',
  'monitor/extractors/history.mjs',
  // `catch { records = [] }` empties the harness that proves the gates work.
  'bin/canary-harness.mjs',
  // kevDoc/epss read to {} on any error — severity flattens toward clean.
  'monitor/rollup.mjs',
  // readAnchorLine's catch is the anchor-drift instrument.
  'monitor/issue-store.mjs',
  // One best-effort chmodSync; kept to stay watched — correct closure is --accept, not a rewrite.
  'admin/auth.mjs',
];
// Takes the arg list so main can be driven in-process by a test.
export const strictCritical = (args = []) =>
  args.includes('--strict-critical') || process.env.CW_BARE_CATCH_STRICT_CRITICAL === '1';

export const criticalReport = (counts, critical = CRITICAL_FILES) =>
  critical.map((file) => ({
    file,
    count: Object.entries(counts).filter(([k]) => k.startsWith(`${file}::`)).reduce((a, [, v]) => a + v, 0),
  }));

// ── BASELINE ────────────────────────────────────────────────────────────────────────────────────
export const EMPTY_BASELINE = () => ({
  _comment: 'Baseline for bin/bare-catch-ratchet.mjs. Keys are <file>::<named-scope-chain> — LINE-FREE by house rule. Never hand-edit; use --seed / --tighten / --accept.',
  version: 1,
  keys: {},
  critical: CRITICAL_FILES,
  journal: [],
});

/** { state, doc }, state 'ok' | 'absent' | 'unreadable'. Only ENOENT is absent; anything else is
 *  'unreadable', never an empty baseline — an empty baseline grandfathers nothing. */
export function loadBaseline(path = baselinePath()) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { state: 'absent', doc: null, reason: 'ENOENT' };
    return { state: 'unreadable', doc: null, reason: `${e.code || e.message}` };
  }
  let j;
  try {
    j = JSON.parse(raw);
  } catch (e) {
    return { state: 'unreadable', doc: null, reason: `unparseable JSON (${e.message})` };
  }
  if (!j || typeof j !== 'object' || typeof j.keys !== 'object' || j.keys === null || Array.isArray(j.keys)) {
    return { state: 'unreadable', doc: null, reason: 'not a baseline document (missing object `keys`)' };
  }
  for (const [k, v] of Object.entries(j.keys)) {
    if (!Number.isInteger(v) || v < 0) return { state: 'unreadable', doc: null, reason: `key ${k} has a non-count value` };
  }
  return {
    state: 'ok',
    doc: {
      ...EMPTY_BASELINE(),
      ...j,
      keys: j.keys,
      critical: Array.isArray(j.critical) ? j.critical : CRITICAL_FILES,
      journal: Array.isArray(j.journal) ? j.journal : [],
    },
  };
}

/** Set difference, both directions. added/grew is the ratchet biting; gone/shrank is progress,
 *  reported but NEVER auto-banked. */
export function compare(current, baselineKeys) {
  const added = [], grew = [], shrank = [], gone = [];
  for (const k of Object.keys(current).sort()) {
    const was = baselineKeys[k];
    if (was === undefined) added.push({ key: k, now: current[k] });
    else if (current[k] > was) grew.push({ key: k, was, now: current[k] });
    else if (current[k] < was) shrank.push({ key: k, was, now: current[k] });
  }
  for (const k of Object.keys(baselineKeys).sort()) if (current[k] === undefined) gone.push({ key: k, was: baselineKeys[k] });
  return { added, grew, shrank, gone };
}

// ── REKEY: a move is not a new catch ────────────────────────────────────────────────────────────
// Keys carry the file path, so moving a function to another module reads as one key GONE and one
// NEW. The only tool that could clear that was --accept, and --accept writes `keys: counts` for the
// WHOLE tree. Measured 2026-09-22 while splitting monitor/extractors.mjs: the tree already showed
// 276 NEW/GREW lines of other sessions' drift, so one accept to record a move would have
// grandfathered all of it under a reason that described none of it.
//
// --rekey <from> <to> moves BASELINE entries, never current counts. Each baseline key
// `<from>::<scope>` whose scope has left <from> and now appears under <to> is renamed to
// `<to>::<scope>` with its count unchanged. So a function baselined at 1 that measures 2 still
// reports GREW 1 → 2 afterwards, at its new path: the move is recorded and the drift stays visible.
// The baseline total is asserted unchanged, and the move is journaled.
//
// Refused, never guessed: a scope still present under <from> (a split — which half inherits the
// allowance is a judgment, not a rename); a baseline that already holds `<to>::<scope>`; and a rekey
// that moves nothing, which is almost always a mistyped path.
//
// If <from> is a critical module, <to> joins the critical list in the same write, so a watch keyed on
// an exact path does not lapse because the code under it moved. CRITICAL_FILES must carry <to> too,
// or a later --seed drops it again — bin/test/bare-catch-ratchet.test.mjs asserts that.
export function rekeyPlan(current, doc, from, to) {
  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const src = norm(from);
  const dst = norm(to);
  if (!src || !dst || src === dst) {
    return { ok: false, why: `--rekey needs two different paths, got ${JSON.stringify(from)} -> ${JSON.stringify(to)}` };
  }
  const moves = [], split = [], occupied = [];
  for (const k of Object.keys(doc.keys).sort()) {
    if (!k.startsWith(`${src}::`)) continue;
    const scope = k.slice(src.length + 2);
    if (current[`${dst}::${scope}`] === undefined) continue;   // did not arrive: unmoved, or gone (--tighten's)
    if (current[k] !== undefined) { split.push(scope); continue; }
    if (doc.keys[`${dst}::${scope}`] !== undefined) { occupied.push(scope); continue; }
    moves.push({ scope, count: doc.keys[k] });
  }
  if (split.length) return { ok: false, why: `scope(s) present under BOTH ${src} and ${dst}: ${split.join(', ')} — a split is a judgment, not a rename` };
  if (occupied.length) return { ok: false, why: `the baseline already holds ${dst}:: keys for ${occupied.join(', ')}` };
  if (!moves.length) return { ok: false, why: `nothing to rekey — no baseline key under ${src}:: whose scope now appears under ${dst}::` };
  const keys = { ...doc.keys };
  for (const m of moves) { delete keys[`${src}::${m.scope}`]; keys[`${dst}::${m.scope}`] = m.count; }
  const sorted = Object.fromEntries(Object.keys(keys).sort().map((k) => [k, keys[k]]));
  if (totalOf(sorted) !== totalOf(doc.keys)) return { ok: false, why: 'internal: a rekey changed the baseline total' };
  const at = doc.critical.indexOf(src);
  const criticalAdded = at !== -1 && !doc.critical.includes(dst);
  const critical = criticalAdded ? [...doc.critical.slice(0, at + 1), dst, ...doc.critical.slice(at + 1)] : doc.critical;
  return { ok: true, from: src, to: dst, moves, keys: sorted, critical, criticalAdded };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const EXIT = { PASS: 0, FINDINGS: 1, FAILURE: 2, NOT_SEEDED: 3 };
export { EXIT };

function argValue(args, flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export function main(argv = process.argv, out = process.stdout, err = process.stderr) {
  const args = argv.slice(2);
  const json = args.includes('--json');
  const at = nowStamp();

  let measured;
  try {
    measured = measureTree();
  } catch (e) {
    err.write(`bare-catch-ratchet: FAILURE — ${e.message}\n`);
    return EXIT.FAILURE;
  }
  const { counts, sites } = measured;
  const total = totalOf(counts);

  const loaded = loadBaseline();

  if (args.includes('--seed')) {
    if (loaded.state === 'unreadable') {
      err.write(`bare-catch-ratchet: FAILURE — existing baseline unreadable (${loaded.reason}); refusing to overwrite\n`);
      return EXIT.FAILURE;
    }
    if (loaded.state === 'ok' && !args.includes('--force')) {
      err.write('bare-catch-ratchet: FAILURE — baseline already exists. Re-seeding grandfathers whatever is on the tree right now, '
        + 'including a regression that landed five minutes ago. Use --tighten to bank improvements, --accept --reason "<why>" to add a '
        + 'key deliberately, or --seed --force if you really mean to re-photograph the tree.\n');
      return EXIT.FAILURE;
    }
    const doc = { ...(loaded.doc || EMPTY_BASELINE()), keys: counts, critical: CRITICAL_FILES };
    doc.journal = [...(doc.journal || []), { at, action: loaded.state === 'ok' ? 'reseed' : 'seed', keys: Object.keys(counts).length, total, digest: digestOf(counts) }];
    writeJSONAtomic(baselinePath(), doc);
    out.write(`bare-catch-ratchet: ${loaded.state === 'ok' ? 're-seeded' : 'seeded'} ${Object.keys(counts).length} keys / ${total} bare catches → ${baselinePath()}\n`);
    return EXIT.PASS;
  }

  if (loaded.state === 'unreadable') {
    err.write(`bare-catch-ratchet: FAILURE — baseline unreadable (${loaded.reason}). This is NOT "no findings": an unreadable prior `
      + 'grandfathers nothing and proves nothing. Fix or restore the file; --seed refuses to overwrite it.\n');
    return EXIT.FAILURE;
  }
  if (loaded.state === 'absent') {
    err.write(`bare-catch-ratchet: NOT SEEDED — no baseline at ${baselinePath()} (ENOENT). Measured ${total} bare catches across `
      + `${Object.keys(counts).length} keys but there is nothing to compare against. A ratchet that re-seeds itself on a missing prior `
      + 'is a gate anyone clears by deleting a file. Seed deliberately: node bin/bare-catch-ratchet.mjs --seed\n');
    return EXIT.NOT_SEEDED;
  }

  if (args.includes('--rekey')) {
    const i = args.indexOf('--rekey');
    const from = args[i + 1], to = args[i + 2];
    if (!from || !to || from.startsWith('--') || to.startsWith('--')) {
      err.write('bare-catch-ratchet: FAILURE — usage: --rekey <from-path> <to-path>, repo-relative as the keys spell them.\n');
      return EXIT.FAILURE;
    }
    const plan = rekeyPlan(counts, loaded.doc, from, to);
    if (!plan.ok) {
      err.write(`bare-catch-ratchet: FAILURE — ${plan.why}. Baseline untouched.\n`);
      return EXIT.FAILURE;
    }
    const doc = { ...loaded.doc, keys: plan.keys, critical: plan.critical };
    doc.journal = [...doc.journal, {
      at, action: 'rekey', from: plan.from, to: plan.to, moved: plan.moves.map((m) => m.scope),
      ...(plan.criticalAdded ? { criticalAdded: plan.to } : {}), total: totalOf(plan.keys), digest: digestOf(plan.keys),
    }];
    writeJSONAtomic(baselinePath(), doc);
    out.write(`bare-catch-ratchet: rekeyed ${plan.moves.length} key(s) ${plan.from} -> ${plan.to}; baseline total unchanged at `
      + `${totalOf(plan.keys)}${plan.criticalAdded ? `; ${plan.to} joins the critical modules` : ''}\n`);
    return EXIT.PASS;
  }

  const base = loaded.doc.keys;
  const diff = compare(counts, base);
  const crit = criticalReport(counts, loaded.doc.critical);
  const critTotal = crit.reduce((a, c) => a + c.count, 0);
  const gained = diff.added.length > 0 || diff.grew.length > 0;
  const critFail = strictCritical(args) && critTotal > 0;

  if (args.includes('--tighten')) {
    if (gained) {
      err.write('bare-catch-ratchet: FAILURE — refusing to tighten while the set has GAINED members. --tighten banks improvements only; '
        + 'letting it run now would bank a regression alongside them and the net would read clean.\n');
      return EXIT.FAILURE;
    }
    const keys = { ...base };
    for (const g of diff.gone) delete keys[g.key];
    for (const s of diff.shrank) keys[s.key] = s.now;
    const doc = { ...loaded.doc, keys: Object.fromEntries(Object.keys(keys).sort().map((k) => [k, keys[k]])) };
    doc.journal = [...doc.journal, { at, action: 'tighten', removed: diff.gone.length, lowered: diff.shrank.length, total: totalOf(doc.keys), digest: digestOf(doc.keys) }];
    writeJSONAtomic(baselinePath(), doc);
    out.write(`bare-catch-ratchet: tightened — ${diff.gone.length} keys removed, ${diff.shrank.length} lowered; floor now ${totalOf(doc.keys)}\n`);
    return EXIT.PASS;
  }

  if (args.includes('--accept')) {
    const reason = argValue(args, '--reason');
    if (!reason || reason.startsWith('--')) {
      err.write('bare-catch-ratchet: FAILURE — --accept requires --reason "<why this bare catch is correct>". An unexplained accept is '
        + 'indistinguishable from the erosion this gate exists to stop.\n');
      return EXIT.FAILURE;
    }
    const doc = { ...loaded.doc, keys: counts, critical: loaded.doc.critical };
    doc.journal = [...doc.journal, { at, action: 'accept', reason, added: diff.added.map((a) => a.key), grew: diff.grew.map((g) => g.key), total, digest: digestOf(counts) }];
    writeJSONAtomic(baselinePath(), doc);
    out.write(`bare-catch-ratchet: accepted ${diff.added.length} new + ${diff.grew.length} grown key(s) — "${reason}"\n`);
    return EXIT.PASS;
  }

  const result = {
    at,
    total,
    keys: Object.keys(counts).length,
    digest: digestOf(counts),
    baselineTotal: totalOf(base),
    baselineKeys: Object.keys(base).length,
    added: diff.added,
    grew: diff.grew,
    shrank: diff.shrank,
    gone: diff.gone,
    critical: crit,
    acceptance: { neverGained: !gained, criticalEmpty: critTotal === 0, met: !gained && critTotal === 0 },
    verdict: gained || critFail ? 'findings' : 'pass',
  };

  if (json) { out.write(`${JSON.stringify(result, null, 2)}\n`); return gained || critFail ? EXIT.FINDINGS : EXIT.PASS; }

  const lines = [];
  lines.push(`bare-catch-ratchet @ ${at}`);
  lines.push(`  measured ${total} bare catches across ${result.keys} keys (baseline ${result.baselineTotal} / ${result.baselineKeys})`);
  for (const a of diff.added) lines.push(`  NEW    ${a.key}  (+${a.now})`);
  for (const g of diff.grew) lines.push(`  GREW   ${g.key}  ${g.was} → ${g.now}`);
  if (args.includes('--status')) {
    for (const s of diff.shrank) lines.push(`  better ${s.key}  ${s.was} → ${s.now}`);
    for (const g of diff.gone) lines.push(`  GONE   ${g.key}  (was ${g.was})`);
    lines.push('  critical modules (target 0):');
    for (const c of crit) lines.push(`    ${c.count === 0 ? 'CLEAR    ' : 'OUTSTANDING'} ${c.file}  ${c.count}`);
    lines.push(`  acceptance: tracked set never gained a member = ${result.acceptance.neverGained ? 'YES' : 'NO'}; critical modules empty = ${result.acceptance.criticalEmpty ? 'YES' : 'NO'}`);
    const byFile = {};
    for (const s of sites) byFile[s.file] = (byFile[s.file] || 0) + 1;
    lines.push('  top offenders:');
    for (const [f, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 12)) lines.push(`    ${String(n).padStart(3)}  ${f}`);
  }
  if (gained) {
    lines.push('  A bare `catch {` cannot tell a ReferenceError from an ENOENT. If this site legitimately tolerates failure, say so:');
    lines.push('    node bin/bare-catch-ratchet.mjs --accept --reason "best-effort git call; failure is expected"');
    lines.push('  Otherwise import rethrowIfBug from bin/rethrow.mjs and name the error.');
    lines.push('  If the code MOVED rather than grew, record the move without accepting anything else:');
    lines.push('    node bin/bare-catch-ratchet.mjs --rekey <from-path> <to-path>');
  }
  if (critFail) lines.push(`  STRICT: ${critTotal} bare catch(es) remain in critical modules.`);
  (gained || critFail ? err : out).write(`${lines.join('\n')}\n`);
  return gained || critFail ? EXIT.FINDINGS : EXIT.PASS;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv));
