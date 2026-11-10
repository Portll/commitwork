// bin/lib/release-terms.mjs — the denied-term check a release candidate must pass.
//
// The list names private things (internal tools, customer pseudonyms, the maintainer's own history),
// so it is a private record: the sidecar's committed copy, or CW_RELEASE_TERMS on disk. A tree with
// no list is cannot-check, never clean. Reports carry rule ids and term labels, never the matched
// text and never a term's own `why` or `test`, which name the private thing as plainly as the term.
//
// env: CW_RELEASE_TERMS (a list file; overrides the sidecar) · CW_SIDECAR · CW_RELEASE_NAMES_SIDECAR_REF
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidecarFor, sidecarRef } from './release-names-head-scan.mjs';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TERMS_REL = 'monitor/release-terms.json';
export const termsSchemaPath = () => resolve(REPO, 'schema', 'release-terms.schema.json');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- every glob part is escaped; only * and ** become [^/]* and .*
const globRe = (g) => new RegExp(`^${g.split('**').map((part) => part.split('*').map(escapeRe).join('[^/]*')).join('.*')}$`);

/**
 * Rules from a parsed list. Throws, naming the rule, on anything a gate could misread.
 *
 * A term's label is `<rule>#<key>` and the key is the term's own, never its position in the array:
 * a label is what a report, a review and a narrowing are keyed on, and a positional one turns an
 * edit anywhere in the list into a relabelling of every term after it.
 *
 * A rule's `removed` entries are a register, never a detector. A term withdrawn or narrowed leaves
 * the measurement that decided it where the next reader meets the term; a report of the removal
 * alone leaves nothing behind. Nothing here reads them, and a rule whose only entries are removed
 * ones has no words and no patterns and refuses.
 */
export function compileTerms(doc, source = 'list') {
  const v = validateAgainstSchema(doc, { path: termsSchemaPath() });
  if (v.errors.length) throw new Error(`${source}: ${v.errors[0]}`);
  const seen = new Set();
  const rules = doc.rules.map((r) => {
    if (seen.has(r.id)) throw new Error(`${source}: rule id '${r.id}' is declared twice`);
    seen.add(r.id);
    const flags = r.caseSensitive ? 'g' : 'gi';
    const declared = [
      ...(r.words || []).map((w) => ({ ...w, kind: 'word', src: `(?<![A-Za-z0-9_])${escapeRe(w.word)}(?![A-Za-z0-9_])` })),
      ...(r.patterns || []).map((p) => ({ ...p, kind: 'pattern', src: p.pattern })),
    ];
    if (!declared.length) throw new Error(`${source}: rule '${r.id}' has no words and no patterns`);
    const keys = new Set(), texts = new Map();
    const terms = declared.map((t) => {
      if (keys.has(t.key)) throw new Error(`${source}: rule '${r.id}' declares the key '${t.key}' twice`);
      keys.add(t.key);
      // uniqueItems compares whole objects, so two terms with the same word and different prose are
      // distinct items and one detector counted twice. The text is the identity; the key labels it.
      const text = `${t.kind}:${t.kind === 'word' ? t.word.toLowerCase() : t.pattern}`;
      if (texts.has(text)) throw new Error(`${source}: rule '${r.id}' terms '${texts.get(text)}' and '${t.key}' declare the same ${t.kind}`);
      texts.set(text, t.key);
      let re;
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- src is an escaped word or a pattern the schema-checked terms file declares; an invalid one throws
      try { re = new RegExp(t.src, flags); }
      catch (e) { throw new Error(`${source}: rule '${r.id}' term '${t.key}' is not a valid pattern (${e.message})`); }
      // A pattern that matches nothing at all would count every position of every file.
      if (re.test('')) throw new Error(`${source}: rule '${r.id}' term '${t.key}' matches the empty string`);
      return { label: `${r.id}#${t.key}`, key: t.key, re, why: t.why, test: t.test,
        measured: t.measured || null, except: (t.exceptPaths || []).map((x) => ({ path: x.path, count: x.count })) };
    });
    return { id: r.id, why: r.why, terms, except: (r.exceptPaths || []).map((g) => ({ glob: g, re: globRe(g) })) };
  });
  // A label goes where the term itself never does, so it has to survive this same detector: a key
  // that any term in the list matches would put the private thing in every report that names it.
  for (const rule of rules) {
    for (const term of rule.terms) {
      for (const other of rules) {
        for (const o of other.terms) {
          o.re.lastIndex = 0;
          if (!o.re.test(term.label)) continue;
          throw new Error(`${source}: rule '${rule.id}' term '${term.key}' has a label that term '${o.label}' matches, and a label is published`);
        }
      }
    }
  }
  return { rules };
}

/**
 * The list, or null when none is declared: no CW_RELEASE_TERMS and no list in the sidecar's
 * committed tree. A list that is named but cannot be read or parsed throws; it is not an empty one.
 */
