// SOCKET OWNS THIS VOCABULARY, AND WE DO NOT.
//
// D15 grades a Socket alert from its `type`, so the type table is load-bearing. Socket can add a
// type, or rename one, without telling anybody — and the first census of this lane already missed
// `licenseSpdxDisj`, which turned out to be 98.3% of it. A mapping written against that census
// would have had no rule for the overwhelming majority case and would have looked complete.
//
// So the check reads the ARTIFACTS, not the code. A test that compared SOCKET_TYPES against a list
// written beside it would agree with itself forever; this compares it against what Socket actually
// sent. Different source, different predicate — the only arrangement that can notice drift.
//
// The unrecognised path is not a failure mode, it is a designed one: an unknown type is counted as
// `undetermined` with reason `type-not-in-vocabulary` and its name preserved. Nothing breaks. What
// this test adds is that somebody FINDS OUT, instead of 34,898 rows quietly changing meaning.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { _socketTypes, _socketAlertRows } from '../extractors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Env-overridable, read at CALL time — the house rule, so a fixture tree can stand in.
const reportsRoot = () => process.env.CW_REPORTS_ROOT || join(ROOT, 'reports');

/** Every socket.json under the reports root, bounded so this stays a test and not a sweep. */
function socketArtifacts(root, cap = 800) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= cap || depth > 4) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= cap) return;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'socket.json') out.push(p);
    }
  };
  try { statSync(root); } catch { return out; }
  walk(root, 0);
  return out;
}

/**
 * Alert types actually present, with their counts — walked by THE EXTRACTOR'S OWN function rather
 * than a copy of it.
 *
 * The line above used to say "the same traversal _socketAlertRows walks" while a hand-copied loop
 * underneath read only `j.data.alerts`. The extractor also accepts the legacy `j.issues` /
 * `j.alerts` / `j.results.issues` ARRAY shape, so a fleet whose artifacts were in that shape would
 * have yielded zero types here and full rows there — and this file would have reported the entire
 * vocabulary extinct while the lane graded normally. A comment asserting two things are the same is
 * not a mechanism that keeps them the same; importing the one implementation is.
 *
 * Returns the counts alongside how many artifacts actually YIELDED rows and how many are Socket
 * error responses, because "no types" and "no evidence" are different answers and the whole defect
 * below is the two being collapsed.
 */
function observedTypes(files) {
  const seen = new Map();
  let withRows = 0;
  let errored = 0;
  let unparseable = 0;
  for (const f of files) {
    let j;
    try { j = JSON.parse(readFileSync(f, 'utf8')); } catch { unparseable += 1; continue; }
    // `{"ok":false,"message":"Input error"}` — the API refused; `data` is a string, not an alert
    // tree. This is a failed scan wearing a result's filename.
    if (j && j.ok === false) { errored += 1; continue; }
    const rows = _socketAlertRows(j);
    if (!rows.length) continue;
    withRows += 1;
    for (const r of rows) if (r.rule) seen.set(r.rule, (seen.get(r.rule) || 0) + 1);
  }
  return { seen, withRows, errored, unparseable };
}

const FILES = socketArtifacts(reportsRoot());
const { seen: SEEN, withRows: WITH_ROWS, errored: ERRORED, unparseable: UNPARSEABLE } = observedTypes(FILES);

// A CORPUS IS EVIDENCE, NOT FILENAMES. This was `FILES.length > 0`, and the difference published a
// fabricated finding: measured 2026-09-04 on this box, the reports tree held exactly ONE socket.json
// — 323 bytes, dated Jul 25, containing `{"ok":false,"message":"Input error"}` where `data` is a
// string rather than an alert tree. That husk cleared the gate, so the honest "nothing was checked"
// branch was skipped and all five declared types were reported EXTINCT: a vocabulary-drift finding
// derived from a lane that had never successfully run.
//
// That is this repository's own named failure mode, pointed inward. Grey ≠ red: an unknown must not
// be published as a finding any more than as a pass, and a gate that fails on ~100% of its subject
// is a defect signature rather than a fleet in crisis. Absence of evidence gets its own state.
const HAVE_CORPUS = WITH_ROWS > 0;
const noCorpusReason = () => (FILES.length === 0
  ? 'no socket.json under the reports root'
  : `${FILES.length} artifact(s), none carrying alert rows `
    + `(${ERRORED} Socket error response(s), ${UNPARSEABLE} unparseable)`);

