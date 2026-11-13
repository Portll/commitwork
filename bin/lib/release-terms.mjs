// bin/lib/release-terms.mjs — the denied-term check a release candidate must pass.
//
// The list names private things (internal tools, customer pseudonyms, the maintainer's own history),
// so it is a private record: the sidecar's committed copy, or CW_RELEASE_TERMS on disk. A tree with
// no list is cannot-check, never clean. Reports carry rule ids and term labels, never the matched
// text and never a term's own `why` or `test`, which name the private thing as plainly as the term.
//
// The list is a DETECTOR, not the policy: an occurrence it reports can be a term a person has read
// and judged not to be disclosure. That judgement is the acceptance record beside the list, one row
// per occurrence, bound to the digest of the measurement it was granted against. So the gate has
// three outcomes, not two: a clean tree passes, a tree whose every occurrence is accepted is
// CONTESTED, and anything unreviewed or lapsed fails.
//
// env: CW_RELEASE_TERMS (a list file; overrides the sidecar) ·
//      CW_RELEASE_TERM_ACCEPTANCES (an acceptance record; overrides the sidecar) ·
//      CW_SIDECAR · CW_RELEASE_NAMES_SIDECAR_REF
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sidecarFor, sidecarRef } from './release-names-head-scan.mjs';
import { validateAgainstSchema } from '../../lib/json-schema.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TERMS_REL = 'monitor/release-terms.json';
export const ACCEPTANCES_REL = 'monitor/release-term-acceptances.json';
export const termsSchemaPath = () => resolve(REPO, 'schema', 'release-terms.schema.json');
export const acceptancesSchemaPath = () => resolve(REPO, 'schema', 'release-term-acceptances.schema.json');

// The dispositions that settle an occurrence. The rest — pending, rename, redact, move-to-sidecar —
// are rulings that the term must GO, so they leave it open and the gate red: a judged term awaiting
// its edit is not an accepted one.
export const ACCEPTING = Object.freeze(['generic-capability', 'public-by-design', 'upstream-content', 'detector-defect']);

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

/** An occurrence's identity: the place a term fired. Never a line — this scan has none, and a term
 *  that moves within its file is the same occurrence having moved, not one ending and another starting. */
export const occurrenceKey = (o) => `${o.file}\0${o.rule}\0${o.term}\0${o.where}`;

/**
 * The digest an acceptance is granted against. The count is in the basis, so a new occurrence of an
 * accepted term changes it and the acceptance lapses rather than covering the new one. The pattern
 * is in it too: `internal-tool#1` can be rewritten to match something else entirely while keeping
 * its label, and an acceptance granted against the old pattern says nothing about the new one.
 */
export function digestOccurrence(o, pattern) {
  const basis = JSON.stringify({ file: o.file, rule: o.rule, term: o.term, where: o.where, count: o.count, pattern: pattern ?? null });
  return createHash('sha256').update(basis).digest('hex').slice(0, 16);
}

// Two different absences, both of them empty and neither of them a pass: no sidecar at all, and a
// sidecar that has committed no record. `origin` is the field that says which, and unlike `source`
// it names no path, so a gate report can carry it.
const empty = (origin) => Object.freeze({ source: origin, origin, fingerprint: null, note: '', acceptances: [] });

function parseAcceptances(raw, source) {
  let doc;
  try { doc = JSON.parse(raw); } catch (e) { throw new Error(`${source}: not JSON (${e.message})`); }
  const v = validateAgainstSchema(doc, { path: acceptancesSchemaPath() });
  if (v.errors.length) throw new Error(`${source}: ${v.errors[0]}`);
  const seen = new Set();
  for (const a of doc.acceptances) {
    // Paths stay out of these messages: the record is private and the message reaches a gate report.
    const where = `${a.rule} ${a.term} ${a.where}`;
    const k = occurrenceKey(a);
    if (seen.has(k)) throw new Error(`${source}: ${where} is ruled on twice for one file`);
    seen.add(k);
    if (ACCEPTING.includes(a.disposition)
      && !(/^[0-9a-f]{16}$/.test(String(a.evidence)) && a.reason.trim() && a.test.trim() && a.reviewer.trim() && a.reviewedAt)) {
      throw new Error(`${source}: ${where} is accepted without an evidence digest, a reason, a test another person can apply, a reviewer and a date`);
    }
  }
  return doc;
}

