// bin/lib/release-terms.mjs — the denied-term check a release candidate must pass.
//
// The list names private things (internal tools, customer pseudonyms, the maintainer's own history),
// so it is a private record: the sidecar's committed copy, or CW_RELEASE_TERMS on disk. A tree with
// no list is cannot-check, never clean. Reports carry rule ids and term labels, never the matched text.
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

/** Rules from a parsed list. Throws, naming the rule, on anything a gate could misread. */
export function compileTerms(doc, source = 'list') {
  const v = validateAgainstSchema(doc, { path: termsSchemaPath() });
  if (v.errors.length) throw new Error(`${source}: ${v.errors[0]}`);
  const seen = new Set();
  const rules = doc.rules.map((r) => {
    if (seen.has(r.id)) throw new Error(`${source}: rule id '${r.id}' is declared twice`);
    seen.add(r.id);
    const flags = r.caseSensitive ? 'g' : 'gi';
    const sources = [
      ...(r.words || []).map((w) => `(?<![A-Za-z0-9_])${escapeRe(w)}(?![A-Za-z0-9_])`),
      ...(r.patterns || []),
    ];
    if (!sources.length) throw new Error(`${source}: rule '${r.id}' has no words and no patterns`);
    const terms = sources.map((src, i) => {
      let re;
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- src is an escaped word or a pattern the schema-checked terms file declares; an invalid one throws
      try { re = new RegExp(src, flags); }
      catch (e) { throw new Error(`${source}: rule '${r.id}' term ${i + 1} is not a valid pattern (${e.message})`); }
      // A pattern that matches nothing at all would count every position of every file.
      if (re.test('')) throw new Error(`${source}: rule '${r.id}' term ${i + 1} matches the empty string`);
      return { label: `${r.id}#${i + 1}`, re };
    });
    return { id: r.id, why: r.why, terms, except: (r.exceptPaths || []).map(globRe) };
  });
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

/** Every denied term in `root`, in file contents and in paths. Binaries and links are read by path only. */
export function scanTree(root, { rules }) {
  const hits = [];
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
      if (rule.except.some((re) => re.test(path))) continue;
      for (const term of rule.terms) {
        const inPath = count(term.re, path);
        if (inPath) hits.push({ path, rule: rule.id, term: term.label, where: 'path', count: inPath });
        const inText = text === null ? 0 : count(term.re, text);
        if (inText) hits.push({ path, rule: rule.id, term: term.label, where: 'content', count: inText });
      }
    }
  }
  return { examined, skipped, hits };
}

/** A path with every denied term in it masked, for output that may be read outside the maintainer's machine. */
export function maskPath(path, { rules }) {
  let out = path;
  for (const rule of rules) for (const term of rule.terms) { term.re.lastIndex = 0; out = out.replace(term.re, '***'); }
  return out;
}

/** Counts by rule, by top-level directory and by file. Holds labels and counts, never matched text. */
export function summarise(scan, list) {
  const byRule = {}, byDir = {}, byFile = new Map();
  for (const h of scan.hits) {
    const r = (byRule[h.rule] ||= { files: new Set(), hits: 0 });
    r.files.add(h.path); r.hits += h.count;
    const top = maskPath(h.path.includes('/') ? h.path.slice(0, h.path.indexOf('/')) : '.', list);
    const d = (byDir[top] ||= { files: new Set(), hits: 0 });
    d.files.add(h.path); d.hits += h.count;
    const f = byFile.get(h.path) || { path: maskPath(h.path, list), hits: 0, terms: {} };
    f.hits += h.count;
    f.terms[h.term] = (f.terms[h.term] || 0) + h.count;
    byFile.set(h.path, f);
  }
  const flat = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => [k, { files: v.files.size, hits: v.hits }]));
  return {
    examined: scan.examined,
    skipped: scan.skipped,
    offendingFiles: byFile.size,
    hitCount: scan.hits.reduce((n, h) => n + h.count, 0),
    byRule: flat(byRule),
    byDir: flat(byDir),
    files: [...byFile.values()].sort((a, b) => b.hits - a.hits || (a.path < b.path ? -1 : 1)),
  };
}

/** The release gate: pass, fail, or cannot-check with the reason. */
export function termsGate(dest, { load = loadTerms } = {}) {
  const skip = (why) => ({ gate: 'terms', status: 'cannot-check', detail: { error: why } });
  let list;
  try { list = load(); } catch (e) { return skip(`the denied-term list cannot be read (${e.message})`); }
  if (!list) return skip(`no denied-term list: set CW_RELEASE_TERMS or commit ${TERMS_REL} to the sidecar`);
  const s = summarise(scanTree(dest, list), list);
  if (!s.examined) return skip('no text file was examined; an empty tree is not a clean one');
  return {
    gate: 'terms',
    status: s.hitCount ? 'fail' : 'pass',
    detail: { list: list.fingerprint, examined: s.examined, skipped: s.skipped, offendingFiles: s.offendingFiles,
      hitCount: s.hitCount, byRule: s.byRule, byDir: s.byDir, files: s.files.slice(0, 100) },
  };
}
