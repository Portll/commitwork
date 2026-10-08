// reconcile-findings — pins four properties: the merge is deterministic, a verified record
// outranks an unreviewed one, verified disagreements keep the higher severity AND record the
// conflict, and missed[] records survive with provenance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { auditDirFor } from '../../monitor/store-paths.mjs';
import { jaccard, summaryTokens } from '../../lib/text-similarity.mjs';
import {
  reconcile, loadPass, normaliseFile, severityRank, loadLedgers, LEDGERS_FILE, renderMarkdown,
} from '../reconcile-findings.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '..', 'reconcile-findings.mjs');
const REPO = resolve(HERE, '..', '..');

// A finding with every field the real data carries.
const finding = (o) => ({
  file: 'bin/x.mjs', line: 10, kind: 'invalid', severity: 'medium',
  summary: 'placeholder', evidence: 'e', remediation: 'r', intentional: false,
  verdict: 'confirmed', note: '', ...o,
});
const area = (name, findings, missed = []) => ({ area: name, summary: '', perProject: {}, findings, missed });
const pass = (id, areas) => ({ id, records: loadPass(JSON.stringify(areas), id) });

// ── path normalisation ───────────────────────────────────────────────────────
// Mixed absolute/relative paths for one file must not double-count a defect.
test('normaliseFile: an absolute path under the repo becomes repo-relative', () => {
  assert.equal(normaliseFile(join(REPO, 'admin/auth.mjs')), 'admin/auth.mjs');
  assert.equal(normaliseFile('admin/auth.mjs'), 'admin/auth.mjs');
  assert.equal(normaliseFile('./admin/auth.mjs'), 'admin/auth.mjs');
});

test('normaliseFile: a path captured on ANOTHER machine still lands repo-relative', () => {
  // a clone elsewhere must still reconcile data authored on another machine
  assert.equal(
    normaliseFile('/srv/elsewhere/src/commitwork/monitor/rollup.mjs', '/opt/checkouts/commitwork'),
    'monitor/rollup.mjs',
  );
});

test('an absolute and a relative record of ONE defect merge into ONE entry', () => {
  const summary = 'The store fails open on an unreadable file and reopens the bootstrap window.';
  const p1 = pass('pass1', [area('a', [finding({ file: join(REPO, 'admin/auth.mjs'), line: 63, summary })])]);
  const p2 = pass('pass2', [area('b', [finding({ file: 'admin/auth.mjs', line: 63, summary })])]);
  const { entries } = reconcile([p1, p2], { fixedLedger: [] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].provenance.recordCount, 2);
  assert.deepEqual(entries[0].provenance.passes, ['pass1', 'pass2']);
});

// ── (1) determinism ──────────────────────────────────────────────────────────
test('the merge is deterministic: record ORDER cannot change the output', () => {
  const mk = (i) => finding({ file: `bin/f${i}.mjs`, line: i, summary: `defect number ${i} in the pipeline` });
  const forward = pass('pass1', [area('a', [mk(1), mk(2), mk(3)]), area('b', [mk(4), mk(5)])]);
  const shuffled = pass('pass1', [area('b', [mk(5), mk(4)]), area('a', [mk(3), mk(1), mk(2)])]);
  const a = JSON.stringify(reconcile([forward], { fixedLedger: [] }).entries);
  const b = JSON.stringify(reconcile([shuffled], { fixedLedger: [] }).entries);
  assert.equal(a, b);
});

test('the CLI writes a BYTE-IDENTICAL queue.json on a second run', () => {
  // byte-identical is the bar — this artifact is meant to be committed
  const dir = mkdtempSync(join(tmpdir(), 'cw-reconcile-det-'));
  writeFixture(dir);
  const run = () => spawnSync(process.execPath, [CLI, '--in', dir, '--no-gate'], { encoding: 'utf8' });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const jsonA = readFileSync(join(dir, 'queue.json'));
  const mdA = readFileSync(join(dir, 'queue.md'));
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.ok(jsonA.equals(readFileSync(join(dir, 'queue.json'))), 'queue.json differed between two runs over identical input');
  assert.ok(mdA.equals(readFileSync(join(dir, 'queue.md'))), 'queue.md differed between two runs over identical input');
  // And nothing in it is a clock reading — a timestamp would make every re-run a diff.
  assert.ok(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(jsonA.toString('utf8')), 'queue.json must not embed a generation time');
  const doc = JSON.parse(jsonA.toString('utf8'));
  assert.equal(doc.inputs.length, 2);
  assert.match(doc.inputs[0].sha256, /^[0-9a-f]{64}$/);
});