/**
 * The per-term acceptance record, or an EMPTY one. No sidecar, or no record committed in it, means
 * nothing has been accepted, so every occurrence stays open — the direction that fails closed. A
 * record that is named but cannot be read, or that does not parse or validate, throws, and the gate
 * reports cannot-check. Read from the sidecar's COMMIT: an uncommitted row cannot clear the gate.
 */
export function loadAcceptances({ repo = REPO, env = process.env } = {}) {
  let raw, source, origin;
  if (env.CW_RELEASE_TERM_ACCEPTANCES) {
    source = env.CW_RELEASE_TERM_ACCEPTANCES;
    origin = 'file';
    raw = readFileSync(source, 'utf8');
  } else {
    const sidecar = sidecarFor(repo, env);
    if (!existsSync(sidecar)) return empty('no-sidecar');
    const ref = sidecarRef();
    const listed = execFileSync('git', ['-C', sidecar, 'ls-tree', '--name-only', ref, '--', ACCEPTANCES_REL],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (!listed) return empty('sidecar-absent');
    source = `sidecar ${ref}:${ACCEPTANCES_REL}`;
    origin = 'sidecar';
    raw = execFileSync('git', ['-C', sidecar, 'show', `${ref}:${ACCEPTANCES_REL}`],
      { encoding: 'utf8', maxBuffer: 1 << 24, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const doc = parseAcceptances(raw, source);
  return {
    source, origin, fingerprint: createHash('sha256').update(raw).digest('hex').slice(0, 12),
    note: doc.note, acceptances: doc.acceptances,
  };
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

const termPatterns = ({ rules }) => new Map(rules.flatMap((r) => r.terms.map((t) => [t.label, `${t.re.source}\0${t.re.flags}`])));

/**
 * Split a scan by the acceptance record. Three lists, held apart: `accepted` (a signed row whose
 * digest still matches the measurement), `lapsed` (a row granted against a different measurement or
 * a since-rewritten pattern), and `open` (no row at all, or a row that rules the term must go).
 * Rows that matched no occurrence come back as `stale`. Every entry carries the digest of the
 * measurement as it stands, which is what a reviewer would have to grant an acceptance against.
 */
export function applyAcceptances(scan, list, record) {
  const patterns = termPatterns(list);
  const rows = new Map((record.acceptances || []).map((a) => [occurrenceKey(a), { row: a, used: 0 }]));
  const accepted = [], lapsed = [], open = [];
  for (const h of scan.hits) {
    const place = { file: h.path, rule: h.rule, term: h.term, where: h.where, count: h.count };
    const o = { ...place, evidence: digestOccurrence(place, patterns.get(place.term)) };
    const held = rows.get(occurrenceKey(place));
    if (held) held.used += 1;
    if (!held) open.push(o);
    else if (!ACCEPTING.includes(held.row.disposition)) open.push({ ...o, disposition: held.row.disposition });
    else if (held.row.evidence === o.evidence) accepted.push({ ...o, disposition: held.row.disposition });
    else lapsed.push({ ...o, disposition: held.row.disposition, grantedAgainst: held.row.count });
  }
  const stale = [...rows.values()].filter((r) => !r.used)
    .map((r) => ({ file: r.row.file, rule: r.row.rule, term: r.row.term, where: r.row.where, disposition: r.row.disposition }));
  return { accepted, lapsed, open, stale };
}

/** The record a reviewer edits: one PENDING row per occurrence the gate has not settled, carrying the
 *  digest it would have to be granted against. Pending accepts nothing — it is the question, not the
 *  answer — so a drafted record leaves the gate exactly as red as it was. */
export function draftAcceptances(applied, { reviewedAt = null } = {}) {
  const rows = [...applied.open, ...applied.lapsed]
    .map((o) => ({
      file: o.file, rule: o.rule, term: o.term, where: o.where, count: o.count, evidence: o.evidence,
      disposition: 'pending', reason: '', test: '', reviewer: '', reviewedAt,
    }))
    .sort((a, b) => (occurrenceKey(a) < occurrenceKey(b) ? -1 : 1));
  return { note: `${rows.length} denied-term occurrence(s) awaiting a ruling`, acceptances: rows };
}

/** The release gate: pass, contested, fail, or cannot-check with the reason. */
export function termsGate(dest, { load = loadTerms, loadAccepted = loadAcceptances } = {}) {
  const skip = (why) => ({ gate: 'terms', status: 'cannot-check', detail: { error: why } });
  let list;
  try { list = load(); } catch (e) { return skip(`the denied-term list cannot be read (${e.message})`); }
  if (!list) return skip(`no denied-term list: set CW_RELEASE_TERMS or commit ${TERMS_REL} to the sidecar`);
  let record;
  try { record = loadAccepted(); } catch (e) { return skip(`the term acceptances cannot be read (${e.message})`); }
  const scan = scanTree(dest, list);
  const s = summarise(scan, list);
  const v = termsVerdict(s);
  if (!s.examined) return skip(v.error);
  const applied = applyAcceptances(scan, list, record);
  const tally = (rows) => rows.reduce((n, r) => n + r.count, 0);
  const acceptedCount = tally(applied.accepted), lapsedCount = tally(applied.lapsed), unreviewedCount = tally(applied.open);
  // Three states, the way undetermined is held apart from the severity buckets: a tree that carries
  // an occurrence a person read and defended is not clean, and it is not a failure either. hitCount
  // stays the detector's own number, so accepting a term never erases what fired. Acceptances settle
  // hits only: what is left is judged as a clean count is, so an accepted tree whose remainder rests
  // on an unmeasured or short exception is cannot-check, not contested.
  const settled = !unreviewedCount && !lapsedCount;
  const rest = settled && acceptedCount ? termsVerdict({ ...s, hitCount: 0, grossHitCount: s.withheldCount }) : v;
  const status = !settled ? 'fail' : rest.status === 'pass' && acceptedCount ? 'contested' : rest.status;
  const row = (r) => ({ path: maskPath(r.file, list), rule: r.rule, term: r.term, where: r.where, disposition: r.disposition ?? null,
    ...(r.count ? { count: r.count, evidence: r.evidence } : {}), ...(r.grantedAgainst ? { grantedAgainst: r.grantedAgainst } : {}) });
  return {
    gate: 'terms',
    status,
    detail: { list: list.fingerprint, acceptances: record.fingerprint, acceptanceOrigin: record.origin ?? null, acceptanceRows: (record.acceptances || []).length,
      examined: s.examined, skipped: s.skipped, offendingFiles: s.offendingFiles,
      hitCount: s.hitCount, withheldCount: s.withheldCount, grossHitCount: s.grossHitCount, withheld: s.withheld,
      acceptedCount, lapsedCount, unreviewedCount,
      exceptions: s.exceptions, byRule: s.byRule, byDir: s.byDir, files: s.files.slice(0, 100),
      lapsed: applied.lapsed.slice(0, 50).map(row), stale: applied.stale.slice(0, 50).map(row),
      ...(rest.error ? { error: rest.error } : {}),
      ...(s.hitCount ? { summary: `${s.hitCount} denied term(s) in ${s.offendingFiles} file(s): ${acceptedCount} accepted, ${lapsedCount} lapsed, ${unreviewedCount} unreviewed` } : {}) },
  };
}
