#!/usr/bin/env node
/**
 * pattern-scan.mjs — bind the failure taxonomy to detectors and emit observations. Decisions live in
 * bin/lib/pattern-core.mjs; this holds the I/O.
 *
 * Single pass: one walk, one read, one lex per file, shared by every SRC detector. D2 costs two git
 * calls regardless of citation count. What it does NOT cover is in `reach.notInThisVersion`.
 *
 * usage:
 *   node bin/pattern-scan.mjs [--root <dir>] [--json] [--seed [--force]] [--quiet]
 * exit: 0 clean or baseline-only · 1 new findings above the baseline · 2 failure (fail closed)
 * env: CW_NOW, CW_PATTERN_ROOT, CW_TAXONOMY_JSON, CW_PATTERN_BINDINGS, CW_PATTERN_BASELINE,
 *      CW_ISSUES (issue store; CW_ISSUES_JSON still honoured), CW_PATTERN_JOURNAL_DIR
 */
import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeAtomic } from '../monitor/lockfile.mjs';
import { stripNonCode } from './bare-catch-ratchet.mjs';
import { readJournal } from './lib/verdict-journal-core.mjs';
import { validateAgainstSchema } from '../monitor/registry.mjs';
import {
  SRC_DETECTORS, detectUntrackedDurable, detectUnreachableCitations, detectRuleDominance,
  detectSelfAdjudication,
  coverageFor, adjudicate, applyBaseline, priorityOf, buildRunRecord, observation, dedupe,
} from './lib/pattern-core.mjs';

import { issuesPathFor } from '../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

// Env read at CALL time: a module-scope `process.env.Y` defeats any test that sets it after.
const rootDir = () => resolve(process.env.CW_PATTERN_ROOT || REPO);
const taxonomyPath = () => process.env.CW_TAXONOMY_JSON || join(REPO, 'monitor', 'failure-taxonomy.json');
const bindingsPath = () => process.env.CW_PATTERN_BINDINGS || join(REPO, 'monitor', 'detector-bindings.json');
const baselinePath = () => process.env.CW_PATTERN_BASELINE || join(REPO, 'monitor', 'pattern-baseline.json');
const schemaPath = () => process.env.CW_PATTERN_BASELINE_SCHEMA || join(REPO, 'schema', 'pattern-baseline.schema.json');
// was: a local resolver reading CW_ISSUES_JSON, a name nothing else in the repo used — so setting
// CW_ISSUES redirected every other reader and left this one on the real store.
const journalDir = () => process.env.CW_PATTERN_JOURNAL_DIR || null;
const nowStamp = () => process.env.CW_NOW || new Date().toISOString();

const DURABLE_ROOTS = ['evaluations', 'docs'];
// Argv bound, not a coverage bound: the list is CHUNKED through it, never truncated.
const REFERENCE_CHUNK = 200;

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** ENOENT is the only legitimate absence; anything else is a failure, never an empty store. */
function readOptional(p) {
  try { return { present: true, value: readJson(p) }; } catch (e) {
    if (e.code === 'ENOENT') return { present: false, value: null, reason: 'absent' };
    return { present: false, value: null, reason: e.code || 'unparseable', hard: true };
  }
}

// ── overwatch-layer GATHERERS ─────────────────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(['node_modules', '.git', 'reports', 'tmp', '.npm-cache', 'coverage',
  'fixtures', '__fixtures__', 'vendor', 'data', 'archive', 'worktrees', 'dist', 'build']);

/**
 * The source walk. NOT bare-catch-ratchet's collectFiles, which skips `test/` and `tests/` — right
 * for a ratchet over production code, and it left both R1 detectors scanning a population with zero
 * test files in it while their denominator read "235 modules".
 */
function collectSources(root) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') && e.name !== '.claude') { if (e.isDirectory()) continue; }
      if (SKIP_DIRS.has(e.name)) continue;
      const abs = join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (/\.mjs$/.test(e.name)) out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