function writeFixture(dir) {
  mkdirSync(dir, { recursive: true });
  const p1 = [area('one', [
    finding({ file: 'bin/a.mjs', line: 1, summary: 'the alpha defect leaks a token into argv' }),
    finding({ file: 'bin/b.mjs', line: 2, severity: 'high', summary: 'the beta defect fails open on a parse error' }),
  ], [
    { file: 'bin/c.mjs', line: 3, severity: 'low', summary: 'the gamma defect the first pass missed entirely' },
  ])];
  const p2 = [area('two', [
    finding({ file: 'bin/d.mjs', line: 4, verdict: 'unreviewed', note: '', severity: 'critical', summary: 'the delta defect nobody re-read' }),
  ], [])];
  writeFileSync(join(dir, 'findings-pass1.json'), JSON.stringify(p1, null, 2));
  writeFileSync(join(dir, 'findings-pass2.json'), JSON.stringify(p2, null, 2));
}

// ── (2) verified outranks unreviewed ─────────────────────────────────────────
test('verified beats unreviewed: the tested severity wins, the untested one is only recorded', () => {
  const summary = 'The nightly agent sweeps only the primary area, so the deadman is permanently red.';
  const verified = pass('pass1', [area('a', [finding({
    file: 'monitor/install-agents.mjs', line: 90, severity: 'low', verdict: 'confirmed',
    note: 'reproduced against the generated plist', summary,
  })])]);
  const untested = pass('pass2', [area('b', [finding({
    file: 'monitor/install-agents.mjs', line: 90, severity: 'high', verdict: 'unreviewed', note: '', summary,
  })])]);
  const { entries } = reconcile([verified, untested], { fixedLedger: [] });
  assert.equal(entries.length, 1);
  const e = entries[0];
  // 'high' is the HIGHER severity — and it still loses, because no second reader ever tested it.
  assert.equal(e.severity, 'low');
  assert.equal(e.severityBasis, 'confirmed');
  assert.equal(e.disposition, 'open', 'one verified record is enough to make this schedulable');
  // The losing rating is not deleted; it is on the record with its empty note visible.
  assert.deepEqual(e.severitiesSeen, ['high', 'low']);
  assert.ok(e.provenance.hasUnreviewedRecord);
  assert.equal(e.provenance.records.find((r) => r.verdict === 'unreviewed').noteChars, 0);
});

test('an entry with NO verified record is dispositioned unreviewed, not open', () => {
  const only = pass('pass2', [area('b', [finding({
    file: 'admin/auth.mjs', line: 63, severity: 'critical', verdict: 'unreviewed', note: '',
    summary: 'loadStore fails open on any unreadable store and reopens the bootstrap window',
  })])]);
  const { entries } = reconcile([only], { fixedLedger: [] });
  assert.equal(entries[0].disposition, 'unreviewed');
  assert.equal(entries[0].severityBasis, 'unreviewed-only');
  assert.match(entries[0].dispositionReason, /no second reader/);
});

// ── (3) two verified records that disagree ───────────────────────────────────
test('two VERIFIED records that disagree keep the higher severity AND record the conflict', () => {
  const summary = 'The containment guard is a lexical path comparison with no realpath resolution.';
  const lo = pass('pass1', [area('a', [finding({ file: 'bin/deploy.mjs', line: 158, severity: 'medium', verdict: 'confirmed', note: 'n', summary })])]);
  const hi = pass('pass2', [area('b', [finding({ file: 'bin/deploy.mjs', line: 158, severity: 'critical', verdict: 'confirmed', note: 'n', summary })])]);
  const { entries } = reconcile([lo, hi], { fixedLedger: [] });
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.severity, 'critical', 'a disagreement must round UP, never down');
  const c = e.conflicts.find((x) => x.type === 'severity-within-tier');
  assert.ok(c, 'the disagreement must be recorded, not hidden');
  assert.equal(c.unresolved, true);
  assert.deepEqual(c.severities, ['critical', 'medium']);
  assert.match(c.resolution, /human must rule/);
});

test('an ADJUSTED record supersedes a CONFIRMED one — and that is not a conflict', () => {
  // a second-pass re-rating is the protocol working, not a conflict
  const summary = 'A used TOTP code is accepted again for the full window, violating RFC 6238.';
  const first = pass('pass1', [area('a', [finding({ file: 'admin/auth.mjs', line: 210, severity: 'high', verdict: 'confirmed', note: 'n', summary })])]);
  const second = pass('pass2', [area('b', [finding({ file: 'admin/auth.mjs', line: 210, severity: 'medium', verdict: 'adjusted', note: 'argued down', summary })])]);
  const { entries } = reconcile([first, second], { fixedLedger: [] });
  assert.equal(entries[0].severity, 'medium', 'the deliberate re-rating stands even though it is LOWER');
  assert.equal(entries[0].severityBasis, 'adjusted');
  assert.equal(entries[0].conflicts.filter((c) => c.unresolved).length, 0);
  assert.ok(entries[0].conflicts.some((c) => c.type === 'adjusted-supersedes-confirmed'));
});

