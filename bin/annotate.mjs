#!/usr/bin/env node
// bin/annotate.mjs — author a scanner-finding annotation (annotations.json `scannerAnnotations`).
// Validates before writing; --check-rollup refuses a zero-match write unless --force.
// The CVE half of the ledger (annotations[]) is deliberately out of scope.
//
// Usage:
//   node bin/annotate.mjs add --category secrets --repo clientD --rule curl-auth-header \
//     --file docs/x.md --action false-positive --reason "why" \
//     [--who "name"] [--expires ISO] [--fleet] [--check-rollup reports/<area>/rollup.json] [--dry]
//   node bin/annotate.mjs list [--category secrets]
//
// Identity flags follow the category: `--<field>` for every field in the category's identity
// tuple (monitor/detail-schema.mjs), ALL required, plus --repo (or the explicit --fleet).
// Env: CW_ANNOTATIONS (store path), CW_NOW (authored-at override, tests).

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { identityFor, detailKeys } from '../monitor/detail-schema.mjs';
import { validateScannerAnnotation, findActiveScannerAnnotation, scannerAnnotationTarget, buildSuppressionLabel, annotationsLockPath } from '../monitor/annotate-lib.mjs';
import { appendRecord, adjudicationsPath, redactLedgerFields } from './lib/verdict-journal-core.mjs';
import { acquireLock, writeAtomic, describeAge } from '../monitor/lockfile.mjs';
import { annotationsPathFor } from '../monitor/store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
// Read at CALL time, never at module load. A `const X = process.env.Y` at import silently defeats
// the override for any test that sets it afterwards, so the test passes while proving nothing —
// and the write would land on the REAL store. Its sibling writer admin/routes/annotations.mjs
// already resolves this way; the two writers of one store now read their path identically.
const STORE = () => annotationsPathFor(join(HERE, '..'));

const argv = process.argv.slice(2);
const cmd = argv[0];
const flags = {};
for (let i = 1; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const name = argv[i].slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) flags[name] = true;
  else { flags[name] = next; i++; }
}

function loadStore() {
  // Fail closed: only ENOENT is absence — a parse error is never an empty ledger.
  try { return JSON.parse(readFileSync(STORE(), 'utf8')); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { annotations: [], scannerAnnotations: [] };
    console.error(`annotations store unreadable (${STORE()}): ${e.message}`);
    process.exit(2);
  }
}

// writeAtomic, never a hand-rolled tmp+rename — its pid-suffixed tmp path cannot collide.
function saveStore(doc) {
  writeAtomic(STORE(), `${JSON.stringify(doc, null, 2)}\n`);
}

if (cmd === 'list') {
  const doc = loadStore();
  const recs = (doc.scannerAnnotations || []).filter((a) => !flags.category || a.category === flags.category);
  if (!recs.length) { console.log('no scannerAnnotations' + (flags.category ? ` for category ${flags.category}` : '')); process.exit(0); }
  for (const a of recs) {
    const idf = identityFor(a.category) || [];
    console.log(`${a.category} ${idf.map((f) => `${f}=${a[f]}`).join(' ')} @${a.scope === 'fleet' ? 'FLEET' : a.repo}`);
    console.log(`  ${a.action} · ${a.who} · at ${a.at}${a.expires ? ` · expires ${a.expires}` : ''}`);
    console.log(`  ${a.reason}`);
  }
  process.exit(0);
}

if (cmd !== 'add') {
  console.error('usage: annotate.mjs add --category <cat> --repo <r> --<identity-field> <v>… --action <a> --reason "…" | annotate.mjs list');
  console.error(`categories: ${detailKeys().join(', ')}`);
  process.exit(2);
}

const category = flags.category;
const idf = identityFor(category);
if (!idf) { console.error(`unknown category '${category}' — known: ${detailKeys().join(', ')}`); process.exit(2); }

const record = { category };
if (flags.fleet) record.scope = 'fleet'; else if (flags.repo) record.repo = flags.repo;
for (const f of idf) if (flags[f] !== undefined) record[f] = String(flags[f]);
record.action = flags.action;
record.reason = typeof flags.reason === 'string' ? flags.reason : '';
record.who = typeof flags.who === 'string' ? flags.who : `${userInfo().username} (bin/annotate.mjs)`;
record.at = process.env.CW_NOW || new Date().toISOString();
if (typeof flags.expires === 'string') record.expires = flags.expires;
// claim: additive, non-identity metadata — set only via this flag, never inferred.
if (typeof flags.claim === 'string') record.claim = flags.claim;
// defect: mandatory for `incorrect-scan-result`, refused for anything else (annotate-lib enforces
// both). Assembled here rather than accepted as JSON so the CLI cannot smuggle unknown fields in.
if (['tool', 'detail', 'detector-name', 'fixed-in'].some((k) => typeof flags[`defect-${k}`] === 'string')) {
  record.defect = {};
  if (typeof flags['defect-tool'] === 'string') record.defect.tool = flags['defect-tool'];
  if (typeof flags['defect-detail'] === 'string') record.defect.detail = flags['defect-detail'];
  if (typeof flags['defect-detector-name'] === 'string') record.defect.detector = flags['defect-detector-name'];
  if (typeof flags['defect-fixed-in'] === 'string') record.defect.fixedIn = flags['defect-fixed-in'];
}

