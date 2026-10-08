// bin/test/digest.test.mjs — the periodic digest: severity crossings from issue events, ratchet
// breaches from gate journals, failed work from sweep verdicts and in-flight markers. Every input
// absent or silent in the window must read as NOT MEASURED, never as an empty list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { emptyIssuesDoc, mintIssue, mutateIssue, closeIssue, reopenIssue } from '../../monitor/issue-store.mjs';
import { appendRecord } from '../lib/verdict-journal-core.mjs';
import { buildDigest, renderMarkdown, resolveWindow, isBreach, isUndetermined, writeDigest } from '../digest.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'digest.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'cw-digest-'));
test.after(() => rmSync(tmp, { recursive: true, force: true }));
let seq = 0;

const NOW = '2026-03-02T12:00:00.000Z';
const IN = '2026-03-02T06:00:00.000Z';      // inside the default 24h window
const IN2 = '2026-03-02T09:00:00.000Z';
const OLD = '2026-02-20T00:00:00.000Z';     // before it
const ENV = { CW_NOW: NOW };

const src = (k) => ({ kind: 'finding', key: `f:example-repo|osv|${k}|pkg|lock`, tool: 'osv', rule: null });

function issueStore(dir, { ingestedAt = IN, extraArea = false } = {}) {
  const doc = emptyIssuesDoc();
  doc.organisation = 'FIXTURE';
  const mk = (k, severity, at) => mintIssue(doc, { area: 'area-a', repo: 'example-repo', kind: 'vuln', severity, title: `pkg ${k} (example-repo)`, source: src(k) }, at).id;
  const entered = mk('CVE-A', 'high', IN);                  // entered high in window
  mk('CVE-B', 'med', IN);                                    // opened at med: not a crossing
  mk('CVE-OLD', 'crit', OLD);                                // crit, but opened before the window
  const raised = mk('CVE-C', 'low', OLD);
  mutateIssue(doc, raised, (i) => { i.severity = 'med'; }, 'issue-updated', { severity: { from: 'low', to: 'med' } }, IN);
  const unk = mk('CVE-D', 'weird', OLD);
  mutateIssue(doc, unk, (i) => { i.severity = 'crit'; }, 'issue-updated', { severity: { from: 'unknown', to: 'crit' } }, IN2);
  const lowered = mk('CVE-E', 'crit', OLD);
  mutateIssue(doc, lowered, (i) => { i.severity = 'high'; }, 'issue-updated', { severity: { from: 'crit', to: 'high' } }, IN);
  const back = mk('CVE-F', 'high', OLD);
  closeIssue(doc, back, { as: 'accepted', evidence: 'closed for this fixture', at: OLD });
  reopenIssue(doc, back, { at: IN2, reason: 'finding reappeared' });
  doc.lastIngest['area-a'] = { sliceId: 'sweep-20260302060000', generated: ingestedAt };
  if (extraArea) doc.lastIngest['area-b'] = { sliceId: 'sweep-20260220000000', generated: OLD };
  const p = join(dir, 'issues.json');
  writeFileSync(p, JSON.stringify(doc));
  return { path: p, ids: { entered, raised, unk, lowered, back } };
}

function verdicts(dir, recs) {
  mkdirSync(dir, { recursive: true });
  for (const [gate, r] of recs) appendRecord(join(dir, `${gate}.jsonl`), { v: 1, gate, pid: 1, session: null, ...r });
  return dir;
}

const ratchetRecs = () => [
  ['gate-ratchet', { at: OLD, verdict: 'worse', metrics: { drifted: 9 }, baseline: { drifted: 0 } }],
  ['gate-ratchet', { at: IN, verdict: 'steady', metrics: { conflicts: 0, drifted: 0 }, baseline: { conflicts: 0, drifted: 0 } }],
  ['gate-ratchet', { at: IN, verdict: 'worse', exit: 2, metrics: { conflicts: 0, drifted: 2 }, baseline: { conflicts: 0, drifted: 0 } }],
  ['gate-ratchet', { at: IN2, verdict: 'worse', exit: 0, suppressed: true, metrics: { conflicts: 1, drifted: 3 }, baseline: { conflicts: 0, drifted: 0 } }],
  ['gate-tests', { at: IN, verdict: 'regression-committed', exit: 2, baseline: { fail: 4 }, names: ['a', 'b'] }],
  ['gate-tests', { at: IN2, verdict: 'steady', exit: 0 }],
  ['gate-tests', { at: IN2, verdict: 'deferred', exit: 0 }],
];