test('a refutation sitting next to a confirmation is a verdict split, not an average', () => {
  const summary = 'grep -oc is platform divergent and yields different counts on BSD and GNU.';
  const p = pass('pass2', [area('a', [
    finding({ file: 'bin/cspm-github.sh', line: 33, severity: 'low', verdict: 'refuted', note: 'measured; -o is a no-op with -c', summary }),
    finding({ file: 'bin/cspm-github.sh', line: 33, severity: 'high', verdict: 'confirmed', note: 'n', summary }),
  ])]);
  const { entries } = reconcile([p], { fixedLedger: [] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].disposition, 'open', 'a contested refutation must not close the item');
  assert.ok(entries[0].conflicts.some((c) => c.type === 'verdict-split' && c.unresolved));
});

test('a refuted finding gets a refuted disposition, so it cannot be silently re-promoted', () => {
  const p = pass('pass1', [area('a', [finding({
    file: 'bin/cspm-github.sh', line: 33, verdict: 'refuted',
    note: 'measured on this machine: -o has no effect with -c on either grep',
    summary: 'a claim that did not survive verification',
  })])]);
  const { entries } = reconcile([p], { fixedLedger: [] });
  assert.equal(entries[0].disposition, 'refuted');
  assert.match(entries[0].dispositionReason, /measured on this machine/);
});

// ── (4) missed[] survives with provenance ────────────────────────────────────
test('missed[] records survive into the queue and their provenance says so', () => {
  const p = pass('pass2', [area('bin-shell', [
    finding({ file: 'bin/bola-tokens.sh', line: 23, summary: 'the finding the first reader wrote up' }),
  ], [
    { file: 'bin/bola-tokens.sh', line: 34, severity: 'high', summary: 'the synthetic tenant defaults guarantee a FALSE cross-tenant critical' },
  ])]);
  const { entries } = reconcile([p], { fixedLedger: [] });
  const m = entries.find((e) => e.line === 34);
  assert.ok(m, 'the missed[] record must reach the queue at all — dropping it is the original defect');
  assert.equal(m.severity, 'high');
  assert.deepEqual(m.provenance.sources, ['missed']);
  assert.equal(m.provenance.fromMissed, true);
  assert.deepEqual(m.provenance.verdicts, ['absent'], 'a missed[] record carries no verdict, and that is stated');
  // No verdict means no second pass, so it must not be schedulable as if it had one.
  assert.equal(m.disposition, 'unreviewed');
  assert.equal(m.provenance.unreviewed, true);
  // And the ordinary finding beside it is unaffected.
  assert.equal(entries.find((e) => e.line === 23).provenance.fromMissed, false);
});

test('a missed[] record merged with a findings[] record keeps BOTH sources in provenance', () => {
  const summary = 'The OUT literal client-a-monorepo bypasses area.mjs in the history generator.';
  const p = pass('pass1', [area('a', [finding({ file: 'monitor/corrected-history.mjs', line: 27, severity: 'medium', summary })],
    [{ file: 'monitor/corrected-history.mjs', line: 27, severity: 'high', summary }])]);
  const { entries } = reconcile([p], { fixedLedger: [] });
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].provenance.sources, ['findings', 'missed']);
  assert.equal(entries[0].severity, 'medium', 'the verified findings[] record outranks the unverified missed[] one');
  // The richer record supplies the human-readable fields; a missed[] record has no remediation.
  assert.equal(entries[0].remediation, 'r');
});

// ── the fixed ledger ─────────────────────────────────────────────────────────
test('the fixed ledger marks only the entry it names, even when two share an anchor', () => {
  // one anchor really does carry two unrelated findings in the raw data
  const p = pass('pass2', [area('a', [
    finding({ file: 'admin/auth.mjs', line: 76, severity: 'high', verdict: 'unreviewed', note: '',
      summary: 'loadStore never validates `users`, so a non-array users key throws a TypeError' }),
    finding({ file: 'admin/auth.mjs', line: 76, severity: 'low', verdict: 'unreviewed', note: '',
      summary: 'userCount is exported and imported but never called anywhere' }),
  ])]);
  const ledger = [{ item: 'E.2 item 3', file: 'admin/auth.mjs', line: 76, match: /never validates `users`/i, note: 'now throws' }];
  const { entries, ledgerBindings } = reconcile([p], { fixedLedger: ledger });
  assert.equal(entries.filter((e) => e.disposition === 'fixed').length, 1);
  assert.equal(entries.find((e) => e.disposition === 'fixed').severity, 'high');
  assert.equal(entries.find((e) => e.disposition === 'unreviewed').severity, 'low');
  const fixedId = entries.find((e) => e.disposition === 'fixed').id;
  assert.match(fixedId, /^q-[0-9a-f]{8}$/);
  assert.deepEqual(ledgerBindings, [{ item: 'E.2 item 3', anchor: 'admin/auth.mjs:76', bound: 1, ids: [fixedId] }]);
});

