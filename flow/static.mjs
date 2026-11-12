// C1 — the static pass. Read/write/spawn edges from path literals, CW_* env keys and spawn targets.
//
// Every emitted edge stands on a string literal that the hand-rolled lexer found AND that V8
// accepted when the source was rebuilt from the lexer's own classification (flow/verify.mjs). A
// module whose lexer bails, whose source V8 cannot parse, or whose rebuild V8 rejects is UNKNOWN:
// it contributes no edges, and — the half that is routinely dropped — its artifacts are excluded
// from orphan findings, because "nothing reads this" said over a file nobody could read is a
// fabricated finding.
//
// The coverage claim is over the FILE SET, not the edges found: analysed + unanalysable = the whole
// input, and unanalysable is enumerated by name and reason.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import { dirname, extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, rawQuotedRuns, matchBracket, splitArgs, importedNames } from './lexer.mjs';
import { timerSites, inRanges, analyseTriggers } from './triggers.mjs';
import { parseModule, maskConsistent, maskFrom, specifierCoverage } from './verify.mjs';
import { makeNode, makeEdge, mergeEdges, artifactKinds, nodeId, SCHEMA_VERSION } from './graph.mjs';
import { storePath, writeJson, now } from './store.mjs';
import { isMainModule } from '../lib/is-main.mjs';

export const REPO_DIRS = new Set([
  'reports', 'monitor', 'manifests', 'schema', 'evaluations', 'fixtures', 'docs', 'bin', 'lib',
  'admin', 'cra', 'map', 'sitemap', 'mcp', 'workflows', 'prompts', 'provenance', 'ci', 'design',
  'docsite', 'intake', 'flow', 'chunk-diff', 'workspace', 'reference',
  '.claude', '.github', 'spec',
]);

const ARTIFACT_EXT =
  /\.(json|jsonl|ndjson|md|html?|sarif|txt|log|csv|tsv|ya?ml|lock|sh|mjs|cjs|js|png|svg|ico|xml|db|sqlite|pem|plist|patch|diff|tsv)$/i;

const READ_VERBS = ['readFileSync', 'readFile', 'createReadStream', 'readdirSync', 'readdir',
  'existsSync', 'statSync', 'lstatSync', 'opendirSync', 'realpathSync', 'accessSync', 'globSync',
  'readJson', 'readJsonSync', 'loadJson', 'readStore', 'readJournal', 'readJournalFile',
  'watch', 'watchFile'];
// A writer that only ever adds to the end, and a reader that follows the end: together a broker.
const APPEND_VERBS = ['appendFileSync', 'appendFile'];
const TAIL_VERBS = ['createReadStream', 'watch', 'watchFile'];
const CP_MODULES = ['node:child_process', 'child_process'];
const FS_MODULES = ['node:fs', 'fs', 'node:fs/promises', 'fs/promises'];
const HTTP_MODULES = ['node:http', 'http', 'node:https', 'https', 'node:net', 'net', 'node:http2', 'http2', 'node:tls', 'tls'];
const WRITE_VERBS = ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile',
  'createWriteStream', 'mkdirSync', 'renameSync', 'copyFileSync', 'cpSync', 'unlinkSync', 'rmSync',
  'symlinkSync', 'truncateSync', 'utimesSync', 'writeAtomic', 'writeJson', 'writeJsonSync'];
const SPAWN_VERBS = ['spawnSync', 'spawn', 'execFileSync', 'execFile', 'execSync', 'exec', 'fork'];

const VERB_RE = new RegExp(`\\b(${[...READ_VERBS, ...WRITE_VERBS, ...SPAWN_VERBS].join('|')})\\s*\\(`, 'g');
const SPAWN_HEAD_RE = new RegExp(`\\b(${SPAWN_VERBS.join('|')})\\s*\\(\\s*$`);
const ENV_DOT_RE = /\benv\.(CW_[A-Z0-9_]+)\b/g;
// A top-level `const X = process.env.CW_Y` is read ONCE at import and defeats every test that sets
// the override afterwards. `const f = () => process.env.CW_Y` does not — the read happens on call.
// The lookahead is what tells them apart; without it every arrow function was flagged.
const ENV_LOADTIME_RE = /^(?:export\s+)?(?:const|let|var)\s+[\w$]+\s*=(?:(?!=>|\bfunction\b)[^;])*\benv\.CW_[A-Z0-9_]+/;

// ── languages: what the pass reads in a repository that is not this one ─────────────────────────
//
// JavaScript and TypeScript only. Each extension fixes a language and a parse goal: .mjs/.mts are
// modules, .cjs/.cts CommonJS, and .js/.jsx/.ts/.tsx are whichever V8 accepts, module first (a
// package.json `type` is not read: the parse is the witness, not the declaration). TypeScript is
// read through node:module stripTypeScriptTypes in strip mode, which replaces every annotation with
// whitespace of the same length, so offsets and line numbers are the source's own. Strip mode
// refuses what needs a transform (enum, namespace, parameter properties) and JSX; such a file is
// `unsupported-language`, counted with its reason, never analysed as something else.
export const SOURCE_EXTS = Object.freeze(['.mjs', '.cjs', '.js', '.jsx', '.ts', '.tsx', '.mts', '.cts']);
const GOALS = { '.mjs': ['module'], '.mts': ['module'], '.cjs': ['commonjs'], '.cts': ['commonjs'] };
const TS_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const JSX_EXTS = new Set(['.jsx', '.tsx']);
// Source in a language this pass does not read: counted per language in the summary.
const OTHER_LANGUAGES = {
  '.py': 'python', '.go': 'go', '.rb': 'ruby', '.php': 'php', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
  '.rs': 'rust', '.c': 'c', '.h': 'c', '.cc': 'c++', '.cpp': 'c++', '.hpp': 'c++', '.cs': 'c#', '.swift': 'swift',
  '.scala': 'scala', '.m': 'objective-c', '.mm': 'objective-c', '.dart': 'dart', '.lua': 'lua', '.pl': 'perl',
  '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.hs': 'haskell', '.clj': 'clojure', '.fs': 'f#',
  '.vue': 'vue', '.svelte': 'svelte', '.astro': 'astro', '.cob': 'cobol', '.cbl': 'cobol', '.groovy': 'groovy',
};
/** Files larger than this are counted `too-large`, not read: a bundle is not a module anyone wrote. */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export const isSourcePath = (p) => SOURCE_EXTS.includes(extname(p).toLowerCase());
export const languageOf = (p) => {
  const e = extname(p).toLowerCase();
  if (TS_EXTS.has(e)) return 'typescript';
  if (SOURCE_EXTS.includes(e)) return 'javascript';
  return OTHER_LANGUAGES[e] || null;
};

/** -> { ok: true, code } with types replaced by whitespace, or { ok: false, state, reason }. */
export function stripTypes(src, path, strip = nodeModule.stripTypeScriptTypes) {
  if (typeof strip !== 'function') {
    return { ok: false, state: 'unsupported-language', reason: `TypeScript: node:module stripTypeScriptTypes is not available on Node ${process.version}` };
  }
  // It warns once per process that it is experimental; the warning is about this call, not the file.
  const emit = process.emitWarning;
  process.emitWarning = (w, ...rest) => { if (!/stripTypeScriptTypes/.test(String(w?.message ?? w))) emit.call(process, w, ...rest); };
  try {
    const code = strip(String(src), { mode: 'strip' });
    if (code.length !== String(src).length) return { ok: false, state: 'unparseable', reason: 'TypeScript: stripping changed the length, so offsets would not be the source\'s' };
    return { ok: true, code };
  } catch (e) {
    const unsupported = e.code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' || JSX_EXTS.has(extname(path).toLowerCase());
    return { ok: false, state: unsupported ? 'unsupported-language' : 'unparseable', reason: `TypeScript: ${e.code ? `${e.code} ` : ''}${e.message}` };
  } finally {
    process.emitWarning = emit;
  }
}