function reportsTree(dir, { marker = true } = {}) {
  mkdirSync(join(dir, 'area-a'), { recursive: true });
  appendRecord(join(dir, 'area-a', 'sweep-journal.jsonl'), {
    v: 1, kind: 'sweep-area-verdict', at: IN, sliceId: 'sweep-20260302000000', area: 'area-a',
    repos: { resolved: 2, present: 1, scanned: 1, missing: ['repo-gone'], scans: [
      { name: 'repo-one', manifest: 'security-baseline', code: 0, ran: true, why: 'clean' },
      { name: 'repo-one', manifest: 'hermetic-tests', code: 2, ran: false, why: 'commitwork refused before scanning (exit 2)' },
    ] },
    rollup: 'lock-contention', inflightCleared: true,
    issues: { status: 'refused-identity-regression' }, preflight: 'ok', hostInventory: 'unknown', races: 'skipped',
    memoryExport: { state: 'failed', kind: 'broken', reason: '2 receipts failed' },
    canary: { state: 'failed', why: 'harness output unreadable' },
    steps: { codeqlFleet: 'failed', liveness: 'ok' }, finalize: { projectstatus: 'failed', timeline: 'ok' },
  });
  appendRecord(join(dir, 'area-a', 'sweep-journal.jsonl'), {
    v: 1, kind: 'sweep-area-verdict', at: OLD, area: 'area-a', repos: { scans: [{ name: 'old', ran: false, why: 'x' }] },
  });
  appendRecord(join(dir, 'sweep-fleet-journal.jsonl'), {
    v: 1, kind: 'sweep-fleet-verdict', at: IN2, stamp: '20260302080000', areas: [
      { slug: 'area-b', code: 1, secs: 3, timedOut: false }, { slug: 'area-a', code: 0, secs: 9, timedOut: false },
      { slug: 'area-c', code: null, secs: 3600, timedOut: true },
    ], finalize: { compact: 'failed', runtime: 'ok' },
  });
  if (marker) {
    mkdirSync(join(dir, 'area-d'), { recursive: true });
    writeFileSync(join(dir, 'area-d', '.sweep-inflight.json'), JSON.stringify({ pid: 4242, startedAt: OLD, sliceId: 'sweep-20260220000000' }));
    mkdirSync(join(dir, 'area-e'), { recursive: true });
    writeFileSync(join(dir, 'area-e', '.sweep-inflight.json'), JSON.stringify({ pid: 4343, startedAt: IN }));
  }
  return dir;
}

function fixture(opts = {}) {
  const d = join(tmp, `case-${seq++}`);
  mkdirSync(d, { recursive: true });
  const issues = issueStore(d, opts);
  return {
    d, ids: issues.ids,
    args: {
      root: d, env: ENV, issuesPath: issues.path,
      verdictDir: verdicts(join(d, 'verdicts'), ratchetRecs()),
      reportsRoot: reportsTree(join(d, 'reports'), opts),
      pidAlive: (pid) => pid === 4343,
    },
  };
}

test('the window ends at CW_NOW and defaults to the 24 hours before it', () => {
  assert.deepEqual(resolveWindow({ env: ENV }), { since: '2026-03-01T12:00:00.000Z', until: NOW });
  assert.equal(resolveWindow({ env: ENV, since: '2026-03-02T00:00:00Z' }).since, '2026-03-02T00:00:00.000Z');
  assert.throws(() => resolveWindow({ env: ENV, since: 'yesterday-ish' }), RangeError);
  assert.throws(() => resolveWindow({ env: ENV, since: NOW }), RangeError);
});