// ── ids name a place, never a position ───────────────────────────────────────
// Positional ids renumbered every entry a re-sort moved past, so a cited id silently came to mean
// another finding. A new FIXED_LEDGER row is the everyday re-sort: its entry drops to `fixed`.
test('an id survives the re-sort a new fixed-ledger row causes', () => {
  const p = pass('pass1', [area('a', [
    finding({ file: 'bin/a.mjs', line: 1, severity: 'critical', summary: 'the alpha defect leaks a token into argv' }),
    finding({ file: 'bin/b.mjs', line: 2, severity: 'high', summary: 'the beta defect fails open on a parse error' }),
    finding({ file: 'bin/c.mjs', line: 3, severity: 'low', summary: 'the gamma defect drops a record silently' }),
  ])]);
  const idsByFile = (entries) => Object.fromEntries(entries.map((e) => [e.file, e.id]));
  const before = reconcile([p], { fixedLedger: [] }).entries;
  const after = reconcile([p], { fixedLedger: [{ item: 'X', file: 'bin/a.mjs', match: /alpha defect/, note: 'n' }] }).entries;
  assert.deepEqual([before[0].file, after[after.length - 1].file], ['bin/a.mjs', 'bin/a.mjs'], 'premise: the fix moved it from first to last');
  assert.deepEqual(idsByFile(after), idsByFile(before), 'every entry the fixed one moved past kept its id');
});

test('an id survives an insertion above it, and a move of its own line', () => {
  const b = finding({ file: 'bin/b.mjs', line: 20, severity: 'low', summary: 'the beta defect fails open on a parse error' });
  const alone = reconcile([pass('pass1', [area('a', [b])])], { fixedLedger: [] }).entries[0].id;
  const later = reconcile([pass('pass1', [area('a', [
    finding({ file: 'bin/a.mjs', line: 1, severity: 'critical', summary: 'a new critical that sorts above it' }),
    { ...b, line: 87 },
  ])])], { fixedLedger: [] }).entries;
  assert.equal(later[1].file, 'bin/b.mjs', 'premise: it is no longer first');
  assert.equal(later[1].id, alone);
});

test('twins — one file, one summary, two anchors — get distinct ids whatever the input order', () => {
  const summary = 'the same defect text recorded at two places in one file';
  const run = (lines) => reconcile([pass('pass1', [area('a',
    lines.map((line) => finding({ file: 'bin/t.mjs', line, summary, evidence: `seen at ${line}` })))])], { fixedLedger: [] }).entries;
  const byLine = (entries) => Object.fromEntries(entries.map((e) => [e.line, e.id]));
  const a = run([10, 50]);
  assert.equal(new Set(a.map((e) => e.id)).size, 2, 'twins must not share an id');
  assert.deepEqual(byLine(run([50, 10])), byLine(a));
  assert.match(byLine(a)[10], /^q-[0-9a-f]{8}$/);
  assert.equal(byLine(a)[50], `${byLine(a)[10]}-2`);
});

test('a fixed-ledger row that binds to NOTHING is reported as drift, not ignored', () => {
  const p = pass('pass1', [area('a', [finding({ file: 'bin/x.mjs', line: 1, summary: 'something else entirely' })])]);
  const ledger = [{ item: 'E.9', file: 'bin/gone.mjs', line: 5, match: /vanished/, note: 'n' }];
  const { ledgerBindings } = reconcile([p], { fixedLedger: ledger });
  assert.equal(ledgerBindings[0].bound, 0);
});

// ── the gate ─────────────────────────────────────────────────────────────────
test('the CLI exits nonzero while anything is unresolved, and prints the conflict report', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-reconcile-gate-'));
  writeFixture(dir); // contains one unreviewed record, so the gate must trip
  const r = spawnSync(process.execPath, [CLI, '--in', dir], { encoding: 'utf8' });
  assert.equal(r.status, 1, 'a queue with unreviewed entries must not report clean');
  assert.match(r.stdout, /CONFLICT REPORT/);
  assert.match(r.stdout, /records with verdict "unreviewed"/);
  assert.match(r.stdout, /GATE: BLOCKED/);
  // --no-gate still writes the artifact but stops short of failing the build.
  const ng = spawnSync(process.execPath, [CLI, '--in', dir, '--no-gate'], { encoding: 'utf8' });
  assert.equal(ng.status, 0);
  assert.match(ng.stdout, /GATE: BLOCKED/, 'suppressing the exit code must not suppress the finding');
});

test('a missing input is exit 2, never an empty green queue', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-reconcile-empty-'));
  const r = spawnSync(process.execPath, [CLI, '--in', dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /missing input/);
});

// ── the real corpus ──────────────────────────────────────────────────────────
// Audit output about private repositories, so it lives in the sidecar and a clone does not have it.
// CW_RECONCILE_IN points this at a copy, as --in does for the CLI.
const CORPUS = () => process.env.CW_RECONCILE_IN || auditDirFor(REPO);
const needsCorpus = () => {
  try { statSync(CORPUS()); return {}; } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { skip: `audit corpus absent at ${CORPUS()} (ENOENT) — it is sidecar-resident, so a public checkout cannot run this` };
  }
};