export function loadTerms({ repo = REPO, env = process.env } = {}) {
  let raw, source;
  if (env.CW_RELEASE_TERMS) {
    source = env.CW_RELEASE_TERMS;
    raw = readFileSync(source, 'utf8');
  } else {
    const sidecar = sidecarFor(repo, env);
    if (!existsSync(sidecar)) return null;
    const ref = sidecarRef();
    const listed = execFileSync('git', ['-C', sidecar, 'ls-tree', '--name-only', ref, '--', TERMS_REL],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!listed) return null;
    source = `sidecar ${ref}:${TERMS_REL}`;
    raw = execFileSync('git', ['-C', sidecar, 'show', `${ref}:${TERMS_REL}`],
      { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Error(`${source}: not JSON (${e.message})`); }
  return { source, fingerprint: createHash('sha256').update(raw).digest('hex').slice(0, 12), ...compileTerms(doc, source) };
}

function walk(root, rel = '', out = []) {
  const entries = readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const e of entries) {
    if (!rel && e.name === '.git') continue;
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, p, out);
    else out.push(p);
  }
  return out;
}

const count = (re, text) => (text.match(re) || []).length;

/**
 * Every denied term in `root`, in file contents and in paths. Binaries and links are read by path
 * only. `hits` is what the gate fails on; `withheld` is what an exception took out of it, carried
 * separately so a reader can see that something was withheld and how much.
 *
 * A term's own exception names one exact path and the number of occurrences measured there. It
 * withdraws that many and no more: the surplus is a hit, so a file that gains an occurrence after
 * the narrowing was measured reports it instead of inheriting the file's exemption. A rule's
 * `exceptPaths` is the blunt instrument it always was — a whole file, for every term in the rule,
 * with no number behind it — and the gate refuses to call a pass that rests on one a pass.
 */
export function scanTree(root, { rules }) {
  const hits = [];
  const withheld = [];
  const skipped = { binary: 0, link: 0 };
  let examined = 0;
  for (const path of walk(root)) {
    const full = join(root, path);
    let text = null;
    if (lstatSync(full).isSymbolicLink()) skipped.link += 1;
    else {
      const buf = readFileSync(full);
      if (buf.subarray(0, 8000).includes(0)) skipped.binary += 1;
      else { text = buf.toString('utf8'); examined += 1; }
    }
    for (const rule of rules) {
      const blanket = rule.except.find((e) => e.re.test(path));
      for (const term of rule.terms) {
        const allowance = term.except.find((e) => e.path === path);
        let budget = allowance ? allowance.count : 0;
        for (const [where, target] of [['path', path], ['content', text]]) {
          const n = target === null ? 0 : count(term.re, target);
          if (!n) continue;
          const row = { path, rule: rule.id, term: term.label, where };
          if (blanket) { withheld.push({ ...row, count: n, by: { kind: 'rule', path: blanket.glob, allowed: null } }); continue; }
          const held = Math.min(n, budget);
          budget -= held;
          if (held) withheld.push({ ...row, count: held, by: { kind: 'term', path: allowance.path, allowed: allowance.count } });
          if (n - held) hits.push({ ...row, count: n - held });
        }
      }
    }
  }
  return { examined, skipped, hits, withheld };
}

/** A path with every denied term in it masked, for output that may be read outside the maintainer's machine. */
export function maskPath(path, { rules }) {
  let out = path;
  for (const rule of rules) for (const term of rule.terms) { term.re.lastIndex = 0; out = out.replace(term.re, '***'); }
  return out;
}

/**
 * Counts by rule, by top-level directory and by file. Holds labels and counts, never matched text.
 *
 * `hitCount` is what the gate fails on, `withheldCount` what the exceptions took out, and
 * `grossHitCount` their sum — the denominator, so a reader of the figure can tell that anything was
 * withheld at all. Every declared exception gets a row in `exceptions` whether it withheld anything
 * or not: one that withholds less than it measured is `stale`, which is the only sign a narrowing
 * has stopped describing the file it was measured against.
 *
 * `mask: false` prints paths as they are; it does not drop a row, which is why the mask is a flag
 * rather than an empty rule list passed in place of the real one.
 */