describe('the declared Socket vocabulary still covers what Socket sends', () => {
  test('the check has a subject, and says how big it is', (t) => {
    // NOT a silent skip, and NOT a finding either. A fresh clone has no reports/, and a tree whose
    // only artifacts are failed scans has no evidence in it — both are true, legitimate states, and
    // both are reported as themselves rather than as a clean fleet or a drifted vocabulary.
    if (!HAVE_CORPUS) {
      t.diagnostic(`NOTHING WAS CHECKED: ${noCorpusReason()} under ${reportsRoot()}. This is honest `
        + 'here and meaningless as evidence; set CW_REPORTS_ROOT at a tree that has some.');
      assert.equal(SEEN.size, 0,
        'no artifact yielded a row, yet types were extracted — the two counters disagree, which '
        + 'means this gate cannot describe its own subject');
      return;
    }
    // Reached only when at least one artifact DID yield rows, so a zero here is the expensive case:
    // the extractor produced rows carrying no type at all.
    assert.ok(SEEN.size > 0,
      `${WITH_ROWS} artifact(s) yielded rows and ZERO alert types were extracted — the traversal `
      + 'stopped matching Socket\'s shape. This is not a clean fleet; a clean fleet yields no rows.');
  });

  test('every type the fleet has sent is declared', { skip: !HAVE_CORPUS && `no corpus: ${noCorpusReason()}` }, () => {
    const undeclared = [...SEEN].filter(([t]) => !_socketTypes[t])
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `${t} (${n})`);
    assert.deepEqual(undeclared, [],
      'Socket is sending types the table does not know. They are NOT lost — each is counted as '
      + 'undetermined with reason type-not-in-vocabulary and its name preserved — but they are '
      + 'ungraded, and one of them may be a verdict. Classify them in SOCKET_TYPES.');
  });

  test('every declared type is one the fleet has actually sent', { skip: !HAVE_CORPUS && `no corpus: ${noCorpusReason()}` }, () => {
    // The other direction, and it is the one that catches a RENAME. If `criticalCVE` became
    // `cveCritical`, the test above would report one undeclared type and this one would report
    // `criticalCVE` as extinct — together they name the substitution. Either alone reads as a
    // vocabulary that merely grew or merely shrank.
    const extinct = Object.keys(_socketTypes).filter((t) => !SEEN.has(t));
    assert.deepEqual(extinct, [],
      'declared but never observed across the whole corpus — either a type Socket retired (drop it, '
      + 'or say why it is kept) or one half of a RENAME whose other half is failing the test above.');
  });

  test('no single type dominates without the table acknowledging it', { skip: !HAVE_CORPUS && `no corpus: ${noCorpusReason()}` }, () => {
    // The defect signature this repository already paid for four times: one detector accounting for
    // most of a bucket is a defect shape, not a fleet in crisis. licenseSpdxDisj IS 98% of this
    // lane and is declared undetermined for a stated reason — so dominance is fine, and what is
    // not fine is a dominant type carrying a GRADE nobody argued for.
    const total = [...SEEN.values()].reduce((n, x) => n + x, 0);
    for (const [t, n] of SEEN) {
      if (n / total < 0.5) continue;
      const d = _socketTypes[t];
      assert.ok(d && !d.sev,
        `${t} is ${Math.round((n / total) * 100)}% of the lane and carries severity `
        + `"${d && d.sev}" — one detector accounting for most of a severity bucket is the `
        + 'signature this repo has been bitten by four times. Argue it explicitly or withhold it.');
    }
  });
  // ── THE PREDICATE'S OWN SECOND WITNESS ────────────────────────────────────────────────────────
  //
  // Everything above goes quiet when there is no evidence, which is the fix. Quiet is only half of
  // it: a gate that has learned to say nothing is indistinguishable from a gate that has stopped
  // working, and this run genuinely checks nothing because this box has no corpus. So the predicate
  // is exercised directly against fixtures — both directions, on arguments rather than on ambient
  // state — and these assertions run everywhere, including the fresh clone where the four above skip.
  test('the corpus predicate: a husk is not evidence, a real artifact is, and the legacy shape counts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-socket-vocab-'));
    const write = (name, doc) => {
      const d = join(dir, name);
      mkdirSync(d, { recursive: true });
      const f = join(d, 'socket.json');
      writeFileSync(f, JSON.stringify(doc));
      return f;
    };

    // NEGATIVE: the exact artifact that produced the false extinction — a Socket error response.
    const husk = write('husk', { ok: false, message: 'Input error', data: 'x'.repeat(60) });
    const h = observedTypes([husk]);
    assert.equal(h.withRows, 0, 'an error response must not count as evidence');
    assert.equal(h.errored, 1, 'and it must be reported as an error, not as a clean scan');
    assert.equal(h.seen.size, 0);

    // NEGATIVE: unparseable bytes are their own state, never an empty result.
    const badPath = join(dir, 'bad'); mkdirSync(badPath, { recursive: true });
    writeFileSync(join(badPath, 'socket.json'), '{ not json');
    const b = observedTypes([join(badPath, 'socket.json')]);
    assert.equal(b.unparseable, 1);
    assert.equal(b.withRows, 0);

    // POSITIVE: the nested ecosystem -> package -> version shape.
    const nested = write('nested', { data: { alerts: { npm: { 'left-pad': { '1.0.0': { type: 'criticalCVE' } } } } } });
    const n = observedTypes([nested]);
    assert.equal(n.withRows, 1, 'a real alert tree is evidence');
    assert.equal(n.seen.get('criticalCVE'), 1);

    // POSITIVE: the LEGACY array shape, which the hand-copied traversal could not see at all. This
    // is the assertion that pins the divergence fix — it fails against the old loop.
    const legacy = write('legacy', { issues: [{ type: 'obfuscatedFile', pkg: 'a', version: '1' }] });
    const l = observedTypes([legacy]);
    assert.equal(l.withRows, 1, 'the legacy array shape is what the extractor grades, so it is evidence here too');
    assert.equal(l.seen.get('obfuscatedFile'), 1);

    // POSITIVE: the walker finds all four, so a corpus assembled from a tree is not silently empty.
    assert.equal(socketArtifacts(dir).length, 4);

    // And the whole point: an UNDECLARED type is still caught once evidence exists.
    const undeclared = write('drift', { issues: [{ type: 'cveCritical', pkg: 'a', version: '1' }] });
    const u = observedTypes([undeclared]);
    assert.ok(u.withRows > 0 && !_socketTypes['cveCritical'] && u.seen.has('cveCritical'),
      'with real evidence present, a type the table does not declare is still visible — the gate '
      + 'went quiet for lack of a subject, not because it stopped looking');
  });
});