test('the committed 2026-07-29 corpus reconciles to a stable, fully-accounted queue', needsCorpus(), () => {
  const dir = CORPUS();
  const p1 = pass('pass1', JSON.parse(readFileSync(join(dir, 'findings-pass1.json'), 'utf8')));
  const p2 = pass('pass2', JSON.parse(readFileSync(join(dir, 'findings-pass2.json'), 'utf8')));
  const ledgers = loadLedgers(readFileSync(join(dir, LEDGERS_FILE), 'utf8'));
  const { records, entries, ledgerBindings } = reconcile([p1, p2], { fixedLedger: ledgers.fixed, movedLedger: ledgers.moved });
  assert.equal(records.length, 402, '374 findings[] + 28 missed[]');
  assert.equal(records.filter((r) => r.source === 'missed').length, 28);
  // Every raw record is accounted for by exactly one entry — nothing is dropped on the floor.
  assert.equal(entries.reduce((n, e) => n + e.provenance.recordCount, 0), 402);
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length, 'two entries share an id');
  // Every entry has a disposition from the closed vocabulary; there is no "unknown" bucket.
  // 'moved' joined this vocabulary on 2026-10-04: still live, no longer in the file it was
  // anchored to (MOVED_LEDGER). The set stays closed on purpose — there is no "unknown" bucket.
  const DISPOSITIONS = new Set(['open', 'moved', 'fixed', 'refuted', 'unreviewed']);
  for (const e of entries) assert.ok(DISPOSITIONS.has(e.disposition), `${e.id} ${e.disposition}`);
  // a fixed claim binding NOTHING asserts a fix for a finding the corpus does not contain;
  // identity is (file, match), so one remediation may legitimately close several findings
  for (const b of ledgerBindings) assert.ok(b.bound >= 1, `${b.item} ${b.anchor} binds nothing`);

  // no entry may be claimed by two DIFFERENT ledger items
  const claims = new Map();
  for (const b of ledgerBindings) for (const id of b.ids) claims.set(id, [...(claims.get(id) || []), b.item]);
  for (const [id, items] of claims) {
    assert.equal(new Set(items).size, 1, `entry ${id} is claimed by ${[...new Set(items)].join(' and ')}`);
  }
  // The 74 unreviewed records are still visible as unreviewed, not laundered into `open`.
  assert.equal(records.filter((r) => r.verdict === 'unreviewed').length, 74);
  assert.equal(records.filter((r) => r.verdict === 'unreviewed' && String(r.note).trim()).length, 0);
});

// ── ledger identity is never keyed on a line ─────────────────────────────────
// CLAUDE.md's invariant at the one place that decides "is this the same finding": a line-keyed
// ledger could never match a genuinely fixed finding whose anchor moved.
test('a ledger fix still binds after the finding’s line moves', () => {
  const ledger = [{ item: 'X1', file: 'lib/thing.mjs', match: /fails open on a parse error/i, note: 'now throws' }];
  const at = (line) => pass('pass1', [{
    area: 'a',
    findings: [{ file: 'lib/thing.mjs', line, severity: 'high', verdict: 'confirmed', note: 'checked',
      summary: 'The store fails open on a parse error, so a malformed file reads as empty.' }],
  }]);

  const before = reconcile([at(42)], { fixedLedger: ledger }).entries[0];
  const after = reconcile([at(87)], { fixedLedger: ledger }).entries[0];

  assert.equal(before.disposition, 'fixed', 'baseline: the ledger binds at the original line');
  assert.equal(after.disposition, 'fixed',
    'the SAME defect moved 42 -> 87 and the ledger must still close it; a line-keyed identity reported this as open');
  assert.equal(before.dispositionReason, after.dispositionReason, 'moving code must not change WHY it is closed');
});

test('a ledger row does not close a DIFFERENT defect that happens to share the file', () => {
  const ledger = [{ item: 'X1', file: 'lib/thing.mjs', match: /fails open on a parse error/i, note: 'now throws' }];
  const { entries } = reconcile([pass('pass1', [{
    area: 'a',
    findings: [{ file: 'lib/thing.mjs', line: 12, severity: 'high', verdict: 'confirmed', note: 'checked',
      summary: 'Unrelated: the retry loop has no backoff and hammers the endpoint.' }],
  }])], { fixedLedger: ledger });
  assert.equal(entries[0].disposition, 'open',
    'dropping `line` from the key must not widen the claim to every finding in the file — the summary regex is the other half of the identity');
});

// ── the ledgers file (sidecar-resident; fixtures here) ───────────────────────
const ledgerDoc = (fixed, moved = []) => JSON.stringify({ schema: 1, fixed: [{ about: 'fixture', rows: fixed }], moved: [{ about: null, rows: moved }] });
const fixedRow = (over = {}) => ({ item: 'F1', file: 'bin/a.mjs', match: { source: 'alpha\\s+defect', flags: 'i' }, note: 'n', ...over });