export function summarise(scan, list, { mask = true } = {}) {
  const hide = (p) => (mask ? maskPath(p, list) : p);
  const byRule = {}, byDir = {}, byFile = new Map();
  for (const h of scan.hits) {
    const r = (byRule[h.rule] ||= { files: new Set(), hits: 0 });
    r.files.add(h.path); r.hits += h.count;
    const top = hide(h.path.includes('/') ? h.path.slice(0, h.path.indexOf('/')) : '.');
    const d = (byDir[top] ||= { files: new Set(), hits: 0 });
    d.files.add(h.path); d.hits += h.count;
    const f = byFile.get(h.path) || { path: hide(h.path), hits: 0, terms: {} };
    f.hits += h.count;
    f.terms[h.term] = (f.terms[h.term] || 0) + h.count;
    byFile.set(h.path, f);
  }
  const flat = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => [k, { files: v.files.size, hits: v.hits }]));

  // Rows for every exception the list declares, then the scan's withholdings added into them: a
  // row that stays at 0 is a narrowing nothing exercised, and that is what has to be visible.
  const rows = new Map();
  const at = (rule, term, path) => `${rule}\u0000${term || ''}\u0000${path}`;
  for (const rule of list.rules || []) {
    for (const e of rule.except || []) rows.set(at(rule.id, null, e.glob), { rule: rule.id, term: null, path: hide(e.glob), allowed: null, withheld: 0 });
    for (const t of rule.terms || []) {
      for (const e of t.except || []) rows.set(at(rule.id, t.label, e.path), { rule: rule.id, term: t.label, path: hide(e.path), allowed: e.count, withheld: 0 });
    }
  }
  const wByRule = {};
  for (const w of scan.withheld || []) {
    const r = (wByRule[w.rule] ||= { files: new Set(), hits: 0 });
    r.files.add(w.path); r.hits += w.count;
    const k = at(w.rule, w.by.kind === 'term' ? w.term : null, w.by.path);
    const row = rows.get(k) || { rule: w.rule, term: w.by.kind === 'term' ? w.term : null, path: hide(w.by.path), allowed: w.by.allowed, withheld: 0 };
    row.withheld += w.count;
    rows.set(k, row);
  }
  const exceptions = [...rows.values()]
    .map((r) => ({ ...r, stale: r.allowed === null ? r.withheld === 0 : r.withheld < r.allowed }))
    .sort((a, b) => (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) || (a.path < b.path ? -1 : 1));
  const hitCount = scan.hits.reduce((n, h) => n + h.count, 0);
  const withheldCount = (scan.withheld || []).reduce((n, w) => n + w.count, 0);
  return {
    examined: scan.examined,
    skipped: scan.skipped,
    offendingFiles: byFile.size,
    hitCount,
    withheldCount,
    grossHitCount: hitCount + withheldCount,
    withheld: { hits: withheldCount, files: new Set((scan.withheld || []).map((w) => w.path)).size, byRule: flat(wByRule) },
    exceptions,
    byRule: flat(byRule),
    byDir: flat(byDir),
    files: [...byFile.values()].sort((a, b) => b.hits - a.hits || (a.path < b.path ? -1 : 1)),
  };
}

/**
 * The verdict a summary supports: `fail`, `pass`, or `cannot-check` with the reason. Shared by the
 * gate and the CLI so the two cannot drift on what a clean count means.
 *
 * A clean count that an exclusion produced is not a measurement. It passes only when every
 * exclusion behind it is a counted allowance exercised exactly as it was measured: an unbounded one
 * carries no number to check, and a short one no longer describes the file it was taken from.
 */
export function termsVerdict(s) {
  if (!s.examined) return { status: 'cannot-check', error: 'no text file was examined; an empty tree is not a clean one' };
  if (s.hitCount) return { status: 'fail' };
  if (s.withheldCount) {
    const unbounded = s.exceptions.filter((e) => e.allowed === null && e.withheld);
    if (unbounded.length) {
      return { status: 'cannot-check',
        error: `every denied term in the tree (${s.grossHitCount}) is withheld by an exception, and ${unbounded.length} of them `
          + 'name a whole file with no measured count; an exclusion that removes everything is not a pass' };
    }
    const stale = s.exceptions.filter((e) => e.stale);
    if (stale.length) {
      return { status: 'cannot-check',
        error: `every denied term in the tree (${s.grossHitCount}) is withheld by an exception, and ${stale.length} of them `
          + 'withheld fewer than the measurement that declared them; re-measure the narrowing before reading this as clean' };
    }
  }
  return { status: 'pass' };
}

/** The release gate: pass, fail, or cannot-check with the reason. */
export function termsGate(dest, { load = loadTerms } = {}) {
  const skip = (why) => ({ gate: 'terms', status: 'cannot-check', detail: { error: why } });
  let list;
  try { list = load(); } catch (e) { return skip(`the denied-term list cannot be read (${e.message})`); }
  if (!list) return skip(`no denied-term list: set CW_RELEASE_TERMS or commit ${TERMS_REL} to the sidecar`);
  const s = summarise(scanTree(dest, list), list);
  const v = termsVerdict(s);
  if (!s.examined) return skip(v.error);
  return {
    gate: 'terms',
    status: v.status,
    detail: { list: list.fingerprint, examined: s.examined, skipped: s.skipped, offendingFiles: s.offendingFiles,
      hitCount: s.hitCount, withheldCount: s.withheldCount, grossHitCount: s.grossHitCount, withheld: s.withheld,
      exceptions: s.exceptions, byRule: s.byRule, byDir: s.byDir, files: s.files.slice(0, 100),
      ...(v.error ? { error: v.error } : {}) },
  };
}