/** One walk, one read, one lex — but a denominator PER DETECTOR, over its own declared population. */
function gatherSrc(root, detectors) {
  const files = collectSources(root);
  const observations = [];
  const skipped = [];
  const seen = Object.fromEntries(detectors.map((d) => [d.id, 0]));
  for (const rel of files) {
    let src;
    try { src = readFileSync(join(root, rel), 'utf8'); } catch (e) { skipped.push({ path: rel, reason: `unreadable (${e.code || 'error'})` }); continue; }
    let stripped;
    // Skipped = named path + reason, never a tally: a count cannot say WHICH.
    try { stripped = stripNonCode(src); } catch (e) { skipped.push({ path: rel, reason: `unlexable (${e.message})` }); continue; }
    const file = { rel, src, stripped };
    for (const d of detectors) {
      if (d.population && !d.population(rel)) continue;
      seen[d.id]++;
      try { observations.push(...d.run(file)); } catch (e) { skipped.push({ path: rel, reason: `detector ${d.id} threw (${e.message})` }); }
    }
  }
  const denomFor = (d) => ({
    unit: d.populationName || 'module',
    scanned: seen[d.id],
    ofWalked: files.length,
    skipped: skipped.filter((s) => !d.population || d.population(s.path)),
  });
  return { observations, denomFor, walked: files.length };
}

/**
 * Which paths does TRACKED source read? `-o` prints the match, not the line — a substring test lets
 * A's match mark B. Ignore files excluded: .gitignore speaks to TRACKING, not dependency.
 */
function referencedByTracked(root, paths) {
  const found = new Set();
  for (let i = 0; i < paths.length; i += REFERENCE_CHUNK) {
    const args = ['grep', '-F', '-h', '-o', '--no-color'];
    for (const p of paths.slice(i, i + REFERENCE_CHUNK)) args.push('-e', p);
    args.push('--', ':!.gitignore', ':!**/.gitignore', ':!.gitattributes');
    let out = '';
    // exit 1 = no matches, the only legitimate empty; anything else narrows back to the roots.
    try {
      out = execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
      if (e.status !== 1) throw new Error(`reference scan failed (status ${e.status}) — refusing to fall back to the declared roots in silence`);
    }
    for (const line of out.split('\n')) { const m = line.trim(); if (m) found.add(m); }
  }
  return [...found];
}

/** Every untracked file in the tree, classified by declared root or by real dependency. */
function gatherUntracked(root) {
  const all = git(['ls-files', '--others', '--exclude-standard'], root).trim();
  const untracked = all ? all.split('\n').filter(Boolean) : [];
  return detectUntrackedDurable({
    untrackedPaths: untracked,
    durableRoots: DURABLE_ROOTS,
    referencedPaths: untracked.length ? referencedByTracked(root, untracked) : [],
  });
}

const SHA_RE = /(?<![0-9A-Za-z])([0-9a-f]{7,40})(?![0-9A-Za-z])/g;

// No cap: batch-check reads STDIN and rev-list is one call either way. The old 400 hid 4 findings.
function gatherCitations(root) {
  const tracked = git(['ls-files', '--', '*.md'], root).trim().split('\n').filter(Boolean);
  const citations = [];
  const seen = new Set();
  for (const rel of tracked) {
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    SHA_RE.lastIndex = 0;
    for (let m; (m = SHA_RE.exec(text)); ) {
      const sha = m[1];
      if (/^\d+$/.test(sha)) continue;                       // a run of digits is a number, not a SHA
      seen.add(sha);
      let line = 1;
      for (let i = 0; i < m.index; i++) if (text[i] === '\n') line++;
      citations.push({ sha, path: rel, line });
    }
  }
  // Resolve every candidate in ONE call, then answer containment from a set built by ONE more.
  const uniq = [...seen];
  const resolution = {};
  if (uniq.length) {
    const oids = batchCheck(root, uniq);
    const reachable = new Set(git(['rev-list', '--all'], root).trim().split('\n').filter(Boolean));
    for (const [sha, oid] of Object.entries(oids)) {
      resolution[sha] = oid ? { resolves: true, containedBy: reachable.has(oid) ? 1 : 0 } : { resolves: false, containedBy: null };
    }
  }
  return detectUnreachableCitations({ citations, resolution });
}