test('loadLedgers revives each match from { source, flags } and flattens the groups in order', () => {
  const l = loadLedgers(ledgerDoc([fixedRow(), fixedRow({ item: 'F2', match: { source: 'beta', flags: '' } })],
    [{ item: 'M1', file: 'x.html', match: { source: 'moved\\s+thing', flags: 'i' }, to: 'y.js:3', at: 'abc1234', note: 'n' }]));
  assert.deepEqual(l.fixed.map((r) => r.item), ['F1', 'F2']);
  assert.ok(l.fixed[0].match instanceof RegExp && l.fixed[0].match.test('ALPHA   defect'), 'the escaped \\s+ survived the JSON round trip');
  assert.equal(l.moved[0].to, 'y.js:3');
});

test('loadLedgers refuses two rows sharing (file, match): the identity would be ambiguous', () => {
  assert.throws(() => loadLedgers(ledgerDoc([fixedRow(), fixedRow({ item: 'F2' })])), /shares \(file, match\) with F1/);
  assert.doesNotThrow(() => loadLedgers(ledgerDoc([fixedRow(), fixedRow({ item: 'F2', file: 'bin/b.mjs' })])));
});

test('loadLedgers refuses a row carrying a line — a line in the key is the defect this guards', () => {
  assert.throws(() => loadLedgers(ledgerDoc([fixedRow({ line: 12 })])), /carries a line/);
});

test('loadLedgers fails closed on a malformed file rather than applying part of it', () => {
  assert.throws(() => loadLedgers('{not json'), SyntaxError);
  assert.throws(() => loadLedgers(JSON.stringify({ schema: 2, fixed: [], moved: [] })), /schema must be 1/);
  assert.throws(() => loadLedgers(ledgerDoc([fixedRow({ match: '/alpha/i' })])), /match must be \{ source, flags \}/);
  assert.throws(() => loadLedgers(ledgerDoc([], [{ item: 'M1', file: 'x', match: { source: 'a', flags: '' }, note: 'n', at: 'abc' }])), /to must be a non-empty string/);
});

test('the sidecar ledgers file loads under the same rules', needsCorpus(), () => {
  const l = loadLedgers(readFileSync(join(CORPUS(), LEDGERS_FILE), 'utf8'));
  assert.ok(l.fixed.length > 0, 'the real fixed ledger is empty — the move lost its rows');
});

test('severityRank puts an UNKNOWN severity above info, so a bad rating cannot sink out of sight', () => {
  assert.ok(severityRank('wat') > severityRank('info'));
  assert.ok(severityRank('wat') < severityRank('low'));
  assert.ok(severityRank('critical') > severityRank('high'));
});

test('jaccard: identical wording is 1, unrelated wording is near 0', () => {
  assert.equal(jaccard(summaryTokens('the store fails open'), summaryTokens('the store fails open')), 1);
  assert.ok(jaccard(summaryTokens('the store fails open'), summaryTokens('renovate dashboard pins')) < 0.1);
});

// ── carry-forward: a regen must not un-verify committed pins ───────────────────────────────────
import { carryForwardPins } from '../reconcile-findings.mjs';

const pinned = (over = {}) => ({
  file: 'a.mjs', key: 'k1', line: 30, anchor: 'a.mjs:30', verifiedAtHead: 'abc1234',
  reanchor: { fromLine: 20, toLine: 30, note: 'moved' }, ...over,
});

test('a unique place carries its pin, line and ref onto the regenerated entry', () => {
  const fresh = { file: 'a.mjs', key: 'k1', line: 20, anchor: 'a.mjs:20', verifiedAtHead: 'e0e0e01' };
  const { carried } = carryForwardPins({ queue: [pinned()] }, [fresh]);
  assert.equal(carried, 1);
  assert.equal(fresh.line, 30);
  assert.equal(fresh.verifiedAtHead, 'abc1234');
  assert.equal(fresh.reanchor.toLine, 30);
});

test('a pin into another file carries its anchorFile, and the identity file is untouched', () => {
  const fresh = { file: 'a.mjs', key: 'k1', line: 20, anchor: 'a.mjs:20', verifiedAtHead: 'e0e0e01' };
  carryForwardPins({ queue: [pinned({ anchorFile: 'lib/b.mjs', line: 7, anchor: 'lib/b.mjs:7' })] }, [fresh]);
  assert.equal(fresh.file, 'a.mjs');
  assert.equal(fresh.anchorFile, 'lib/b.mjs');
  assert.equal(fresh.anchor, 'lib/b.mjs:7');
  const plain = { file: 'a.mjs', key: 'k1', line: 20 };
  carryForwardPins({ queue: [pinned()] }, [plain]);
  assert.equal(plain.anchorFile, undefined, 'no anchorFile is invented for an in-file pin');
});

test('an ambiguous place (two entries share file+key) carries nothing — a wrong pin is worse than a lost one', () => {
  const a = { file: 'a.mjs', key: 'k1', line: 20 };
  const b = { file: 'a.mjs', key: 'k1', line: 90 };
  assert.equal(carryForwardPins({ queue: [pinned()] }, [a, b]).carried, 0);
  assert.equal(a.reanchor, undefined);
});