/** Is this string value plausibly a repo artifact path? Conservative on purpose. */
export function looksLikePath(v) {
  if (typeof v !== 'string' || !v || v.length > 200) return false;
  if (/[\s*?\n]/.test(v)) return false;                       // globs and prose are not paths
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false;           // node:, http:, data:, file:
  if (v.includes('${')) return false;                         // not statically resolvable
  // A bare extension is a SUFFIX TEST, not a path: `endsWith('.md')` appears all over this tree and
  // was minting artifact nodes called ".md" and ".jsonl". Require a name before the dot.
  if (/^\.[a-z0-9]+$/i.test(v)) return false;
  if (ARTIFACT_EXT.test(v)) return true;
  const head = v.replace(/^\.\.?\//, '').split('/')[0];
  return v.includes('/') && REPO_DIRS.has(head);
}

/**
 * identifier -> roles it is passed to as a first argument, e.g. `readFileSync(P` -> P:{reads}.
 *
 * The overwhelmingly common shape here is `const P = join(OUT, 'x.json')` on one line and
 * `readFileSync(P)` on another, which no lookback window can reach. Without this the direction is
 * genuinely unknown for ~44% of artifact edges — honest, but too coarse to act on.
 */
export function argRoles(masked) {
  const out = new Map();
  for (const m of masked.matchAll(/\b([\w$]+)\s*\(\s*([\w$]+)\s*[,)]/g)) {
    const role = READ_VERBS.includes(m[1]) ? 'reads' : WRITE_VERBS.includes(m[1]) ? 'writes' : null;
    if (!role) continue;
    if (!out.has(m[2])) out.set(m[2], new Set());
    out.get(m[2]).add(role);
  }
  return out;
}

/** The `const NAME =` this literal is being bound to, if any. */
export function bindingName(src, masked, at) {
  const from = src.lastIndexOf('\n', at) + 1;
  const m = /(?:^|[;{]\s*)(?:export\s+)?(?:const|let|var)\s+([\w$]+)\s*=[^=]*$/.exec(masked.slice(from, at));
  return m ? m[1] : null;
}

// A fallback is what makes a dead dependency look alive: the read fails, the default returns, and
// nothing ever reports. "reads X" and "reads X, falls back to Y" are different findings, so the
// marker is recorded on the edge rather than folded into it. `suspected`, never asserted — this is
// a window scan, and calling it certain would be the over-reporting this repo pays for.
const FALLBACK_RE = /\}\s*catch|catch\s*[({]|\?\?|\|\|\s*[[{'"0-9]|:\s*(?:\[\]|\{\}|null)/;
const TRY_RE = /\btry\s*\{/;

export function fallbackNear(masked, at) {
  const after = masked.slice(at, at + 260);
  const before = masked.slice(Math.max(0, at - 160), at);
  const m = FALLBACK_RE.exec(after) || (TRY_RE.test(before) ? { 0: 'try' } : null);
  return m ? { suspected: true, marker: String(m[0]).trim().slice(0, 24) } : null;
}

// C5 asks what freshness a consumer ASSUMES. A consumer that checks nothing is itself the finding,
// so the absence has to be detectable — which means the presence has to be.
const FRESHNESS_RE = /\bmtime|\bmtimeMs|\bmaxAge|\bttl\b|\bTTL\b|STALE|\bageMs|\bageDays|\bstaleAfter|Date\.now\(\)\s*-/;

export function freshnessNear(masked, at) {
  const m = FRESHNESS_RE.exec(masked.slice(Math.max(0, at - 200), at + 400));
  return m ? { checks: true, marker: m[0] } : null;
}

/** Nearest enclosing call verb before `at`, from the MASKED source so prose cannot supply one. */
export function verbBefore(masked, at, window = 260, { cpNamespaces = new Set() } = {}) {
  const text = masked.slice(Math.max(0, at - window), at);
  // An object property VALUE is not a call argument. `$schema: '../schema/x.schema.json'` in
  // bin/docsite-new.mjs was read as a file read because a read verb happened to sit within the
  // lookback window — the one confirmed false positive in the first verified run of this tool.
  if (/:\s*$/.test(text)) return { verb: null, role: 'unknown' };
  let last = null;
  VERB_RE.lastIndex = 0;
  for (const m of text.matchAll(VERB_RE)) last = m[1];
  if (SPAWN_HEAD_RE.test(text)) {
    // `db.exec('CREATE TABLE …')`, `RE.exec('…')`: a METHOD called exec is a database or a regex,
    // not child_process, unless its receiver is a child_process namespace. Read as a spawn, every
    // SQL statement handed to node:sqlite became a process node.
    const member = /([\w$]+)\s*\.\s*(exec|execSync)\s*\(\s*$/.exec(text);
    if (member && !cpNamespaces.has(member[1])) return { verb: member[2], role: 'not-spawn' };
    return { verb: last, role: 'spawn-target' };
  }
  if (!last) return { verb: null, role: 'unknown' };
  if (READ_VERBS.includes(last)) return { verb: last, role: 'reads' };
  if (WRITE_VERBS.includes(last)) return { verb: last, role: 'writes' };
  return { verb: last, role: 'unknown' };
}

// ── values: what an argument expression evaluates to, when that is statically knowable ───────────
//
// Read off the masked source (flow/lexer.mjs matchBracket/splitArgs) with literal values taken ONLY
// from classify()'s spans. `{ ok:false }` is a first-class answer: the caller reports the site as
// unanalysable rather than guessing, because an endpoint or database that cannot be named is
// unknown, and unknown is never clean.

/** -> a context for one analysed module. */
export function valueContext(path, masked, spans) {
  const lits = spans.filter((s) => s.kind === 'string' || s.kind === 'template');
  const byStart = new Map(lits.map((s) => [s.start, s]));
  return { path, masked, spans: lits, byStart, decls: null };
}

/** The template literal starting at `start` -> [{lit}|{expr:{start,end}}] and its end offset. */
export function templateParts(ctx, start) {
  const parts = [];
  let sp = ctx.byStart.get(start);
  while (sp) {
    parts.push({ lit: sp.value });
    if (ctx.masked[sp.end - 1] === '`' && sp.end - 1 >= sp.innerEnd) return { parts, end: sp.end };
    const open = sp.end - 1;                                   // the `{` of `${`
    const close = matchBracket(ctx.masked, open);
    if (close === -1) return null;
    parts.push({ expr: { start: open + 1, end: close } });
    sp = ctx.byStart.get(close);
  }
  return null;
}

const trimRange = (m, a, b) => {
  while (a < b && /\s/.test(m[a])) a += 1;
  while (b > a && /\s/.test(m[b - 1])) b -= 1;
  return [a, b];
};

/** -> a descriptor of the expression in [start,end). */
export function exprAt(ctx, start, end) {
  const [a, b] = trimRange(ctx.masked, start, end);
  const text = ctx.masked.slice(a, b);
  const sp = ctx.byStart.get(a);
  if (sp && sp.kind === 'string' && sp.end === b) return { type: 'string', value: sp.value, at: a };
  if (sp && sp.kind === 'template' && ctx.masked[a] === '`') {
    const t = templateParts(ctx, a);
    if (t && t.end === b) return { type: 'template', parts: t.parts, at: a };
  }
  if (/^\d+$/.test(text)) return { type: 'number', value: Number(text), at: a };
  if (/^[A-Za-z_$][\w$]*$/.test(text)) return { type: 'ident', name: text, at: a };
  if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/.test(text)) return { type: 'member', text, at: a };
  if (text.startsWith('{') && matchBracket(ctx.masked, a) === b - 1) return { type: 'object', open: a, at: a };
  if (text.startsWith('[') && matchBracket(ctx.masked, a) === b - 1) return { type: 'array', open: a, at: a };
  const call = /^(new\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/.exec(text);
  if (call) {
    const open = a + call[0].length - 1;
    if (matchBracket(ctx.masked, open) === b - 1) {
      return { type: 'call', callee: call[2], isNew: !!call[1], open, at: a };
    }
  }
  return { type: 'other', text, at: a };
}

export function argsOf(ctx, open) {
  return (splitArgs(ctx.masked, open) || []).map((r) => exprAt(ctx, r.start, r.end));
}

/** `{ key: value, short }` -> Map key -> descriptor. */
export function objectProps(ctx, open) {
  const out = new Map();
  for (const r of splitArgs(ctx.masked, open) || []) {
    const piece = ctx.masked.slice(r.start, r.end);
    const kv = /^([A-Za-z_$][\w$]*)\s*:/.exec(piece);
    if (kv) out.set(kv[1], exprAt(ctx, r.start + kv[0].length, r.end));
    else if (/^[A-Za-z_$][\w$]*$/.test(piece)) out.set(piece, { type: 'ident', name: piece, at: r.start });
    else {
      const q = ctx.byStart.get(r.start);                       // 'quoted-key': value
      const colon = q ? /^\s*:/.exec(ctx.masked.slice(q.end, r.end)) : null;
      if (q && colon) out.set(q.value, exprAt(ctx, q.end + colon[0].length, r.end));
    }
  }
  return out;
}

/** The initialiser range of the first `const|let|var NAME =` in the module, or null. */
export function declInit(ctx, name) {
  if (!ctx.decls) {
    ctx.decls = new Map();
    for (const m of ctx.masked.matchAll(/(?<![\w$.])(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=(?![=>])\s*/g)) {
      if (ctx.decls.has(m[1])) continue;
      const from = m.index + m[0].length;
      let depth = 0;
      let i = from;
      for (; i < ctx.masked.length; i += 1) {
        const c = ctx.masked[i];
        if (c === '(' || c === '[' || c === '{') depth += 1;
        else if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth -= 1; }
        else if (depth === 0 && (c === ';' || c === ',' || c === '\n')) break;
      }
      ctx.decls.set(m[1], { start: from, end: i });
    }
  }
  return ctx.decls.get(name) || null;
}

const JOINERS = new Set(['join', 'resolve', 'path.join', 'path.resolve', 'posix.join', 'path.posix.join']);
const MODULE_DIR = new Set(['__dirname', 'import.meta.dirname']);

/**
 * -> { ok:true, value, base? } | { ok:false, reason, head? }.
 * `base` is set when the value is a path joined onto a directory: 'module' (this file's directory),
 * 'root' (the repository), or 'unknown' (a directory variable this cannot see into).
 * `special` is 'execPath' for process.execPath.
 */
export function resolveValue(ctx, d, depth = 0) {
  if (!d) return { ok: false, reason: 'missing' };
  if (depth > 6) return { ok: false, reason: 'too deep' };
  switch (d.type) {
    case 'string': return { ok: true, value: d.value };
    case 'number': return { ok: true, value: d.value };
    case 'template': {
      let value = '';
      for (const p of d.parts) {
        if ('lit' in p) { if (p.lit === null) return { ok: false, reason: 'undecodable literal', head: value }; value += p.lit; continue; }
        const r = resolveValue(ctx, exprAt(ctx, p.expr.start, p.expr.end), depth + 1);
        if (!r.ok || r.base || r.special) return { ok: false, reason: 'computed template', head: value };
        value += String(r.value);
      }
      return { ok: true, value };
    }
    case 'ident': {
      if (MODULE_DIR.has(d.name)) return { ok: true, value: '', base: 'module' };
      if (d.name === '__filename') return { ok: true, value: '', base: 'module', fileOfModule: true };
      const init = declInit(ctx, d.name);
      if (!init) return { ok: false, reason: `unresolved ${d.name}` };
      return resolveValue(ctx, exprAt(ctx, init.start, init.end), depth + 1);
    }
    case 'member':
      if (d.text === 'process.execPath') return { ok: true, value: 'node', special: 'execPath' };
      if (d.text === 'import.meta.url') return { ok: true, value: '', base: 'module', fileOfModule: true };
      if (MODULE_DIR.has(d.text)) return { ok: true, value: '', base: 'module' };
      return { ok: false, reason: `unresolved ${d.text}` };
    case 'call': {
      const args = argsOf(ctx, d.open);
      if (['String', 'Number', 'fileURLToPath', 'normalize', 'path.normalize'].includes(d.callee) && args.length >= 1) {
        return resolveValue(ctx, args[0], depth + 1);
      }
      if (d.callee === 'process.cwd' && !args.length) return { ok: true, value: '', base: 'root' };
      if ((d.callee === 'dirname' || d.callee === 'path.dirname') && args.length === 1) {
        const r = resolveValue(ctx, args[0], depth + 1);
        if (!r.ok) return r;
        if (r.fileOfModule) return { ok: true, value: '', base: 'module' };
        if (typeof r.value !== 'string' || r.special) return { ok: false, reason: 'computed dirname' };
        const value = r.value.includes('/') ? r.value.replace(/\/[^/]*$/, '') : '';
        return r.base ? { ok: true, value, base: r.base } : { ok: true, value };
      }
      if (d.isNew && d.callee === 'URL') {
        if (args.length === 2 && args[1].type === 'member' && args[1].text === 'import.meta.url') {
          const r = resolveValue(ctx, args[0], depth + 1);
          return r.ok ? { ok: true, value: String(r.value), base: 'module' } : r;
        }
        if (args.length === 1) return resolveValue(ctx, args[0], depth + 1);
        if (args.length === 2) {
          const rel = resolveValue(ctx, args[0], depth + 1);
          const base = resolveValue(ctx, args[1], depth + 1);
          if (!rel.ok) return rel;
          if (!base.ok) return { ...base, head: base.head };
          try { return { ok: true, value: new URL(String(rel.value), String(base.value)).href }; } catch { return { ok: false, reason: 'unparseable URL' }; }
        }
      }
      if (JOINERS.has(d.callee) && args.length) {
        let base;
        let first = 0;
        const r0 = resolveValue(ctx, args[0], depth + 1);
        const parts = [];
        if (r0.ok && (r0.base || r0.special)) { base = r0.base; parts.push(r0.value); first = 1; }
        else if (!r0.ok && (args[0].type === 'ident' || args[0].type === 'member' || args[0].type === 'call')) { base = 'unknown'; first = 1; }
        for (const a of args.slice(first)) {
          const r = resolveValue(ctx, a, depth + 1);
          if (!r.ok || r.base || r.special) return { ok: false, reason: 'computed path segment' };
          parts.push(String(r.value));
        }
        const kept = parts.filter((p) => p !== '');
        const value = kept.length ? normalize(join(...kept)).replace(/^\.$/, '') : '';
        return base ? { ok: true, value, base } : { ok: true, value };
      }
      return { ok: false, reason: `computed ${d.callee}()` };
    }
    default: return { ok: false, reason: 'computed expression' };
  }
}

/** Candidate repo paths for a resolved path value, most specific first; outside the repo dropped. */
export function pathCandidates(modulePath, r) {
  const mod = (v) => normalize(join(dirname(modulePath), v));
  const root = (v) => normalize(v).replace(/^\.\//, '');
  const v = String(r.value);
  if (r.fileOfModule) return [modulePath];
  let out;
  if (r.base === 'module') out = [mod(v)];
  else if (r.base === 'root') out = [root(v)];
  else if (r.base === 'unknown') out = [mod(v), root(v)];
  else out = /^\.\.?\//.test(v) ? [mod(v), root(v)] : [root(v), mod(v)];
  return [...new Set(out)].filter((p) => p && p !== '.' && !p.startsWith('..') && !p.startsWith('/'));
}

// ── endpoints ───────────────────────────────────────────────────────────────────────────────────

const URL_SCHEMES = new Set(['http', 'https', 'ws', 'wss']);

/** A URL string -> endpoint key, or { reason } when it names no host. */
export function endpointKey(v) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)/i.exec(String(v));
  if (!m) return { reason: String(v).startsWith('/') ? 'relative URL (no host)' : 'not a URL' };
  const scheme = m[1].toLowerCase();
  if (!URL_SCHEMES.has(scheme)) return { reason: `unsupported scheme ${scheme}` };
  try {
    const u = new URL(v);
    return { key: `${scheme}://${u.hostname}${u.port ? `:${u.port}` : ''}` };
  } catch {
    return { reason: 'unparseable URL' };
  }
}

/**
 * The partial head of a computed URL tells whether the HOST is known: `https://api.x.dev/${p}`
 * names a host, `https://${h}/` and `http://127.0.0.1:${port}` do not name a whole endpoint.
 */
export function endpointFromHead(head) {
  const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#:]+)(?::(\d+))?([/?#])/i.exec(String(head || ''));
  if (!m) {
    if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:$/i.test(String(head || ''))) return { reason: 'computed port' };
    return { reason: /^[a-z][a-z0-9+.-]*:\/\//i.test(String(head || '')) ? 'computed host' : 'computed URL' };
  }
  return endpointKey(`${m[1]}://${m[2]}${m[3] ? `:${m[3]}` : ''}/`);
}

function urlEndpoint(ctx, d) {
  const r = resolveValue(ctx, d);
  if (r.ok && typeof r.value === 'string' && !r.base) return endpointKey(r.value);
  if (!r.ok && r.head !== undefined) return endpointFromHead(r.head);
  return { reason: r.ok ? 'not a URL' : r.reason };
}

function hostEndpoint(ctx, scheme, props) {
  const hostD = props.get('hostname') || props.get('host');
  const host = hostD ? resolveValue(ctx, hostD) : { ok: true, value: 'localhost' };
  if (!host.ok || typeof host.value !== 'string') return { reason: 'computed host' };
  const portD = props.get('port');
  const port = portD ? resolveValue(ctx, portD) : { ok: true, value: '' };
  if (!port.ok) return { reason: 'computed port' };
  const protoD = props.get('protocol');
  const proto = protoD ? resolveValue(ctx, protoD) : { ok: true, value: scheme };
  if (!proto.ok) return { reason: 'computed protocol' };
  return { key: `${String(proto.value).replace(/:$/, '')}://${host.value}${port.value !== '' ? `:${port.value}` : ''}` };
}

const CONNECT_RE = /(?<![\w$.])(fetch|(?:https?|http2)\.(?:request|get|connect)|(?:net|tls)\.(?:connect|createConnection)|new\s+(?:WebSocket|EventSource))\s*\(/g;

/**
 * -> { edges, sites } — outbound connections and listening servers.
 * Every site that cannot name its endpoint becomes a `sites` entry, never an edge to a placeholder.
 */
export function extractEndpoints(ctx, { httpNamed = new Map(), serverish = false, line }) {
  const edges = [];
  const sites = [];
  const at = (i) => `${ctx.path}:${line(i)}`;
  const calls = [...ctx.masked.matchAll(CONNECT_RE)].map((m) => ({ index: m.index, name: m[1].replace(/\s+/, ' '), open: m.index + m[0].length - 1 }));
  for (const m of ctx.masked.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const imported = httpNamed.get(m[1]);
    if (imported === 'request' || imported === 'get') calls.push({ index: m.index, name: m[1], open: m.index + m[0].length - 1 });
  }
  for (const c of calls.sort((a, b) => a.index - b.index)) {
    const args = argsOf(ctx, c.open);
    let r;
    if (!args.length) r = { reason: 'no target' };
    else if (/^(?:net|tls)\./.test(c.name)) {
      const scheme = c.name.startsWith('tls') ? 'tls' : 'tcp';
      if (args[0].type === 'object') r = hostEndpoint(ctx, scheme, objectProps(ctx, args[0].open));
      else {
        const p = resolveValue(ctx, args[0]);
        if (p.ok && typeof p.value === 'string' && !/^\d+$/.test(p.value)) r = { reason: 'IPC path, not a network endpoint' };
        else {
          const props = new Map([['port', args[0]]]);
          if (args[1] && args[1].type !== 'other' && args[1].type !== 'call') props.set('host', args[1]);
          r = hostEndpoint(ctx, scheme, props);
        }
      }
    } else if (args[0].type === 'object') {
      r = hostEndpoint(ctx, /^https|^http2/.test(c.name) ? 'https' : 'http', objectProps(ctx, args[0].open));
    } else r = urlEndpoint(ctx, args[0]);
    const how = c.name.replace(/^new /, '');
    if (r.key) edges.push({ kind: 'connects', targetKind: 'endpoint', target: r.key, evidence: `${at(c.index)} ${how}` });
    else sites.push({ at: at(c.index), kind: 'connects', call: how, reason: r.reason });
  }
  if (serverish) {
    for (const m of ctx.masked.matchAll(/\.\s*listen\s*\(/g)) {
      const open = m.index + m[0].length - 1;
      const args = argsOf(ctx, open);
      let port = 'unknown';
      const d = args[0] && args[0].type === 'object' ? objectProps(ctx, args[0].open).get('port') : args[0];
      const r = d ? resolveValue(ctx, d) : { ok: false };
      if (r.ok && /^\d+$/.test(String(r.value))) port = String(r.value);
      edges.push({ kind: 'listens', targetKind: 'endpoint', target: `listen:${port}`, evidence: `${at(m.index)} listen` });
    }
  }
  return { edges, sites };
}

// ── databases ───────────────────────────────────────────────────────────────────────────────────

const SQL_HEAD_RE = /^\s*(?:--[^\n]*\n\s*)*(SELECT|WITH|INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK|END|SAVEPOINT|RELEASE|VACUUM|ANALYZE|ATTACH|DETACH|REINDEX|EXPLAIN)\b/i;
const NAME = '((?:"[^"]+"|`[^`]+`|\\[[^\\]]+\\]|[\\w$.]+))';
const unq = (t) => t.replace(/^["`[]|["`\]]$/g, '');

/** Does this string open with an SQL statement verb? */
export function looksLikeSql(v) {
  return typeof v === 'string' && SQL_HEAD_RE.test(v);
}

/** SQL text -> { reads:[tables], writes:[tables], readVerbs:[…], writeVerbs:[…] }. */
export function sqlEffects(sql) {
  const reads = new Set();
  const writes = new Set();
  const readVerbs = new Set();
  const writeVerbs = new Set();
  const text = String(sql).replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const add = (set, t) => { if (t && !/^__expr__$/.test(t) && !/^\(/.test(t)) set.add(unq(t)); };
  const fromTables = (stmt, set) => {
    for (const m of stmt.matchAll(new RegExp(`\\b(?:FROM|JOIN)\\s+${NAME}`, 'gi'))) {
      if (!/^select$/i.test(m[1])) add(set, m[1]);
    }
  };
  for (const raw of text.split(';')) {
    const stmt = raw.trim();
    if (!stmt) continue;
    const verb = stmt.split(/\s+/)[0].toUpperCase();
    const w = (re) => { const m = new RegExp(re, 'i').exec(stmt); if (m) add(writes, m[1]); };
    switch (verb) {
      case 'SELECT': readVerbs.add(verb); fromTables(stmt, reads); break;
      case 'WITH': {
        const dml = /\b(INSERT|UPDATE|DELETE|REPLACE)\b/i.exec(stmt);
        if (dml) {
          writeVerbs.add(dml[1].toUpperCase());
          w(`\\b(?:INSERT|REPLACE)(?:\\s+OR\\s+\\w+)?\\s+INTO\\s+${NAME}`);
          w(`\\bUPDATE(?:\\s+OR\\s+\\w+)?\\s+${NAME}`);
          w(`\\bDELETE\\s+FROM\\s+${NAME}`);
        }
        readVerbs.add('SELECT');
        fromTables(stmt.replace(/\bDELETE\s+FROM\b/gi, ' '), reads);
        break;
      }
      case 'INSERT': case 'REPLACE':
        writeVerbs.add(verb);
        w(`^(?:INSERT|REPLACE)(?:\\s+OR\\s+\\w+)?\\s+INTO\\s+${NAME}`);
        if (/\bSELECT\b/i.test(stmt)) { readVerbs.add('SELECT'); fromTables(stmt, reads); }
        break;
      case 'UPDATE': writeVerbs.add(verb); w(`^UPDATE(?:\\s+OR\\s+\\w+)?\\s+${NAME}`); break;
      case 'DELETE': writeVerbs.add(verb); w(`^DELETE\\s+FROM\\s+${NAME}`); break;
      case 'CREATE':
        writeVerbs.add(verb);
        if (/^CREATE\s+(?:UNIQUE\s+)?INDEX/i.test(stmt)) w(`\\bON\\s+${NAME}`);
        else w(`^CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?(?:VIRTUAL\\s+)?(?:TABLE|VIEW|TRIGGER)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`);
        break;
      case 'DROP': writeVerbs.add(verb); w(`^DROP\\s+(?:TABLE|VIEW|INDEX|TRIGGER)\\s+(?:IF\\s+EXISTS\\s+)?${NAME}`); break;
      case 'ALTER': writeVerbs.add(verb); w(`^ALTER\\s+TABLE\\s+${NAME}`); break;
      default: break;                                 // transaction control, PRAGMA: neither
    }
  }
  return { reads: [...reads].sort(), writes: [...writes].sort(), readVerbs: [...readVerbs], writeVerbs: [...writeVerbs] };
}

/** SQL text of a descriptor, with computed parts as `__expr__`, or null. */
export function sqlText(ctx, d) {
  if (!d) return null;
  if (d.type === 'string') return d.value;
  if (d.type === 'template') {
    if (d.parts.some((p) => 'lit' in p && p.lit === null)) return null;
    return d.parts.map((p) => ('lit' in p ? p.lit : ' __expr__ ')).join('');
  }
  if (d.type === 'ident') {
    const init = declInit(ctx, d.name);
    return init ? sqlText(ctx, exprAt(ctx, init.start, init.end)) : null;
  }
  return null;
}

/**
 * -> { edges, sites, consumed:Set<literal start> }.
 * Handles are `X = new DatabaseSync(path)` / `new Database(path)`; SQL is a literal handed to
 * .exec/.prepare (any receiver, when it reads as SQL) or .run/.all/.get/.iterate (a known handle).
 */
export function extractDatabases(ctx, { line }) {
  const edges = [];
  const sites = [];
  const consumed = new Set();
  const handles = [];
  const at = (i) => `${ctx.path}:${line(i)}`;
  for (const m of ctx.masked.matchAll(/(?<![\w$.])new\s+(DatabaseSync|Database)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = argsOf(ctx, open);
    const before = ctx.masked.slice(Math.max(0, m.index - 120), m.index);
    const bind = /(?:(?:const|let|var)\s+)?((?:this\.)?[\w$]+)\s*=\s*(?:await\s+)?$/.exec(before);
    const name = bind ? bind[1].replace(/^this\./, '') : null;
    const r = args.length ? resolveValue(ctx, args[0]) : { ok: false, reason: 'no path' };
    let key = null;
    if (r.ok && typeof r.value === 'string' && r.value) {
      if (r.value === ':memory:' || !r.base) key = r.value === ':memory:' ? r.value : normalise(r.value, ctx.path);
      else if (r.base !== 'unknown') key = pathCandidates(ctx.path, r)[0] || null;
    }
    if (key) {
      for (const a of args.slice(0, 1)) markConsumed(ctx, a, consumed);
    } else sites.push({ at: at(m.index), kind: 'database', call: `new ${m[1]}`, reason: r.ok ? 'database path joined onto an unknown directory' : `database path ${r.reason}` });
    handles.push({ name, key, index: m.index });
  }
  const handleFor = (name, index) => {
    const named = handles.filter((h) => h.name === name);
    if (!named.length) return undefined;
    return [...named].reverse().find((h) => h.index < index) || named[0];
  };
  for (const m of ctx.masked.matchAll(/(?<![\w$])([\w$]+)\s*\.\s*(exec|prepare|run|all|get|iterate)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const h = handleFor(m[1], m.index);
    if (!['exec', 'prepare'].includes(m[2]) && !h) continue;
    const args = argsOf(ctx, open);
    const sql = sqlText(ctx, args[0]);
    if (sql === null || !looksLikeSql(sql)) {
      if (h && ['exec', 'prepare'].includes(m[2])) sites.push({ at: at(m.index), kind: 'database', call: m[2], reason: 'computed SQL' });
      continue;
    }
    markConsumed(ctx, args[0], consumed);
    const fx = sqlEffects(sql);
    if (!fx.readVerbs.length && !fx.writeVerbs.length) continue;
    if (!h) { sites.push({ at: at(m.index), kind: 'database', call: m[2], reason: 'database handle not resolved' }); continue; }
    if (!h.key) { sites.push({ at: at(m.index), kind: 'database', call: m[2], reason: 'database path not resolved' }); continue; }
    if (fx.writeVerbs.length) {
      edges.push({ kind: 'writes', targetKind: 'database', target: h.key, tables: fx.writes,
        evidence: `${at(m.index)} ${m[2]} ${fx.writeVerbs.join('+')}${fx.writes.length ? ` ${fx.writes.join(',')}` : ''}` });
    }
    if (fx.readVerbs.length) {
      edges.push({ kind: 'reads', targetKind: 'database', target: h.key, tables: fx.reads,
        evidence: `${at(m.index)} ${m[2]} ${fx.readVerbs.join('+')}${fx.reads.length ? ` ${fx.reads.join(',')}` : ''}` });
    }
  }
  return { edges, sites, consumed };
}

/** Every literal a descriptor stands on (through const bindings), so path extraction skips them. */
function markConsumed(ctx, d, set, depth = 0) {
  if (!d || depth > 6) return;
  if (d.type === 'string' || d.type === 'template') set.add(d.at);
  if (d.type === 'ident') {
    const init = declInit(ctx, d.name);
    if (init) markConsumed(ctx, exprAt(ctx, init.start, init.end), set, depth + 1);
  }
  if (d.type === 'call') for (const a of argsOf(ctx, d.open)) markConsumed(ctx, a, set, depth + 1);
}

// ── spawned node scripts ────────────────────────────────────────────────────────────────────────

const NODE_SPAWN_RE = /(?<![\w$])(?:([\w$]+)\s*\.\s*)?(spawnSync|spawn|execFileSync|execFile)\s*\(/g;

/**
 * -> { byLiteral:Map<literal start, info>, execPath:[{index, verb, info}], sites }
 * info: { candidates:[repo paths] } for `spawn('node' | process.execPath, [script, …])`.
 * Leading `-flags` are skipped: the script is the first argv element that is not an option.
 */
export function nodeSpawns(ctx, { cpNamespaces = new Set(), line }) {
  const byLiteral = new Map();
  const execPath = [];
  const sites = [];
  for (const m of ctx.masked.matchAll(NODE_SPAWN_RE)) {
    if (m[1] && !cpNamespaces.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const args = argsOf(ctx, open);
    if (!args.length) continue;
    const target = resolveValue(ctx, args[0]);
    if (!target.ok || target.value !== 'node') continue;
    let info = { candidates: [] };
    const arr = args[1] && args[1].type === 'array' ? argsOf(ctx, args[1].open) : null;
    if (!arr) info = { candidates: [], reason: 'argv not an array literal' };
    else {
      let picked = null;
      for (const el of arr) {
        if (el.type === 'other' && /^\.\.\./.test(el.text)) { picked = { ok: false, reason: 'spread argv' }; break; }
        const r = resolveValue(ctx, el);
        if (r.ok && typeof r.value === 'string' && r.value.startsWith('-') && !r.base) continue;
        picked = r;
        break;
      }
      if (!picked) info = { candidates: [], reason: 'no script argument' };
      else if (!picked.ok || typeof picked.value !== 'string') info = { candidates: [], reason: `script ${picked.reason || 'not a path'}` };
      else info = { candidates: pathCandidates(ctx.path, picked) };
    }
    if (!info.candidates.length) sites.push({ at: `${ctx.path}:${line(m.index)}`, kind: 'spawns', call: m[2], reason: info.reason || 'script outside the repository' });
    if (args[0].type === 'string') byLiteral.set(args[0].at, info);
    else execPath.push({ index: m.index, verb: m[2], info });
  }
  return { byLiteral, execPath, sites };
}

// ── append / tail ───────────────────────────────────────────────────────────────────────────────

/** name -> [{verb, index}] for every `verb(name` call. */
export function argUses(masked) {
  const out = new Map();
  for (const m of masked.matchAll(/\b([\w$]+)\s*\(\s*([\w$]+)\s*[,)]/g)) {
    if (!out.has(m[2])) out.set(m[2], []);
    out.get(m[2]).push({ verb: m[1], index: m.index });
  }
  return out;
}

/** Does the call of `verb` at `index` carry `flags: 'a'` (or 'a+')? */
export function appendFlag(ctx, index) {
  const open = ctx.masked.indexOf('(', index);
  const close = open === -1 ? -1 : matchBracket(ctx.masked, open);
  if (close === -1) return false;
  return ctx.spans.some((s) => s.start > open && s.end <= close && s.kind === 'string' && /^a\+?$/.test(s.value || '')
    && /\bflags\s*:\s*$/.test(ctx.masked.slice(Math.max(0, s.start - 20), s.start)));
}

/** -> { append?:true } | { tail?:true } for a use of a path at `index` by `verb`. */
export function streamMarks(ctx, verb, index, role, pollRanges) {
  if (role === 'writes') {
    if (APPEND_VERBS.includes(verb) || (verb === 'createWriteStream' && appendFlag(ctx, index))) return { append: true };
    return {};
  }
  if (role === 'reads') {
    if (TAIL_VERBS.includes(verb)) return { tail: true };
    if (inRanges(pollRanges, index)) return { tail: true };
  }
  return {};
}

/**
 * -> a per-module record. `state` is the grey carrier: only 'analysed' contributes edges, and the
 * other three are named rather than dropped.
 */
/** The first goal V8 accepts the source under, with its parse; the last refusal when none does. */
async function parseUnder(goals, src, path) {
  let parsed;
  for (const goal of goals) {
    parsed = await parseModule(src, path, { goal });
    if (parsed.ok) return { goal, parsed };
  }
  return { goal: goals[goals.length - 1], parsed };
}

export async function analyseSource(path, original, { strip } = {}) {
  const ext = extname(path).toLowerCase();
  const typed = TS_EXTS.has(ext);
  const base = { v: SCHEMA_VERSION, path, edges: [], envKeys: [], literals: 0, witness: {},
    ...(ext === '.mjs' ? {} : { lang: typed ? 'typescript' : 'javascript' }) };

  let src = original;
  if (typed) {
    const t = stripTypes(original, path, strip);
    if (!t.ok) return { ...base, state: t.state, reason: t.reason };
    src = t.code;
  }
  const { goal, parsed } = await parseUnder(GOALS[ext] || ['module', 'commonjs'], src, path);
  if (!parsed.ok) {
    // V8 has no JSX: a .jsx/.tsx file it refuses is in a language this pass does not read
    if (JSX_EXTS.has(ext)) return { ...base, state: 'unsupported-language', reason: `JSX: V8 parses no JSX and no transform ships (${parsed.error})` };
    return { ...base, state: 'unparseable', reason: parsed.error };
  }
  if (goal !== 'module') base.goal = goal;

  const lex = classify(src);
  if (!lex.ok) return { ...base, state: 'lexer-bailed', reason: lex.reason };

  const mask = await maskConsistent(src, lex.spans, path, { goal });
  if (!mask.ok) return { ...base, state: 'mask-inconsistent', reason: mask.error };

  const { masked } = maskFrom(src, lex.spans);   // the SAME rewrite V8 just accepted, not a copy of it
  const specifiers = parsed.specifiers;
  const specSet = new Set(specifiers);
  const line = lex.lineOf;

  // W2 false-negative direction: every static specifier V8 names must be a literal the lexer found.
  const coverage = specifierCoverage(specifiers, lex.spans);

  const edges = [];
  const envKeys = new Map();
  const argsUsedAs = argRoles(masked);
  const uses = argUses(masked);

  // ── endpoints, databases, node scripts, timers — every one read off the same masked rewrite
  const ctx = valueContext(path, masked, lex.spans);
  const cp = importedNames(masked, lex.spans, CP_MODULES);
  const fsI = importedNames(masked, lex.spans, FS_MODULES);
  const httpI = importedNames(masked, lex.spans, HTTP_MODULES);
  const cpNamespaces = new Set([...cp.namespaces, 'child_process']);
  const serverish = httpI.namespaces.size > 0 || httpI.named.size > 0 || /\bcreateServer\s*\(/.test(masked);
  const sites = [];
  const ep = extractEndpoints(ctx, { httpNamed: httpI.named, serverish, line });
  const db = extractDatabases(ctx, { line });
  const ns = nodeSpawns(ctx, { cpNamespaces, line });
  const timing = timerSites(masked, { fsNamespaces: new Set([...fsI.namespaces, 'fs', 'fsp']), fsNamed: fsI.named });
  edges.push(...ep.edges, ...db.edges);
  sites.push(...ep.sites, ...db.sites, ...ns.sites);
  for (const x of ns.execPath) {
    edges.push({ kind: 'spawns', targetKind: 'process', target: 'node', evidence: `${path}:${line(x.index)} ${x.verb}`,
      ...(x.info.candidates.length ? { scriptCandidates: x.info.candidates } : {}) });
  }

  // ── module -> module, from V8 (exact for static imports; dynamic ones come from the lexer below)
  for (const spec of specifiers) {
    if (!/^\.\.?\//.test(spec)) continue;
    edges.push({ kind: 'reads', targetKind: 'module', target: resolveSpec(path, spec), evidence: `${path} static-import` });
  }

  // ── literals
  const strings = lex.spans.filter((s) => (s.kind === 'string' || (s.kind === 'template' && !s.interpolated)) && s.value !== null);
  for (const sp of strings) {
    const v = sp.value;
    const at = `${path}:${line(sp.start)}`;

    if (v.startsWith('CW_') && /^CW_[A-Z0-9_]+$/.test(v) && /\benv\s*\[\s*$/.test(masked.slice(Math.max(0, sp.start - 40), sp.start))) {
      envKeys.set(v, { key: v, evidence: `${at} env-bracket`, suspectedLoadTime: false });
      continue;
    }

    if (db.consumed.has(sp.start)) continue;           // a database path or SQL text, extracted above
    // In a CommonJS file, require('./x') is the import: invisible to V8, which names no specifier
    // for a script, and to looksLikePath, an extensionless specifier being no path.
    if (goal === 'commonjs' && /^\.\.?\//.test(v) && /(?<![\w$.])require\s*\(\s*$/.test(masked.slice(Math.max(0, sp.start - 20), sp.start))) {
      edges.push({ kind: 'reads', targetKind: 'module', target: resolveSpec(path, v), evidence: `${at} require` });
      continue;
    }
    const { verb, role } = verbBefore(masked, sp.start, 260, { cpNamespaces });
    if (role === 'not-spawn') continue;

    if (role === 'spawn-target') {
      const info = ns.byLiteral.get(sp.start);
      edges.push({ kind: 'spawns', targetKind: 'process', target: v, evidence: `${at} ${verb}`,
        ...(info && info.candidates.length ? { scriptCandidates: info.candidates } : {}) });
      continue;
    }
    if (!looksLikePath(v)) continue;
    if (specSet.has(v)) continue;                       // already emitted as a module edge

    // A relative specifier under a dynamic import is a module edge; V8 does not report those.
    if (/^\.\.?\//.test(v) && /\bimport\s*\(\s*$/.test(masked.slice(Math.max(0, sp.start - 20), sp.start))) {
      edges.push({ kind: 'reads', targetKind: 'module', target: resolveSpec(path, v), evidence: `${at} dynamic-import` });
      continue;
    }


    const target = normalise(v, path);
    // `composed: true` — a bare filename is a NAME, not a location. It is almost always joined with
    // a directory elsewhere, so several real files collapse onto one node. C4 must not read such a
    // node as one artifact.
    const composed = !v.includes('/');

    const extras = () => (role === 'reads' || role === 'unknown'
      ? { fallback: fallbackNear(masked, sp.start), freshness: freshnessNear(masked, sp.start) }
      : {});

    if (role !== 'unknown') {
      const marks = streamMarks(ctx, verb, Math.max(0, masked.lastIndexOf(verb, sp.start)), role, timing.pollRanges);
      edges.push({ kind: role, targetKind: 'artifact', target, composed, evidence: `${at} ${verb}`, directionWitness: 'lookback', ...extras(), ...marks });
      continue;
    }
    const bound = bindingName(src, masked, sp.start);
    const roles = bound ? argsUsedAs.get(bound) : null;
    if (roles && roles.size) {
      for (const r of roles) {
        const marks = {};
        for (const u of uses.get(bound) || []) {
          const ur = READ_VERBS.includes(u.verb) ? 'reads' : WRITE_VERBS.includes(u.verb) ? 'writes' : null;
          if (ur === r) Object.assign(marks, streamMarks(ctx, u.verb, u.index, r, timing.pollRanges));
        }
        edges.push({ kind: r, targetKind: 'artifact', target, composed, evidence: `${at} ${bound} -> ${r}`, directionWitness: 'binding', ...(r === 'reads' ? extras() : {}), ...marks });
      }
      continue;
    }
    edges.push({ kind: 'touches', targetKind: 'artifact', target, composed, evidence: `${at} literal`, directionWitness: 'none' });
  }

  // ── CW_* env keys, from the masked source so a key named in a comment is not a read
  for (const m of masked.matchAll(ENV_DOT_RE)) {
    const lineText = lineTextAt(masked, m.index);
    const prev = envKeys.get(m[1]);
    const loadTime = ENV_LOADTIME_RE.test(lineText);
    if (!prev || (loadTime && !prev.suspectedLoadTime)) {
      envKeys.set(m[1], { key: m[1], evidence: `${path}:${line(m.index)} env-dot`, suspectedLoadTime: loadTime });
    }
  }

  // ── W3: path-shaped raw runs the lexer neither emitted nor placed inside any span
  const covered = (off) => lex.spans.some((s) => off >= s.start && off < s.end);
  const inComment = (off) => lex.spans.some((s) => (s.kind === 'line' || s.kind === 'block') && off >= s.start && off < s.end);
  const unaccounted = [];
  let commentPaths = 0;
  for (const run of rawQuotedRuns(src)) {
    if (!looksLikePath(run.value)) continue;
    const at = run.start + 1;
    if (inComment(at)) { commentPaths += 1; continue; }
    if (!covered(at)) unaccounted.push({ value: run.value, line: line(at) });
  }

  return {
    ...base,
    state: 'analysed',
    reason: null,
    literals: strings.length,
    // What C1 could POSSIBLY have claimed about this module. C3 needs it to tell a hole in the
    // literal extraction from a path that was never a literal at all (a directory walk, a join of
    // variables, an argv value). Without the distinction, tracing one recursive walk reports two
    // thousand false negatives and the instrument becomes the crisis it is measuring.
    pathLiterals: [...new Set(strings.map((s) => s.value).filter(looksLikePath))],
    edges,
    envKeys: [...envKeys.values()],
    // A call site whose endpoint, database, SQL or script cannot be named. Reported, never an edge
    // to a placeholder: an unnamed endpoint is unknown, and unknown is never clean.
    sites,
    triggers: {
      timers: timing.timers.map((t) => ({ evidence: `${path}:${line(t.at)} ${t.how}` })),
      watches: timing.watches.map((t) => ({ evidence: `${path}:${line(t.at)} ${t.how}` })),
    },
    witness: {
      v8Parse: 'ok',
      maskConsistent: 'ok',
      specifiersChecked: coverage.checked,
      specifiersMissing: coverage.missing,     // FALSE NEGATIVE, V8-sourced
      unaccounted,                             // FALSE NEGATIVE, W3-sourced
      pathsInComments: commentPaths,           // informational: explained, not emitted
    },
  };
}

function lineTextAt(s, at) {
  const from = s.lastIndexOf('\n', at) + 1;
  const to = s.indexOf('\n', at);
  return s.slice(from, to === -1 ? s.length : to);
}

function resolveSpec(fromFile, spec) {
  const base = normalize(join(dirname(fromFile), spec));
  return /\.[a-z]+$/i.test(base) ? base : `${base}.mjs`;
}

// A relative artifact path is relative to the MODULE, not to the repo root. Unresolved,
// `../area.mjs` read by monitor/test/freshness.test.mjs becomes its own node with no producer, and
// C4 reports a dead dependency on a file that is right there.
function normalise(p, fromFile) {
  if (/^\.\.?\//.test(p) && fromFile) return normalize(join(dirname(fromFile), p));
  return normalize(p).replace(/^\.\//, '');
}

/** A test module's fixtures are not repo artifacts. Kept, bucketed, never headline. */
export function isTestModule(p) {
  return /(^|\/)test\//.test(p) || /\.test\.[cm]?js$/.test(p) || /(^|\/)fixtures\//.test(p);
}

/** Is `root` this checkout? Only then do commitwork's own readers (the launchd generator) run. */
export function isSelf(root) {
  const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };
  return real(root) === real(repoRoot());
}

const MODULE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
/**
 * A relative import's target as a tracked file: as written; else, for TypeScript's `./x.js` that
 * names `./x.ts`, and for an extensionless specifier (resolveSpec gave it `.mjs`), the same stem
 * with each source extension, then `<stem>/index.<ext>`. Unresolved: as written, so the edge still
 * names what the source said.
 */
export function resolveTracked(target, tracked) {
  if (tracked.has(target)) return target;
  const stem = target.replace(/\.(?:mjs|cjs|js|jsx)$/, '');
  for (const c of [...MODULE_EXTS.map((e) => `${stem}${e}`), ...MODULE_EXTS.map((e) => `${stem}/index${e}`)]) if (tracked.has(c)) return c;
  return target;
}

/**
 * -> { nodes, edges, modules, summary }. Coverage is asserted over the file set, not the edges.
 *
 * `root` is any git checkout; `files` the sources to read (default: this checkout's tracked .mjs, or
 * targetSources() of another). `self` (default: is `root` this checkout) gates the readers that
 * know commitwork's own tree: for any other root the launchd generator is never imported, because
 * importing it runs its top level, and a target's code is never executed. `unsupported` counts the
 * tracked files in languages this pass does not read, by language.
 */
export async function analyseRepo({ root, files, env = process.env, triggers = {}, self, unsupported = {}, strip } = {}) {
  const repo = root || repoRoot();
  const own = self ?? isSelf(repo);
  const list = files || (own ? trackedSources(repo) : targetSources(repo).sources);
  const modules = [];
  for (const f of list) {
    let src;
    try {
      const size = statSync(join(repo, f)).size;
      if (size > MAX_SOURCE_BYTES) {
        modules.push({ v: SCHEMA_VERSION, path: f, state: 'too-large', reason: `${size} bytes is over ${MAX_SOURCE_BYTES}: a bundle, not read`, edges: [], envKeys: [], witness: {} });
        continue;
      }
      src = readFileSync(join(repo, f), 'utf8');
    } catch (e) {
      modules.push({ v: SCHEMA_VERSION, path: f, state: 'unreadable', reason: e.code || e.message, edges: [], envKeys: [], witness: {} });
      continue;
    }
    modules.push(await analyseSource(f, src, { strip }));
  }

  const analysed = modules.filter((m) => m.state === 'analysed');
  const raw = analysed.flatMap((m) => m.edges.map((e) => ({ ...e, from: m.path })));
  const artifactPaths = [...new Set(raw.filter((e) => e.targetKind === 'artifact').map((e) => e.target))];
  const kinds = artifactKinds(artifactPaths, raw.filter((e) => e.targetKind === 'artifact'));

  const nodes = new Map();
  const put = (kind, key, extra) => {
    const id = nodeId(kind, key);
    if (!nodes.has(id)) nodes.set(id, makeNode(kind, key, extra));
    return id;
  };
  for (const m of modules) put('module', m.path, { analysis: m.state });
  const tracked = new Set(list);
  for (const e of raw) if (e.targetKind === 'module') e.target = resolveTracked(e.target, tracked);

  const edges = [];
  for (const e of raw) {
    const from = nodeId('module', e.from);
    const to = e.targetKind === 'artifact'
      ? put(kinds.get(e.target) || 'artifact', e.target, { composed: !e.target.includes('/') })
      : put(e.targetKind, e.target, e.target === 'listen:unknown' ? { unknown: true } : undefined);
    // A node script resolves to the first candidate that is a tracked module; failing that the
    // most specific candidate is still recorded, and no module edge is invented for it.
    const script = e.scriptCandidates ? (e.scriptCandidates.find((c) => tracked.has(c)) || e.scriptCandidates[0]) : null;
    edges.push(makeEdge(from, to, e.kind, {
      witness: 'static', existence: 'unknown', evidence: e.evidence,
      ...(e.directionWitness ? { directionWitness: e.directionWitness } : {}),
      ...(e.fallback ? { fallback: e.fallback } : {}),
      ...(e.freshness ? { freshness: e.freshness } : {}),
      ...(e.tables ? { tables: e.tables } : {}),
      ...(e.append ? { append: true } : {}),
      ...(e.tail ? { tail: true } : {}),
      ...(script ? { script, scripts: [script] } : {}),
    }));
    if (script && tracked.has(script)) {
      edges.push(makeEdge(from, nodeId('module', script), 'spawns', { witness: 'static', existence: 'unknown', evidence: e.evidence, script }));
    }
  }

  // ── triggers: scheduler -> module
  const trig = analyseTriggers({ root: repo, files: list, modules, env, self: own, lsFiles: () => lsFiles(repo), ...triggers });
  for (const t of trig.schedulers) {
    const sid = put('scheduler', t.key, t.extra);
    for (const x of t.targets) edges.push(makeEdge(sid, nodeId('module', x.module), 'triggers', { witness: 'static', existence: 'unknown', evidence: x.evidence }));
  }
  const siteList = [
    ...analysed.flatMap((m) => m.sites || []),
    ...trig.sites,
  ];
  for (const m of analysed) {
    for (const k of m.envKeys) {
      const to = put('env', k.key);
      edges.push(makeEdge(nodeId('module', m.path), to, 'reads', {
        witness: 'static', existence: 'unknown', evidence: k.evidence,
        ...(k.suspectedLoadTime ? { suspectedLoadTime: true } : {}),
      }));
    }
  }

  const unanalysable = modules.filter((m) => m.state !== 'analysed');
  const merged = mergeEdges(edges);
  const nodeList = [...nodes.values()];
  return {
    v: SCHEMA_VERSION,
    generatedAt: now(env),
    root: repo,
    nodes: nodeList,
    edges: merged,
    modules,
    summary: {
      filesInput: list.length,
      analysed: analysed.length,
      unanalysable: unanalysable.length,
      unanalysableByReason: countBy(unanalysable, (m) => m.state),
      coverageAccountsForAll: analysed.length + unanalysable.length === list.length,
      ...(own ? {} : { self: false, byLanguage: countBy(modules, (m) => m.lang || 'javascript'), unsupportedLanguages: { ...unsupported } }),
      nodesByKind: countBy(nodeList, (n) => n.kind),
      edgesByKind: countBy(merged, (e) => e.kind),
      // call sites inside ANALYSED modules whose endpoint / database / SQL / script / trigger target
      // could not be named. Separate from the module-level count above, and never folded into it.
      unanalysableSites: siteList.length,
      unanalysableSitesByKind: countBy(siteList, (x) => `${x.kind}: ${siteCategory(x.reason)}`),
      sites: siteList.map((x) => `${x.at} ${x.kind}${x.call ? ` ${x.call}` : ''}: ${x.reason}`),
      // false negatives, reported SEPARATELY from the false-positive floor above
      falseNegative: {
        specifiersMissing: analysed.flatMap((m) => m.witness.specifiersMissing.map((s) => `${m.path} -> ${s}`)),
        unaccounted: analysed.flatMap((m) => m.witness.unaccounted.map((u) => `${m.path}:${u.line} ${u.value}`)),
      },
      falsePositiveFloor: {
        maskRejected: modules.filter((m) => m.state === 'mask-inconsistent').map((m) => m.path),
        lexerBailed: modules.filter((m) => m.state === 'lexer-bailed').map((m) => m.path),
      },
    },
  };
}

/** A site reason with its identifier taken out, so the summary counts kinds of failure. */
export function siteCategory(reason) {
  return String(reason).replace(/\bunresolved [\w$.]+/, 'unresolved binding').replace(/\bcomputed [\w$.]+\(\)/, 'computed call');
}

function countBy(xs, f) {
  const out = {};
  for (const x of xs) out[f(x)] = (out[f(x)] || 0) + 1;
  return out;
}

export function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

/** Tracked files matching `patterns` (all when empty). The one git call in C1. */
export function lsFiles(repo, patterns = []) {
  return execFileSync('git', ['-C', repo, 'ls-files', ...patterns], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] })
    .split('\n').filter(Boolean);
}

export function trackedSources(repo) {
  return lsFiles(repo, ['*.mjs']).filter((f) => !f.startsWith('.claude/'));
}

/**
 * Another repository's tracked JS/TS sources -> { sources, unsupported: { language: files } }.
 * Vendored trees (node_modules/) are not the repository's code and are left out; every other
 * tracked file is either a source or, when its extension names another language, counted.
 */
export function targetSources(repo) {
  const sources = [];
  const unsupported = {};
  for (const f of lsFiles(repo)) {
    if (/(^|\/)node_modules\//.test(f)) continue;
    if (isSourcePath(f)) { sources.push(f); continue; }
    const lang = languageOf(f);
    if (lang) unsupported[lang] = (unsupported[lang] || 0) + 1;
  }
  return { sources, unsupported };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const repo = repoRoot();
  const graph = await analyseRepo({ root: repo, env });
  const out = storePath('flow.json', env);
  writeJson(out, graph);
  const s = graph.summary;
  process.stdout.write([
    `flow/static: ${s.analysed}/${s.filesInput} modules analysed, ${s.unanalysable} unanalysable`,
    `  unanalysable: ${JSON.stringify(s.unanalysableByReason)}`,
    `  nodes ${graph.nodes.length}  edges ${graph.edges.length}`,
    `  nodes by kind ${JSON.stringify(s.nodesByKind)}`,
    `  edges by kind ${JSON.stringify(s.edgesByKind)}`,
    `  unanalysable sites ${s.unanalysableSites}`,
    `  FALSE NEGATIVE  specifiers missed ${s.falseNegative.specifiersMissing.length}  unaccounted path-runs ${s.falseNegative.unaccounted.length}`,
    `  FALSE POSITIVE FLOOR  mask rejected ${s.falsePositiveFloor.maskRejected.length}  lexer bailed ${s.falsePositiveFloor.lexerBailed.length}`,
    `  -> ${relative(repo, out)}`,
    '',
  ].join('\n'));
  return graph;
}

if (isMainModule(import.meta.url)) {
  const vm = await import('node:vm');
  if (typeof vm.SourceTextModule !== 'function') {
    const { spawnSync } = await import('node:child_process');
    const r = spawnSync(process.execPath, ['--experimental-vm-modules', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status ?? 1);
  }
  await main();
}