/** One batch-check for all candidates. NOT `^{commit}` — a blob-typed prefix makes the peel fatal. */
function batchCheck(root, shas) {
  const input = `${shas.join('\n')}\n`;
  const out = execFileSync('git', ['cat-file', '--batch-check'], { cwd: root, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const res = {};
  out.trim().split('\n').forEach((l, i) => {
    const parts = l.split(/\s+/);
    res[shas[i]] = parts[1] === 'commit' ? parts[0] : null;   // 'missing', 'blob', 'tree', ambiguous → not a commit citation
  });
  return res;
}

// ── MAIN ────────────────────────────────────────────────────────────────────────────────────────

export function run(argv = process.argv.slice(2)) {
  const root = rootDir();
  const has = (f) => argv.includes(f);

  const taxonomy = readJson(taxonomyPath());
  const bindingsRaw = readFileSync(bindingsPath(), 'utf8');
  const bindings = JSON.parse(bindingsRaw);
  const classById = Object.fromEntries(taxonomy.classes.map((c) => [c.id, c]));

  // A binding naming a class the registry does not hold is a hard failure. Two files that can
  // disagree in silence is the class this scanner detects, so the disagreement is refused.
  const unknown = bindings.detectors.filter((b) => !classById[b.classId]).map((b) => `${b.id}→${b.classId}`);
  if (unknown.length) throw new Error(`bindings name classes the registry does not hold: ${unknown.join(', ')}`);

  const bound = new Set(bindings.detectors.map((b) => b.id));
  const srcDetectors = SRC_DETECTORS.filter((d) => bound.has(d.id));

  const detectorRecords = [];
  const observations = [];
  const undetermined = [];

  const src = gatherSrc(root, srcDetectors);
  observations.push(...src.observations);
  for (const d of srcDetectors) {
    const b = bindings.detectors.find((x) => x.id === d.id);
    detectorRecords.push({ id: d.id, version: d.version, classId: d.classId, substrate: 'SRC', status: 'ran', covers: b.covers, complete: b.complete, denominator: src.denomFor(d) });
  }

  for (const [id, classId, fn] of [
    ['untracked-durable-record', 'D6', () => gatherUntracked(root)],
    ['unreachable-citation', 'D2', () => gatherCitations(root)],
  ]) {
    if (!bound.has(id)) continue;
    const b = bindings.detectors.find((x) => x.id === id);
    try {
      const r = fn();
      observations.push(...r.observations);
      undetermined.push(...r.undetermined);
      detectorRecords.push({ id, version: 1, classId, substrate: 'HIST', status: 'ran', covers: b.covers, complete: b.complete, denominator: r.denominator });
    } catch (e) {
      // A thrown detector does not vanish: its class becomes undetermined, failure named.
      detectorRecords.push({ id, version: 1, classId, substrate: 'HIST', status: 'failed', error: String(e.message), covers: b.covers, complete: b.complete, denominator: null });
      undetermined.push(observation({ detector: id, version: 1, classId, path: '<detector>', scope: 'failure', predicate: `detector failed: ${e.message} — this class is UNDETERMINED, not clean`, snippet: '', confidence: 'inferred' }));
    }
  }

  if (bound.has('rule-dominance')) {
    const b = bindings.detectors.find((x) => x.id === 'rule-dominance');
    const store = readOptional(issuesPathFor(REPO));
    if (store.hard) throw new Error(`issue store unreadable (${store.reason}) — refusing to report a clean A10 over an unread store`);
    if (!store.present) {
      detectorRecords.push({ id: 'rule-dominance', version: 1, classId: 'A10', substrate: 'ART', status: 'not-applicable', reason: 'issue store absent', covers: b.covers, complete: b.complete, denominator: null });
    } else {
      const issues = Object.values(store.value.issues || {});
      const r = detectRuleDominance({ issues, ...(b.params || {}) });
      observations.push(...r.observations);
      undetermined.push(...r.undetermined);
      detectorRecords.push({ id: 'rule-dominance', version: 1, classId: 'A10', substrate: 'ART', status: 'ran', covers: b.covers, complete: b.complete, denominator: r.denominator });
    }
  }

  if (bound.has('self-adjudication')) {
    const b = bindings.detectors.find((x) => x.id === 'self-adjudication');
    // readJournal, never readJournalFile: the journal ROTATES, and reading only the live generation
    // would shrink the denominator without saying so — a rate computed over a truncated population
    // flatters every time. This one walks the chain.
    let j = null, err = null;
    try { j = readJournal('adjudications', journalDir() ? { dir: journalDir() } : {}); }
    catch (e) { err = e; }
    if (err) {
      detectorRecords.push({ id: 'self-adjudication', version: 1, classId: 'G12', substrate: 'ART', status: 'failed', error: String(err.message), covers: b.covers, complete: b.complete, denominator: null });
      undetermined.push(observation({ detector: 'self-adjudication', version: 1, classId: 'G12', path: '<detector>', scope: 'failure', predicate: `detector failed: ${err.message} — this class is UNDETERMINED, not clean`, snippet: '', confidence: 'inferred' }));
    } else if (j.absent) {
      detectorRecords.push({ id: 'self-adjudication', version: 1, classId: 'G12', substrate: 'ART', status: 'not-applicable', reason: 'adjudication journal absent', covers: b.covers, complete: b.complete, denominator: null });
    } else {
      const r = detectSelfAdjudication({ records: j.records || [], ...(b.params || {}) });
      observations.push(...r.observations);
      undetermined.push(...r.undetermined);
      detectorRecords.push({ id: 'self-adjudication', version: 1, classId: 'G12', substrate: 'ART', status: 'ran', covers: b.covers, complete: b.complete, denominator: r.denominator });
    }
  }

  // Adjudication comes from the existing verdict journal — four-valued, rotation-safe, retractable.
  const adj = {};
  try {
    const j = readJournal('pattern-scan', journalDir() ? { dir: journalDir() } : {});
    for (const r of j.records || []) if (r.kind === 'adjudication' && r.identity) adj[r.identity] = r;
  } catch { /* an absent journal is absent; readJournal itself fails closed on unreadable */ }

  const baseline = readOptional(baselinePath());
  if (baseline.hard) throw new Error(`baseline unreadable (${baseline.reason}) — refusing to treat it as empty`);
  // THE SCHEMA IS APPLIED, NOT MERELY SHIPPED. A baseline is a list of findings a later run stays
  // QUIET about, so a malformed one is the most expensive kind of bad file here: `identities`
  // misspelled reads as an empty list and grandfathers nothing (loud, survivable), while a subtly
  // wrong identity form matches nothing forever and never says so (silent, and indistinguishable
  // from a clean tree). monitor/registry-inventory.json records this binding as `validator`; that
  // claim is only true because of these five lines.
  if (baseline.present) {
    // (doc, { path }) and it returns { errors }, NOT an array. The first version of these lines
    // passed a parsed schema as the second argument and tested `.length` on the result object —
    // undefined, falsy, never thrown. A guard that cannot fire, written inside the change that
    // exists to stop guards that cannot fire. Caught by feeding it a deliberately malformed
    // baseline rather than by reading it back.
    const { errors: errs } = validateAgainstSchema(baseline.value, { path: schemaPath() });
    if (errs.length) throw new Error(`baseline does not satisfy schema/pattern-baseline.schema.json — refusing to grandfather against a shape nobody can read: ${errs.join('; ')}`);
  }

  // THE RECORDED DIGEST IS COMPARED, NOT MERELY CARRIED. The baseline stores bindingsSha256 so a
  // reader can tell whether it was seeded against THIS detector set — and until now nothing read it
  // back, which made the field a provenance claim that provenance never checked. It went stale the
  // same day it was introduced: adding the G12 binding moved the digest and the baseline went on
  // suppressing 68 identities against a set it was not seeded from, silently.
  //
  // It is reported, not refused. A binding change is ordinary and legitimate; what is NOT legitimate
  // is grandfathering against a detector set nobody compared. A CHANGED PREDICATE is the sharp case:
  // an identity seeded when a detector matched broadly stays suppressed after the detector narrows,
  // so the baseline can hold down a finding the current rules would raise. That is class R4, a
  // structurally frozen metric — recorded here as UNDETERMINED, which is what it is.
  const baselineStale = baseline.present
    && baseline.value.bindingsSha256
    && baseline.value.bindingsSha256 !== sha256(bindingsRaw);
  if (baselineStale) {
    undetermined.push(observation({
      detector: 'baseline-provenance', version: 1, classId: 'R4',
      path: '<pattern-baseline>', scope: 'bindings',
      predicate: `the baseline was seeded against detector-bindings.json ${baseline.value.bindingsSha256.slice(0, 12)} and this run reads ${sha256(bindingsRaw).slice(0, 12)} — `
        + `its ${(baseline.value.identities || []).length} suppressions are of UNDETERMINED applicability to the current detector set, because a narrowed predicate keeps its old identity suppressed`,
      snippet: `seeded ${baseline.value.bindingsSha256.slice(0, 12)} != current ${sha256(bindingsRaw).slice(0, 12)}`,
      // The digest MISMATCH is structural — two hashes were compared. What the mismatch IMPLIES for
      // any given suppression is not: some of the 68 are unaffected by the binding change and some
      // may not be, and this detector cannot tell which. `inferred` is the honest tier, and it is
      // what routes this to undetermined rather than to the finding count.
      confidence: 'inferred',
    }));
  }

  let results = adjudicate(dedupe([...observations, ...undetermined]), adj);
  results = applyBaseline(results, baseline.value ? baseline.value.identities : []);
  results = results.map((o) => {
    const c = classById[o.classId];
    return { ...o, class: c ? { name: c.name, layer: c.layer, gain: c.gain, closure: c.closure } : null, priority: priorityOf(c) };
  }).sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || a.identity.localeCompare(b.identity));

  const ran = new Set(detectorRecords.filter((d) => d.status === 'ran').map((d) => d.id));
  const coverage = coverageFor(bindings, ran);

  const head = git(['rev-parse', 'HEAD'], root).trim();
  const dirty = git(['status', '--porcelain'], root).trim().length > 0;

  const record = buildRunRecord({
    at: nowStamp(),
    tree: { root: relative(REPO, root) || '.', head, dirty },
    taxonomy: { version: taxonomy.version, sourceSha256: sha256(readFileSync(taxonomyPath(), 'utf8')) },
    bindingsHash: sha256(bindingsRaw),
    detectors: detectorRecords,
    coverage,
    results,
    classesTotal: taxonomy.classes.length,
  });
  record.reach.withheld = bindings.withheld || [];
  record.baselineProvenance = baseline.present
    ? { seededAgainst: baseline.value.bindingsSha256 ?? null, current: sha256(bindingsRaw), stale: !!baselineStale, identities: (baseline.value.identities || []).length }
    : { seededAgainst: null, current: sha256(bindingsRaw), stale: false, identities: 0 };

  if (has('--seed')) {
    // A dirty-tree baseline pins content in no commit; --force records the override.
    if (dirty && !has('--force')) throw new Error('refusing to seed a baseline from a dirty tree — commit, or pass --force (which is recorded)');
    const ids = [...new Set(results.filter((o) => o.adjudication === 'finding' || o.adjudication === 'baseline').map((o) => o.identity))].sort();
    const payload = { schema: 'commitwork.pattern-baseline/1', seededAt: record.generatedAt, head, dirty, forced: has('--force'), bindingsSha256: record.bindings.sha256, identities: ids };
    // writeAtomic, not a hand-rolled `.tmp` — its temp name carries the pid.
    writeAtomic(baselinePath(), `${JSON.stringify(payload, null, 2)}\n`);
    return { record, seeded: ids.length, exit: 0 };
  }

  const fresh = results.filter((o) => o.adjudication === 'finding');
  return { record, exit: fresh.length ? 1 : 0 };
}

const isMain = isMainModule(import.meta.url);
if (isMain) {
  try {
    const { record, seeded, exit } = run();
    if (process.argv.includes('--json')) {
      process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
    } else if (seeded !== undefined) {
      process.stdout.write(`seeded ${seeded} identities into ${baselinePath()}\n`);
    } else {
      const c = record.counts;
      const cov = record.reach.coverage;
      process.stdout.write(`${record.tree.head.slice(0, 7)}${record.tree.dirty ? '+dirty' : ''} — taxonomy v${record.taxonomy.version}\n`);
      process.stdout.write(`classes: ${cov.complete} complete · ${cov.partial} partial · ${cov.unspecified} unspecified · ${cov.unscanned} UNSCANNED of ${record.reach.classesTotal}\n`);
      process.stdout.write(`observations: ${c.finding} finding · ${c.undetermined} undetermined · ${c.baseline} baseline · ${c.accepted} accepted\n`);
      for (const o of record.observations.filter((x) => x.adjudication === 'finding').slice(0, 25)) {
        process.stdout.write(`  ${o.classId.padEnd(4)} p${String(o.priority).padStart(2)}  ${o.place.path}:${o.place.line ?? '-'}  ${o.detector}\n`);
      }
      process.stdout.write(`${record.reach.statement}\n`);
    }
    // exitCode, never exit(): exit() abandons buffered stdout — the first --json run lost 164 KB.
    process.exitCode = exit;
  } catch (e) {
    process.stderr.write(`pattern-scan FAILED CLOSED: ${e.message}\n`);
    process.exitCode = 2;
  }
}