test('severity crossings: entered, raised and reopened in the window; lowered, sub-high and old events are not', () => {
  const { args, ids } = fixture();
  const s = buildDigest(args).sections.severityCrossings;
  assert.equal(s.status, 'measured');
  const got = Object.fromEntries(s.items.map((i) => [i.issueId, [i.kind, i.from, i.to]]));
  assert.deepEqual(got, {
    [ids.entered]: ['entered', null, 'high'],
    [ids.raised]: ['raised', 'low', 'med'],
    [ids.unk]: ['entered', 'unknown', 'crit'],
    [ids.back]: ['reopened', null, 'high'],
  });
  assert.equal(s.items[0].to, 'crit', 'highest band first');
  assert.ok(!(ids.lowered in got));
});

test('an area whose last ingest predates the window is not measured, and the section says partial', () => {
  const { args } = fixture({ extraArea: true });
  const s = buildDigest(args).sections.severityCrossings;
  assert.equal(s.status, 'partial');
  assert.match(s.notMeasured.join('\n'), /area area-b: no ingest in window/);
  const none = fixture({ ingestedAt: OLD });
  assert.equal(buildDigest(none.args).sections.severityCrossings.status, 'not-measured');
});

test('ratchet breaches group per floor, carry peak and whether the breach still stands', () => {
  const { args } = fixture();
  const s = buildDigest(args).sections.ratchetBreaches;
  assert.equal(s.status, 'measured');
  const by = Object.fromEntries(s.items.map((i) => [`${i.gate}:${i.subject}`, i]));
  assert.deepEqual(Object.keys(by).sort(), ['gate-ratchet:conflicts', 'gate-ratchet:drifted', 'gate-tests:regression-committed']);
  assert.equal(by['gate-ratchet:drifted'].peak, 3, 'the out-of-window 9 is not counted');
  assert.equal(by['gate-ratchet:drifted'].runs, 2);
  assert.equal(by['gate-ratchet:drifted'].standing, true, 'a suppressed worse record is still a breach');
  assert.equal(by['gate-tests:regression-committed'].standing, false, 'a later steady run cleared it');
  assert.equal(by['gate-tests:regression-committed'].latest, 2);
  assert.deepEqual(s.undetermined, [{ gate: 'gate-tests', runs: 1, byVerdict: { deferred: 1 } }]);
});

test('breach and undetermined verdicts are disjoint', () => {
  for (const v of ['worse', 'regression-committed', 'regression-unattributed', 'coverage-dropped']) assert.ok(isBreach(v), v);
  for (const v of ['regression-undetermined', 'regression-disk-undetermined', 'deferred', 'no-tally', 'degraded', 'baseline-unreadable']) {
    assert.ok(isUndetermined(v), v);
    assert.ok(!isBreach(v), v);
  }
  for (const v of ['steady', 'improved', 'coverage-transient', 'regression-pending', 'armed']) assert.ok(!isBreach(v) && !isUndetermined(v), v);
});