// requireExpires on write — a suppression can never land as a permanent blindfold.
const errs = validateScannerAnnotation(record, idf, { requireExpires: true });
if (errs.length) {
  console.error(`refusing to write an invalid record (identity for ${category}: ${idf.join(', ')} + repo):`);
  for (const e of errs) console.error(`  - ${e}`);
  process.exit(1);
}

// Authoring-time match proof: a zero-match record is a reported refusal, not a write.
// matchProof carries the verdict to the success line at the bottom.
let matchProof = null;
if (typeof flags['check-rollup'] === 'string') {
  if (!existsSync(flags['check-rollup'])) { console.error(`--check-rollup: ${flags['check-rollup']} does not exist`); process.exit(2); }
  const rollup = JSON.parse(readFileSync(flags['check-rollup'], 'utf8'));
  const rows = ((rollup.scannerFindings || {})[category] || []);
  const matched = rows.filter((row) => findActiveScannerAnnotation([record], row, record.at, idf)).length;
  console.log(`matches ${matched} of ${rows.length} published ${category} row(s) in ${flags['check-rollup']}`);
  matchProof = { matched, rows: rows.length };
  if (!matched && !flags.force) {
    console.error('zero matches — refusing to write (a no-match record reads exactly like "no annotations apply"). Re-run with --force to write anyway.');
    process.exit(1);
  }
} else {
  // An unrun check is not a passed check — state the absence explicitly.
  // Deliberately opt-in: guessing the rollup risks a confident zero against the wrong one.
  console.log('NOT verified against any rollup — pass --check-rollup <path/to/rollup.json> to prove '
    + 'this record addresses real rows. Until then "appended" means written, not effective.');
}

if (flags.dry) { console.log(`(dry) would append to ${STORE()}:`); console.log(JSON.stringify(record, null, 2)); process.exit(0); }

// Lost-update guard: same lock path as the panel writer; busy-wait ~1s, then give up.
const LOCK_PATH = annotationsLockPath(STORE());
const lock = acquireLock(LOCK_PATH, {
  staleMs: 30_000, label: 'annotate-cli', attempts: 50, spinMs: 20,
  onStale: (ageMs) => console.error(`annotate: taking over a stale annotations lock (${Math.round(ageMs / 1000)}s old) at ${LOCK_PATH}`),
});
if (!lock.ok) {
  console.error(`annotations store is locked by another writer (${LOCK_PATH}${lock.holder ? `, held by '${lock.holder.label}'` : ''}, ${describeAge(lock.heldFor)}) — try again`);
  process.exit(1);
}

let doc;
try {
  doc = loadStore();
  if (!Array.isArray(doc.scannerAnnotations)) doc.scannerAnnotations = [];
  doc.scannerAnnotations.push(record);
  saveStore(doc);
} finally {
  lock.release();
}
// The success line states the effect, not just the write.
const effect = matchProof === null
  ? 'match count NOT VERIFIED — see the note above'
  : (matchProof.matched > 0
    ? `this record matches ${matchProof.matched} of ${matchProof.rows} published ${category} row(s)`
    : `this record matches ZERO of ${matchProof.rows} published ${category} row(s) — it suppresses nothing as written`);
console.log(`appended to ${STORE()} (${doc.scannerAnnotations.length} scanner annotation(s) total; ${effect}). Takes effect at the next rollup of the affected area.`);

// Fatigue ledger: label the suppression event — one record per write, never per evaluation.
// Only accept/wont-fix count; accept without expires is flagged noExpires, counted, never blocked.
if (record.action === 'accept' || record.action === 'wont-fix') {
  const label = buildSuppressionLabel({
    target: scannerAnnotationTarget(record, idf),
    action: record.action,
    who: record.who,
    at: record.at,
    ...(record.expires ? { expires: record.expires } : {}),
    ...(record.action === 'accept' && !record.expires ? { noExpires: true } : {}),
  });
  const res = appendRecord(adjudicationsPath(), redactLedgerFields(label));
  if (!res.ok) console.error(`warning: suppression-label not recorded (${res.error}) — the annotation write itself succeeded`);
}