test('an unpinned previous entry carries nothing — carry-forward is for pins, not for freezing lines', () => {
  const fresh = { file: 'a.mjs', key: 'k1', line: 20 };
  const { carried } = carryForwardPins({ queue: [{ file: 'a.mjs', key: 'k1', line: 25 }] }, [fresh]);
  assert.equal(carried, 0);
  assert.equal(fresh.line, 20);
});

test('reverified pins carry the same way', () => {
  const fresh = { file: 'a.mjs', key: 'k2', line: 5 };
  const prev = { file: 'a.mjs', key: 'k2', line: 7, anchor: 'a.mjs:7', verifiedAtHead: 'abc1234',
    reverified: { basis: 'comment-only delta: …', toLine: 7 } };
  assert.equal(carryForwardPins({ queue: [prev] }, [fresh]).carried, 1);
  assert.equal(fresh.line, 7);
  assert.match(fresh.reverified.basis, /comment-only/);
});

test('a dropped pin is COUNTED, never silently un-verified', () => {
  const a = { file: 'a.mjs', key: 'k1', line: 20 };
  const b = { file: 'a.mjs', key: 'k1', line: 90 };
  const r = carryForwardPins({ queue: [pinned()] }, [a, b]);
  assert.equal(r.carried, 0);
  assert.equal(r.dropped, 1, 'ambiguity drops the pin — the count is how anyone learns');
});

test('a pinned place that vanished from the new queue counts as dropped', () => {
  const r = carryForwardPins({ queue: [pinned()] }, [{ file: 'z.mjs', key: 'other', line: 1 }]);
  assert.equal(r.dropped, 1);
});

// ── the second reading arrives as its own pass ───────────────────────────────
// pass1/pass2 are hashed evidence and are never rewritten to add a verdict, so a later ruling has
// to merge onto the entry it rules on. These pin the three properties this rests on: it lands
// on the SAME entry, its severity wins, and an absent pass3 is stated rather than assumed.
test('a pass3 verdict rules on the existing entry instead of opening a new one', () => {
  const summary = 'The store fails open on an unreadable file and reopens the bootstrap window.';
  const p1 = pass('pass1', [area('a', [finding({
    file: 'admin/auth.mjs', line: 63, severity: 'high', verdict: 'unreviewed', note: '', summary,
  })])]);
  const p3 = pass('pass3', [area('a', [finding({
    file: 'admin/auth.mjs', line: 63, severity: 'high', verdict: 'confirmed',
    note: 'read at HEAD: the catch still returns an empty store', summary,
  })])]);

  const { entries } = reconcile([p1, p3], { fixedLedger: [] });
  assert.equal(entries.length, 1, 'the second reading opened a second entry rather than ruling on the first');
  assert.equal(entries[0].provenance.recordCount, 2);
  assert.deepEqual(entries[0].provenance.passes, ['pass1', 'pass3']);
  assert.notEqual(entries[0].disposition, 'unreviewed');
  assert.equal(entries[0].severityBasis, 'confirmed');
});

test('a pass3 ADJUSTED verdict carries the severity, and the untested one is only recorded', () => {
  const summary = 'The nightly sweep resolves one area, so the deadman is permanently red.';
  const p1 = pass('pass1', [area('a', [finding({
    file: 'monitor/sweep.mjs', line: 90, severity: 'critical', verdict: 'unreviewed', note: '', summary,
  })])]);
  const p3 = pass('pass3', [area('a', [finding({
    file: 'monitor/sweep.mjs', line: 90, severity: 'low', verdict: 'adjusted',
    note: 'reachable only with no primary area declared', summary,
  })])]);

  const { entries } = reconcile([p1, p3], { fixedLedger: [] });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].severity, 'low', 'the second reader adjusted it and that verdict must win');
  assert.equal(entries[0].severityBasis, 'adjusted');
  assert.ok(entries[0].severitiesSeen.includes('critical'), 'the untested severity must still be recorded');
});

test('an absent findings-pass3.json is reported and omitted from inputs, never assumed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-reconcile-p3-'));
  writeFixture(dir);
  const without = spawnSync(process.execPath, [CLI, '--in', dir, '--no-gate'], { encoding: 'utf8' });
  assert.equal(without.status, 0, without.stderr);
  assert.match(without.stdout, /no findings-pass3\.json/, 'a missing optional pass must say so');
  assert.equal(JSON.parse(readFileSync(join(dir, 'queue.json'), 'utf8')).inputs.length, 2);

  // And a pass3 that IS present is hashed into provenance like any other input.
  writeFileSync(join(dir, 'findings-pass3.json'), JSON.stringify([area('one', [finding({
    file: 'bin/a.mjs', line: 1, verdict: 'confirmed', note: 'read at HEAD',
    summary: 'the alpha defect leaks a token into argv',
  })])], null, 2));
  const withP3 = spawnSync(process.execPath, [CLI, '--in', dir, '--no-gate'], { encoding: 'utf8' });
  assert.equal(withP3.status, 0, withP3.stderr);
  const doc = JSON.parse(readFileSync(join(dir, 'queue.json'), 'utf8'));
  assert.equal(doc.inputs.length, 3);
  assert.equal(doc.inputs[2].pass, 'pass3');
  assert.match(doc.inputs[2].sha256, /^[0-9a-f]{64}$/);
});