test('a gate with only undetermined runs in the window is not measured, never clean', () => {
  const d = join(tmp, `case-${seq++}`);
  const f = fixture();
  const dir = verdicts(join(d, 'v'), [['gate-ratchet', { at: IN, verdict: 'degraded' }], ['gate-tests', { at: OLD, verdict: 'steady' }]]);
  const s = buildDigest({ ...f.args, verdictDir: dir }).sections.ratchetBreaches;
  assert.equal(s.status, 'not-measured');
  assert.match(s.notMeasured.join('\n'), /gate-ratchet: no decided run in window \(1 undetermined/);
  assert.match(s.notMeasured.join('\n'), /gate-tests: no decided run in window/);
});

test('failed work: not-run scans, refused ingest, broken export, failed steps, fleet failures and a dead-pid marker', () => {
  const { args } = fixture();
  const s = buildDigest(args).sections.failedWork;
  assert.equal(s.status, 'measured');
  const rows = s.items.map((i) => `${i.type}|${i.area}|${i.subject}`);
  assert.deepEqual(rows, [
    'canary-failed|area-a|canary',
    'export-failed|area-a|memoryExport',
    'ingest-refused|area-a|issues',
    'repo-missing|area-a|repo-gone',
    'rollup-not-published|area-a|rollup',
    'scan-not-run|area-a|repo-one (hermetic-tests)',
    'step-failed|area-a|finalize.projectstatus',
    'step-failed|area-a|steps.codeqlFleet',
    'area-sweep-failed|area-b|area-b',
    'area-sweep-timed-out|area-c|area-c',
    'step-failed|null|fleet.finalize.compact',
    'sweep-hung|area-d|area-d',
  ]);
  assert.deepEqual(s.undetermined, [{ source: 'sweep verdicts', fields: 1, why: 'verdict fields the sweep never supplied (recorded as unknown)' }]);
  assert.ok(!rows.some((r) => r.includes('old')), 'the out-of-window verdict is not read');
});

test('absent inputs make every section NOT MEASURED, and markdown never prints an empty all-clear', () => {
  const d = join(tmp, `case-${seq++}`);
  mkdirSync(d, { recursive: true });
  const doc = buildDigest({ root: d, env: ENV, issuesPath: join(d, 'nope.json'), verdictDir: join(d, 'nov'), reportsRoot: join(d, 'nor') });
  assert.equal(doc.status, 'not-measured');
  for (const s of Object.values(doc.sections)) {
    assert.equal(s.status, 'not-measured', s.title);
    assert.ok(s.notMeasured.length, s.title);
    assert.ok(s.input.every((i) => i.state === 'absent'), s.title);
  }
  const md = renderMarkdown(doc);
  assert.doesNotMatch(md, /None in window/);
  assert.match(md, /not measured: issue store absent at nope\.json/);
  assert.match(md, /not measured: reports root absent at nor/);
});

test('an unparseable issue store fails closed as not measured, not as zero crossings', () => {
  const f = fixture();
  writeFileSync(f.args.issuesPath, '{ torn');
  const s = buildDigest(f.args).sections.severityCrossings;
  assert.equal(s.status, 'not-measured');
  assert.equal(s.input[0].state, 'unreadable');
  assert.match(s.notMeasured[0], /refusing to treat it as empty/);
});

test('a reports tree with no verdict in the window is not measured', () => {
  const f = fixture({ marker: false });
  const d = join(tmp, `case-${seq++}`);
  mkdirSync(join(d, 'area-a'), { recursive: true });
  appendRecord(join(d, 'area-a', 'sweep-journal.jsonl'), { v: 1, kind: 'sweep-area-verdict', at: OLD, area: 'area-a' });
  const s = buildDigest({ ...f.args, reportsRoot: d }).sections.failedWork;
  assert.equal(s.status, 'not-measured');
  assert.match(s.notMeasured.join('\n'), /no sweep verdict recorded in window \(1 journal/);
});

test('same inputs produce a byte-identical document and digestId', () => {
  const { args } = fixture();
  const a = buildDigest(args);
  const b = buildDigest(args);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.match(a.digestId, /^[0-9a-f]{64}$/);
  assert.equal(a.generatedAt, NOW);
  assert.equal(a.headlines.length, 3);
  assert.equal(renderMarkdown(a), renderMarkdown(b));
});

test('writeDigest lands both files atomically under reports/digest', () => {
  const { args } = fixture();
  const doc = buildDigest(args);
  const w = writeDigest(doc, { reportsRoot: args.reportsRoot });
  assert.match(w.json, /digest[/\\]digest-20260302T120000Z\.json$/);
  assert.deepEqual(readdirSync(join(args.reportsRoot, 'digest')).sort(), ['digest-20260302T120000Z.json', 'digest-20260302T120000Z.md']);
});

test('CLI: env overrides read at call time, exit 20 when not measured, exit 2 on usage', () => {
  const d = join(tmp, `case-${seq++}`);
  mkdirSync(d, { recursive: true });
  const env = { ...process.env, CW_NOW: NOW, CW_ISSUES: join(d, 'i.json'), CW_VERDICT_DIR: join(d, 'v'), CW_REPORTS_ROOT: join(d, 'r') };
  const r = spawnSync(process.execPath, [CLI, '--json'], { env, encoding: 'utf8' });
  assert.equal(r.status, 20, r.stderr);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schema, 'commitwork.digest/1');
  assert.equal(doc.window.until, NOW);
  assert.equal(doc.sections.failedWork.input[0].state, 'absent');
  assert.equal(spawnSync(process.execPath, [CLI, '--since', 'not-a-date'], { env, encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [CLI, '--bogus'], { env, encoding: 'utf8' }).status, 2);
});