// ── a cross-file move is its own disposition ─────────────────────────────────
// Operator ruling 2026-10-04. A defect that is still live but no longer in the file it was
// anchored to is neither fixed nor re-pinnable, and leaving it drifted taught the gate to ignore
// it. These pin what `moved` has to mean: re-anchored to the destination, identity unchanged,
// still counted as work.
const movedRow = (o) => ({
  item: 'test move', file: 'admin/index.html', match: /unescaped service names/i,
  to: 'admin/static/panel-posture.js:534', at: 'abc1234', note: 'the client split out', ...o,
});

test('a moved row re-anchors the entry to the destination and keeps its id', () => {
  const summary = 'The tab strip writes unescaped service names into the button markup.';
  const p1 = pass('pass1', [area('a', [finding({ file: 'admin/index.html', line: 335, summary })])]);

  const before = reconcile([p1], { fixedLedger: [], movedLedger: [] }).entries[0];
  const { entries, movedBindings } = reconcile([p1], { fixedLedger: [], movedLedger: [movedRow()] });
  const e = entries[0];

  assert.equal(e.disposition, 'moved');
  assert.equal(e.file, 'admin/static/panel-posture.js');
  assert.equal(e.line, 534);
  assert.equal(e.anchor, 'admin/static/panel-posture.js:534');
  assert.equal(e.verifiedAtHead, 'abc1234', 'the destination line means nothing without the ref it was read at');
  assert.equal(e.movedFrom.anchor, 'admin/index.html:335');
  assert.equal(e.id, before.id, 'the id is sha256(file + summary) — a move must not rename the finding');
  assert.match(e.dispositionReason, /still live, and no longer in admin\/index\.html/);
  assert.deepEqual(movedBindings.map((b) => [b.bound, b.applied.length]), [[1, 1]]);
});

test('a moved row never re-anchors something already judged fixed or refuted', () => {
  const summary = 'The tab strip writes unescaped service names into the button markup.';
  const p1 = pass('pass1', [area('a', [finding({ file: 'admin/index.html', line: 335, summary })])]);
  const fixedLedger = [{ item: 'F1', file: 'admin/index.html', match: /unescaped service names/i, note: 'escaped at the destination' }];

  const { entries, movedBindings } = reconcile([p1], { fixedLedger, movedLedger: [movedRow()] });

  assert.equal(entries[0].disposition, 'fixed', 'closing and relocating are different claims, and closing wins');
  assert.equal(entries[0].file, 'admin/index.html');
  assert.equal(movedBindings[0].applied.length, 0, 'the row bound an entry but correctly applied to none');
});

test('a moved row that binds nothing is reported, not silently dropped', () => {
  const p1 = pass('pass1', [area('a', [finding({ file: 'admin/index.html', line: 335, summary: 'something else entirely about the strip' })])]);
  const { entries, movedBindings } = reconcile([p1], { fixedLedger: [], movedLedger: [movedRow()] });
  assert.equal(entries[0].disposition, 'open');
  assert.deepEqual(movedBindings, [{ item: 'test move', from: 'admin/index.html', to: 'admin/static/panel-posture.js:534', bound: 0, applied: [] }]);
});

test('moved is LIVE: anchor-staleness keeps it in the population it checks', async () => {
  const { LIVE } = await import('../anchor-staleness.mjs');
  assert.ok(LIVE.has('open') && LIVE.has('moved'), 'a moved finding is work, and must stay anchored');
  assert.ok(!LIVE.has('fixed') && !LIVE.has('refuted') && !LIVE.has('unreviewed'));
});

test('a moved entry whose reason holds a backslash before a pipe stays in its own table cell', () => {
  const md = renderMarkdown({
    inputs: [],
    totals: { records: 1, recordsBySource: {}, entries: 1, byDisposition: { moved: 1 }, bySeverity: {}, recordsBySeverity: {} },
    conflicts: { multiRecordAnchors: 0, multiEntryAnchors: [], coLocatedAnchors: [], crossEntryDisagreements: [], unreviewedRecords: 0, unreviewedWithEmptyNote: 0, unreviewedEntries: 0 },
    queue: [{ id: 'q-1', severity: 'high', disposition: 'moved', anchor: 'b.mjs', movedFrom: { anchor: 'a.mjs' },
      dispositionReason: 'moved C:\\x\\|y', summary: 's', provenance: { passes: [], sources: [], verdicts: [] } }],
  });
  const row = md.split('\n').find((l) => l.startsWith('| q-1 |'));
  // GFM splits on every pipe a backslash does not consume; a backslash consumes the next character.
  const cells = row.slice(1, -1).match(/(?:\\.|[^|\\])+/g);
  assert.equal(cells.length, 5, `the reason split the row: ${row}`);
  assert.equal(cells[4].trim().replace(/\\(.)/g, '$1'), 'moved C:\\x\\|y');
});
