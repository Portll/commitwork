// bin/test/issue.test.mjs — the ingest auto-close decision table (evidence-gated, never
// absence-gated) and the CLI's exit-code contract. Table cases call ingestArea directly; CLI
// cases spawn the real CLI against a temp store — monitor/issues.json is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { emptyIssuesDoc, loadIssues, identityProblems } from '../../monitor/issue-store.mjs';
import { ingestArea } from '../../monitor/issue-ingest.mjs';
import { hashLine } from '../../lib/anchor-hash.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CLI = join(REPO, 'bin', 'issue.mjs');

const NOW = '2026-08-02T12:00:00.000Z';
const hoursBefore = (h) => new Date(new Date(NOW).getTime() - h * 3600_000).toISOString();
const AREA = 'fixture-area';

// ── fixtures ─────────────────────────────────────────────────────────────────
// A finding carries every field the real rollup does; `state: born` is OPEN.
const finding = (o = {}) => ({
  key: 'r1|lodash|GHSA-1111', state: 'born', severity: 'high', repo: 'r1',
  package: 'lodash', version: '4.17.0', id: 'GHSA-1111', title: 'prototype pollution',
  tool: 'osv', fixed: '4.17.21', ...o,
});
const row = (o = {}) => ({
  repo: 'r1', rule: 'no-eval', file: 'src/app.js', line: 2, sev: 'high', message: 'eval() used', ...o,
});
const mkRollup = (o = {}) => ({
  sliceId: 'sweep-1', generated: hoursBefore(2), repos: [], scanners: {}, scannerFindings: {}, ...o,
});
const withFindings = (findings, o = {}) =>
  mkRollup({ repos: [{ name: 'r1', findings }], ...o });
const ledgerOf = (...entries) => ({
  entries: entries.map(([key, tier], i) => ({
    key, evidence: { tier, detail: `${tier} evidence for ${key}` }, resolvedSlice: 'sweep-2', at: hoursBefore(1 + i),
  })),
});
const ingest = (doc, over = {}) => ingestArea(doc, {
  areaSlug: AREA, rollup: null, ledger: null, annotations: [], repoPaths: {},
  now: NOW, minSev: 'high', staleHours: 26, ...over,
});
const soleIssue = (doc) => {
  const ids = Object.keys(doc.issues);
  assert.equal(ids.length, 1, `expected exactly one issue, have ${ids.length}`);
  return doc.issues[ids[0]];
};

// ── nothing-happened statuses (explicit uncertainty) ─────────────────────────────────
test('ingestArea: no rollup / rollup missing its identity → no-rollup, doc untouched', () => {
  const doc = emptyIssuesDoc();
  const before = JSON.stringify(doc);
  assert.equal(ingest(doc, { rollup: null }).status, 'no-rollup');
  assert.equal(ingest(doc, { rollup: {} }).status, 'no-rollup');
  assert.equal(ingest(doc, { rollup: { sliceId: 's', repos: [] } }).status, 'no-rollup'); // no generated
  assert.equal(JSON.stringify(doc), before);
});

test('ingestArea: a rollup older than staleHours → stale-rollup, doc untouched', () => {
  const doc = emptyIssuesDoc();
  const before = JSON.stringify(doc);
  const s = ingest(doc, { rollup: withFindings([finding()], { generated: hoursBefore(27) }), staleHours: 26 });
  assert.equal(s.status, 'stale-rollup');
  assert.equal(s.rollupGenerated, hoursBefore(27));
  assert.equal(JSON.stringify(doc), before);
});

test('ingestArea: re-ingesting the same slice → not-newer (A1), doc untouched', () => {
  const doc = emptyIssuesDoc();
  const rollup = withFindings([finding()]);
  assert.equal(ingest(doc, { rollup }).status, 'ok');
  const before = JSON.stringify(doc);
  const s = ingest(doc, { rollup });
  assert.equal(s.status, 'not-newer');
  assert.deepEqual(s.lastIngest, { sliceId: 'sweep-1', generated: rollup.generated });
  assert.equal(JSON.stringify(doc), before);
});

// ── filing ───────────────────────────────────────────────────────────────────
test('crit/high dep findings file individually under f:<key>, vocab normalised at the door', () => {
  const doc = emptyIssuesDoc();
  const s = ingest(doc, {
    rollup: withFindings([
      finding({ key: 'r1|a|ADV-1', id: 'ADV-1', package: 'a', severity: 'critical' }),
      finding({ key: 'r1|b|ADV-2', id: 'ADV-2', package: 'b', severity: 'high' }),
    ]),
  });
  assert.equal(s.status, 'ok');
  assert.equal(s.created.length, 2);
  const critIss = doc.issues[doc.byKey['f:r1|a|ADV-1']];
  assert.equal(critIss.severity, 'crit'); // 'critical' → 'crit'
  assert.equal(critIss.kind, 'vuln');
  assert.equal(critIss.source.kind, 'finding');
  assert.equal(doc.issues[doc.byKey['f:r1|b|ADV-2']].severity, 'high');
});

test('med/low dep findings group per repo|package: one g: issue, sorted members, worst severity', () => {
  const doc = emptyIssuesDoc();
  const s = ingest(doc, {
    rollup: withFindings([
      finding({ key: 'r1|lodash|ADV-9', id: 'ADV-9', severity: 'low' }),
      finding({ key: 'r1|lodash|ADV-2', id: 'ADV-2', severity: 'medium' }),
    ]),
  });
  assert.equal(s.created.length, 1);
  const iss = doc.issues[doc.byKey['g:r1|lodash']];
  assert.ok(iss, 'grouped issue must be keyed g:repo|pkg');
  assert.deepEqual(iss.groupMembers, ['f:r1|lodash|ADV-2', 'f:r1|lodash|ADV-9']); // sorted
  assert.equal(iss.severity, 'med'); // worst of medium/low, normalised
});

test('scanner rows file only when their category provably ran (scanners[cat].ran > 0)', () => {
  const ran = emptyIssuesDoc();
  ingest(ran, { rollup: mkRollup({ scanners: { sast: { ran: 1 } }, scannerFindings: { sast: [row()] } }) });
  const iss = soleIssue(ran);
  assert.equal(iss.source.key, 'sc:r1|sast|no-eval|src/app.js');   // line-free identity — D12, 2026-08-13
  assert.equal(iss.source.kind, 'scanner-row');
  assert.equal(iss.kind, 'code');

  const notRan = emptyIssuesDoc();
  const s = ingest(notRan, { rollup: mkRollup({ scanners: {}, scannerFindings: { sast: [row()] } }) });
  assert.deepEqual(Object.keys(notRan.issues), []);
  assert.deepEqual(s.skippedCategories, ['sast']);
});

// ── auto-close: dep findings (evidence-gated, never absence-gated) ───────────
test('a dep issue closes on ledger tier strong for its exact raw key', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: withFindings([finding()]) });
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }),
    ledger: ledgerOf(['r1|lodash|GHSA-1111', 'strong']),
  });
  const iss = soleIssue(doc);
  assert.deepEqual(s.closed, [iss.id]);
  assert.equal(iss.state, 'closed');
  assert.equal(iss.closedAs, 'fixed');
  assert.equal(iss.evidence[iss.evidence.length - 1].tier, 'strong');
});

test('tier medium also closes', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: withFindings([finding()]) });
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }),
    ledger: ledgerOf(['r1|lodash|GHSA-1111', 'medium']),
  });
  assert.equal(soleIssue(doc).state, 'closed');
  assert.equal(s.closed.length, 1);
});

test('tier weak = merely absent: one scan-absent entry, STAYS OPEN; same sliceId never stacks', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: withFindings([finding()], { generated: hoursBefore(3) }) });
  const weak = { ledger: ledgerOf(['r1|lodash|GHSA-1111', 'weak']) };
  const s1 = ingest(doc, { rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(2) }), ...weak });
  const iss = soleIssue(doc);
  assert.equal(iss.state, 'open');
  assert.equal(s1.carried, 1);
  assert.deepEqual(s1.closed, []);
  const absents = () => iss.evidence.filter((e) => e.tier === 'scan-absent');
  assert.equal(absents().length, 1);
  assert.equal(absents()[0].sliceId, 'sweep-2');
  // the SAME slice content re-rolled with a newer generated stamp must not stack duplicates
  ingest(doc, { rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }), ...weak });
  assert.equal(absents().length, 1);
  assert.equal(iss.state, 'open');
});

test('no ledger row at all: stays open and summary.carried counts it', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: withFindings([finding()]) });
  const s = ingest(doc, { rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }), ledger: null });
  assert.equal(soleIssue(doc).state, 'open');
  assert.equal(s.carried, 1);
  assert.deepEqual(s.closed, []);
});

// ── auto-close: scanner rows (anchor-drift-gated) ────────────────────────────
function anchoredFixture() {
  const repoDir = mkdtempSync(join(tmpdir(), 'cw-anchor-'));
  mkdirSync(join(repoDir, 'src'), { recursive: true });
  writeFileSync(join(repoDir, 'src', 'app.js'), 'line one\nconst x = eval(input)\nline three\n');
  const doc = emptyIssuesDoc();
  ingest(doc, {
    rollup: mkRollup({ scanners: { sast: { ran: 1 } }, scannerFindings: { sast: [row()] } }),
    repoPaths: { r1: repoDir },
  });
  const iss = soleIssue(doc);
  assert.deepEqual(iss.anchor, { file: 'src/app.js', line: 2, hash: hashLine('const x = eval(input)') });
  return { repoDir, doc, iss };
}

test('row absent + anchored line CHANGED → closed with evidence tier anchor-drift', () => {
  const { repoDir, doc, iss } = anchoredFixture();
  writeFileSync(join(repoDir, 'src', 'app.js'), 'line one\nconst x = JSON.parse(input)\nline three\n');
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: { sast: { ran: 1 } }, scannerFindings: { sast: [] } }),
    repoPaths: { r1: repoDir },
  });
  assert.deepEqual(s.closed, [iss.id]);
  assert.equal(iss.state, 'closed');
  assert.equal(iss.closedAs, 'fixed');
  const last = iss.evidence[iss.evidence.length - 1];
  assert.equal(last.tier, 'anchor-drift');
  assert.equal(last.detail, 'anchored line changed');
});

test('row absent + line UNCHANGED → suspect, stays open (rule drift can silence a scanner)', () => {
  const { repoDir, doc, iss } = anchoredFixture();
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: { sast: { ran: 1 } }, scannerFindings: { sast: [] } }),
    repoPaths: { r1: repoDir },
  });
  assert.equal(iss.state, 'open');
  assert.equal(iss.suspect, true);
  assert.deepEqual(s.suspect, [iss.id]);
  assert.deepEqual(s.closed, []);
  assert.equal(s.carried, 1);
  assert.equal(iss.evidence[iss.evidence.length - 1].tier, 'scan-absent');
});

test('A5: category missing from rollup.scanners — rows skipped AND absence proves nothing', () => {
  const { repoDir, doc, iss } = anchoredFixture();
  writeFileSync(join(repoDir, 'src', 'app.js'), 'entirely\nrewritten\nfile\n'); // even a drifted anchor must not close
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: {}, scannerFindings: { sast: [] } }),
    repoPaths: { r1: repoDir },
  });
  assert.deepEqual(s.skippedCategories, ['sast']);
  assert.equal(iss.state, 'open');
  assert.equal(iss.suspect, false);
  assert.deepEqual(s.closed, []);
  assert.deepEqual(s.suspect, []);
  assert.equal(s.carried, 1);
  assert.equal(iss.evidence.length, 0); // untouched: not even scan-absent — the tool did not run
});

// ── A5, the CARRIED case ─────────────────────────────────────────────────────
// A carried category chains the previous slice's counts and rows forward — ran>0 without running.
test('A5: a CARRIED category has ran>0 but did not run — a drifted anchor must NOT close', () => {
  const { repoDir, doc, iss } = anchoredFixture();
  writeFileSync(join(repoDir, 'src', 'app.js'), 'entirely\nrewritten\nfile\n'); // would close if ran
  const s = ingest(doc, {
    rollup: mkRollup({
      sliceId: 'sweep-2', generated: hoursBefore(1),
      scanners: { sast: { ran: 1, carried: true, carriedFrom: 'sweep-1' } },
      scannerFindings: { sast: [] },
    }),
    repoPaths: { r1: repoDir },
  });
  assert.deepEqual(s.skippedCategories, ['sast']);
  assert.equal(s.skippedReasons.sast, 'carried', 'carried and not-ran are different facts');
  assert.equal(iss.state, 'open');
  assert.equal(iss.suspect, false);
  assert.deepEqual(s.closed, []);
  assert.deepEqual(s.suspect, []);
  assert.equal(s.carried, 1);
  assert.equal(iss.evidence.length, 0); // untouched, exactly like the never-ran case
});

test('A5: a carried category files NOTHING — chained rows are a previous slice\'s, not evidence', () => {
  const doc = emptyIssuesDoc();
  const s = ingest(doc, {
    rollup: mkRollup({
      scanners: { sast: { ran: 1, carried: true, carriedFrom: 'sweep-0' } },
      scannerFindings: { sast: [row()] },
    }),
  });
  assert.deepEqual(Object.keys(doc.issues), [], 'a carried row must not mint an issue');
  assert.deepEqual(s.skippedCategories, ['sast']);
  assert.equal(s.skippedReasons.sast, 'carried');
});

test('a category missing from scanners reports not-ran, distinctly from carried', () => {
  const doc = emptyIssuesDoc();
  const s = ingest(doc, { rollup: mkRollup({ scanners: {}, scannerFindings: { sast: [row()] } }) });
  assert.equal(s.skippedReasons.sast, 'not-ran');
});

// ── reopen, not duplicate ────────────────────────────────────────────────────
test('a closed issue whose finding key reappears REOPENS under the same ISS id', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: withFindings([finding()], { generated: hoursBefore(3) }) });
  const id = soleIssue(doc).id;
  ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(2) }),
    ledger: ledgerOf(['r1|lodash|GHSA-1111', 'strong']),
  });
  assert.equal(doc.issues[id].state, 'closed');
  const s = ingest(doc, { rollup: withFindings([finding()], { sliceId: 'sweep-3', generated: hoursBefore(1) }) });
  assert.deepEqual(s.reopened, [id]);
  assert.deepEqual(s.created, []);
  assert.equal(doc.issues[id].state, 'open');
  assert.equal(doc.issues[id].reopenCount, 1);
  assert.equal(Object.keys(doc.issues).length, 1); // no second id minted
  assert.equal(doc.byKey['f:r1|lodash|GHSA-1111'], id); // index unchanged
});

// ── grouped close ────────────────────────────────────────────────────────────
const groupedDoc = () => {
  const doc = emptyIssuesDoc();
  ingest(doc, {
    rollup: withFindings([
      finding({ key: 'r1|lodash|ADV-1', id: 'ADV-1', severity: 'med' }),
      finding({ key: 'r1|lodash|ADV-2', id: 'ADV-2', severity: 'med' }),
    ]),
  });
  return { doc, iss: doc.issues[doc.byKey['g:r1|lodash']] };
};

test('a grouped issue closes only when EVERY member has strong/medium ledger evidence', () => {
  const { doc, iss } = groupedDoc();
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }),
    ledger: ledgerOf(['r1|lodash|ADV-1', 'strong'], ['r1|lodash|ADV-2', 'strong']),
  });
  assert.deepEqual(s.closed, [iss.id]);
  assert.equal(iss.state, 'closed');
  assert.equal(iss.closedAs, 'fixed');
});

test('one member without ledger proof: absent-but-unproven, grouped issue stays open', () => {
  const { doc, iss } = groupedDoc();
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }),
    ledger: ledgerOf(['r1|lodash|ADV-1', 'strong']), // ADV-2 has no row
  });
  assert.equal(iss.state, 'open');
  assert.equal(s.carried, 1);
  assert.equal(iss.evidence[iss.evidence.length - 1].tier, 'scan-absent');
});

test('one member still open in the slice: grouped issue is left alone', () => {
  const { doc, iss } = groupedDoc();
  const s = ingest(doc, {
    rollup: withFindings([finding({ key: 'r1|lodash|ADV-2', id: 'ADV-2', severity: 'med' })],
      { sliceId: 'sweep-2', generated: hoursBefore(1) }),
    ledger: ledgerOf(['r1|lodash|ADV-1', 'strong']),
  });
  assert.equal(iss.state, 'open');
  assert.deepEqual(s.closed, []);
});

// ── the CLI: exit codes and --json shapes ────────────────────────────────────
// Each CLI test gets its own temp store; the registry fixture is the minimal valid shape.
function cliFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cw-issue-cli-'));
  const regPath = join(dir, 'projects.json');
  writeFileSync(regPath, JSON.stringify({
    reportsRoot: 'reports', roots: [], projects: [], areas: [{ slug: AREA }],
  }));
  const env = {
    ...process.env,
    CW_ISSUES: join(dir, 'issues.json'),
    CW_NOW: NOW,
    CW_REGISTRY: regPath,
    CW_ISSUE_MIN_SEV: 'high',
    CW_ISSUE_STALE_HOURS: '26',
    CW_ISSUE_CLAIM_TTL_HOURS: '4',
    CW_ROLLUP: join(dir, 'rollup.json'),
    CW_LEDGER: join(dir, 'no-ledger.json'),
    CW_ANNOTATIONS: join(dir, 'no-annotations.json'),
  };
  const run = (args, over = {}) =>
    spawnSync(process.execPath, [CLI, ...args], { cwd: REPO, encoding: 'utf8', env: { ...env, ...over } });
  const mint = () => {
    const r = run(['new', '--area', AREA, '--title', 'a cli defect', '--sev', 'high', '--class', 'F']);
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  return { dir, env, run, mint };
}

test('CLI: unknown command exits 2', () => {
  const { run } = cliFixture();
  const r = run(['frobnicate']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown command/);
});

test('CLI: verify on a clean store exits 0; a hand-tampered store exits 3', () => {
  const { env, run, mint } = cliFixture();
  mint();
  assert.equal(run(['verify']).status, 0);
  const store = JSON.parse(readFileSync(env.CW_ISSUES, 'utf8'));
  store.events[0].data.title = 'rewritten history'; // schema-valid, chain-invalid
  writeFileSync(env.CW_ISSUES, JSON.stringify(store));
  const r = run(['verify']);
  assert.equal(r.status, 3);
  assert.match(r.stderr, /hash mismatch/);
});

test('CLI: ingest --area with CW_ROLLUP at a missing path exits 4 (no-rollup, explicit uncertainty)', () => {
  const { dir, run } = cliFixture();
  const r = run(['ingest', '--area', AREA, '--no-anchors', '--json'],
    { CW_ROLLUP: join(dir, 'does-not-exist.json') });
  assert.equal(r.status, 4, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.summaries[0].status, 'no-rollup');
});

test('CLI: ingest --all visits every registry area by its slug', () => {
  // allAreas() already returns slugs; mapping them through `.slug` again iterated undefineds.
  const { dir, env, run } = cliFixture();
  writeFileSync(env.CW_REGISTRY, JSON.stringify({
    reportsRoot: 'reports', roots: [], projects: [], areas: [{ slug: AREA }, { slug: 'fixture-area-two' }],
  }));
  const r = run(['ingest', '--all', '--no-anchors', '--json'],
    { CW_ROLLUP: join(dir, 'does-not-exist.json') });
  assert.equal(r.status, 4, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.summaries.map((s) => s.area), [AREA, 'fixture-area-two']);
  assert.ok(out.summaries.every((s) => s.status === 'no-rollup'));
});

test('CLI: two claims from different --session — the second exits 5 (CLAIM_CONFLICT)', () => {
  const { run, mint } = cliFixture();
  const id = mint();
  assert.equal(run(['claim', id, '--by', 'alice', '--session', 's1']).status, 0);
  const r = run(['claim', id, '--by', 'bob', '--session', 's2']);
  assert.equal(r.status, 5);
  assert.match(r.stderr, /claimed by alice/);
});

test('CLI: close without --evidence exits 2 and mutates nothing', () => {
  const { env, run, mint } = cliFixture();
  const id = mint();
  const r = run(['close', id, '--as', 'fixed']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /requires --evidence/);
  const store = JSON.parse(readFileSync(env.CW_ISSUES, 'utf8'));
  assert.equal(store.issues[id].state, 'open');
});

test('CLI: ready --json emits {generated, areaStatus, count, issues}', () => {
  const { run, mint } = cliFixture();
  const id = mint();
  const r = run(['ready', '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(Object.keys(out), ['generated', 'areaStatus', 'count', 'issues']);
  assert.equal(out.generated, NOW);
  assert.equal(out.count, 1);
  assert.equal(out.issues[0].id, id);
});

test('CLI: list --json reports never-ingested for an area with no ingest history', () => {
  const { run, mint } = cliFixture();
  mint();
  const r = run(['list', '--area', AREA, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.areaStatus[AREA], 'never-ingested');
});

test('CLI: ingest is idempotent — second run of the same rollup reports not-newer and exits 4', () => {
  const { env, run } = cliFixture();
  writeFileSync(env.CW_ROLLUP, JSON.stringify(withFindings([finding({ severity: 'crit' })])));
  const first = run(['ingest', '--area', AREA, '--no-anchors', '--json']);
  assert.equal(first.status, 0, first.stderr);
  const out1 = JSON.parse(first.stdout);
  assert.equal(out1.summaries[0].status, 'ok');
  assert.equal(out1.summaries[0].created.length, 1);
  const bytesAfterFirst = readFileSync(env.CW_ISSUES, 'utf8');

  // statuses !== 'ok' set exit 4 — replaying a slice is refused, not silently re-applied
  const second = run(['ingest', '--area', AREA, '--no-anchors', '--json']);
  assert.equal(second.status, 4, second.stderr);
  const out2 = JSON.parse(second.stdout);
  assert.equal(out2.summaries[0].status, 'not-newer');
  assert.equal(readFileSync(env.CW_ISSUES, 'utf8'), bytesAfterFirst); // byte-identical store
});

// ── per-category grouping (gs:) — one issue per (repo, category, rule) ───────
// The remediation unit is the DETECTOR per repo, so that is the issue.
const secretsRollup = (rows, o = {}) => mkRollup({
  scanners: { secretsHistory: { ran: 1 } },
  scannerFindings: { secretsHistory: rows },
  ...o,
});
const GROUPS = new Set(['secretsHistory']);

test('a grouped category files ONE gs: issue per (repo, category, rule) — sorted members, count in title, worst severity', () => {
  const doc = emptyIssuesDoc();
  const s = ingest(doc, {
    rollup: secretsRollup([
      row({ rule: 'generic-api-key', file: 'a.js', line: 1, sev: 'high' }),
      row({ rule: 'generic-api-key', file: 'b.js', line: 9, sev: 'crit' }),
      row({ rule: 'generic-api-key', file: 'c.js', line: 3, sev: 'high' }),
      row({ rule: 'private-key', file: 'k.pem', line: 1, sev: 'high' }),
    ]),
    groupCategories: GROUPS,
  });
  assert.equal(s.created.length, 2); // one per rule, not one per row
  const apiKey = Object.values(doc.issues).find((i) => i.source.key === 'gs:r1|secretsHistory|generic-api-key');
  assert.ok(apiKey, 'gs: issue exists');
  assert.equal(apiKey.severity, 'crit'); // worst of the members
  assert.equal(apiKey.title, 'generic-api-key [secretsHistory] (r1) — 3 hits');
  assert.deepEqual(apiKey.groupMembers, [...apiKey.groupMembers].sort());
  assert.equal(apiKey.groupMembers.length, 3);
  assert.equal(apiKey.source.kind, 'scanner-row');
});

test('grouped membership refreshes on a newer slice: count and title track the live rows', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: secretsRollup([row({ rule: 'generic-api-key', file: 'a.js', line: 1 })]), groupCategories: GROUPS });
  const id = doc.byKey['gs:r1|secretsHistory|generic-api-key'];
  ingest(doc, {
    rollup: secretsRollup(
      [row({ rule: 'generic-api-key', file: 'a.js', line: 1 }), row({ rule: 'generic-api-key', file: 'z.js', line: 7 })],
      { sliceId: 'sweep-2', generated: hoursBefore(1) },
    ),
    groupCategories: GROUPS,
  });
  assert.equal(doc.byKey['gs:r1|secretsHistory|generic-api-key'], id); // same issue, no duplicate
  assert.equal(doc.issues[id].groupMembers.length, 2);
  assert.match(doc.issues[id].title, /2 hits$/);
});

test('all grouped members absent + category ran → SUSPECT, stays open, never auto-closes', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: secretsRollup([row({ rule: 'generic-api-key', file: 'a.js', line: 1 })]), groupCategories: GROUPS });
  const id = doc.byKey['gs:r1|secretsHistory|generic-api-key'];
  const s = ingest(doc, {
    rollup: secretsRollup([], { sliceId: 'sweep-2', generated: hoursBefore(1) }),
    groupCategories: GROUPS,
  });
  assert.equal(doc.issues[id].state, 'open');
  assert.equal(doc.issues[id].suspect, true);
  assert.ok(s.suspect.includes(id));
  assert.equal(s.closed.length, 0);
  assert.equal(doc.issues[id].evidence.at(-1).tier, 'scan-absent');
});

test('grouped issue with its category NOT ran is carried untouched — absence proves nothing (A5)', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: secretsRollup([row({ rule: 'generic-api-key', file: 'a.js', line: 1 })]), groupCategories: GROUPS });
  const id = doc.byKey['gs:r1|secretsHistory|generic-api-key'];
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1) }), // no scanners at all
    groupCategories: GROUPS,
  });
  assert.equal(doc.issues[id].state, 'open');
  assert.equal(doc.issues[id].suspect, false); // not even suspect — the tool never looked
  assert.equal(s.suspect.length, 0);
  assert.ok(s.carried >= 1);
});

test('volume threshold: a rule firing >= threshold rows groups even outside always-group categories', () => {
  const doc = emptyIssuesDoc();
  const rows = [1, 2, 3, 4, 5, 6].map((n) => row({ rule: 'js/missing-rate-limiting', file: `f${n}.js`, line: n }));
  const s = ingest(doc, {
    rollup: mkRollup({ scanners: { sastCodeql: { ran: 1 } }, scannerFindings: { sastCodeql: rows } }),
    groupCategories: new Set(), groupThreshold: 5,
  });
  assert.equal(s.created.length, 1);
  const iss = Object.values(doc.issues)[0];
  assert.equal(iss.source.key, 'gs:r1|sastCodeql|js/missing-rate-limiting');
  assert.equal(iss.groupMembers.length, 6);
});

test('below the threshold files individually with anchors intact', () => {
  const doc = emptyIssuesDoc();
  const rows = [1, 2].map((n) => row({ rule: 'js/sql-injection', file: `f${n}.js`, line: n }));
  const s = ingest(doc, {
    rollup: mkRollup({ scanners: { sastCodeql: { ran: 1 } }, scannerFindings: { sastCodeql: rows } }),
    groupCategories: new Set(), groupThreshold: 5,
  });
  assert.equal(s.created.length, 2);
  assert.ok(Object.values(doc.issues).every((i) => i.source.key.startsWith('sc:')));
});

test('sticky identity: existing individual sc: issues keep the triple individual even at storm volume', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, {
    rollup: mkRollup({ scanners: { sastCodeql: { ran: 1 } }, scannerFindings: { sastCodeql: [row({ rule: 'js/x', file: 'a.js', line: 1 })] } }),
    groupCategories: new Set(), groupThreshold: 5,
  });
  const storm = [1, 2, 3, 4, 5, 6, 7].map((n) => row({ rule: 'js/x', file: n === 1 ? 'a.js' : `f${n}.js`, line: n === 1 ? 1 : n }));
  ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: { sastCodeql: { ran: 1 } }, scannerFindings: { sastCodeql: storm } }),
    groupCategories: new Set(), groupThreshold: 5,
  });
  assert.equal(Object.keys(doc.issues).length, 7); // 7 individual, no gs: duplicate on top
  assert.ok(!Object.keys(doc.byKey).some((k) => k.startsWith('gs:')));
});

test('sticky identity: an existing gs: issue stays grouped when the storm subsides below threshold', () => {
  const doc = emptyIssuesDoc();
  const storm = [1, 2, 3, 4, 5, 6].map((n) => row({ rule: 'js/x', file: `f${n}.js`, line: n }));
  ingest(doc, {
    rollup: mkRollup({ scanners: { sastCodeql: { ran: 1 } }, scannerFindings: { sastCodeql: storm } }),
    groupCategories: new Set(), groupThreshold: 5,
  });
  const gsId = doc.byKey['gs:r1|sastCodeql|js/x'];
  ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: { sastCodeql: { ran: 1 } }, scannerFindings: { sastCodeql: storm.slice(0, 2) } }),
    groupCategories: new Set(), groupThreshold: 5,
  });
  assert.equal(Object.keys(doc.issues).length, 1); // still just the group
  assert.equal(doc.issues[gsId].groupMembers.length, 2);
  assert.match(doc.issues[gsId].title, /2 hits$/);
});

// ── a scanner whose rows carry no `rule` must not brick the store ────────────
test('a grouped row with no `rule` files a SCHEMA-VALID record, and the title says so', () => {
  const doc = emptyIssuesDoc();
  // retire.js shape: component + id, never rule. Above the group threshold so it takes the gs: path.
  const rows = Array.from({ length: 6 }, (_, i) => ({
    repo: 'r1', component: 'lodash', id: 'CVE-2021-23337', sev: 'high',
    file: `node_modules/lodash/f${i}.js`, message: 'template injection',
  }));
  ingest(doc, { rollup: mkRollup({ scanners: { depsRetire: { ran: 1 } }, scannerFindings: { depsRetire: rows } }) });
  const iss = soleIssue(doc);
  assert.ok('rule' in iss.source, 'source.rule is required by the schema — undefined is not null');
  assert.equal(iss.source.rule, null);
  assert.match(iss.title, /^component=lodash,id=CVE-2021-23337 \[depsRetire\]/,
    'the identity label stands in for the rule the scanner never names');

  // the whole store must round-trip through the real loader, which is what actually broke
  const p = join(mkdtempSync(join(tmpdir(), 'cw-iss-')), 'issues.json');
  writeFileSync(p, JSON.stringify(doc));
  assert.doesNotThrow(() => loadIssues({ path: p }), 'the store must still load');
});

test('the group key carries the identity tuple for rule-less scanners — the |undefined freeze is lifted', () => {
  // Frozen at |undefined until the operator-ruled migration re-keyed/split the live records
  // (bin/issue-rekey-depsretire.mjs); mint and migration share scannerGroupKeyFor.
  const doc = emptyIssuesDoc();
  const rows = Array.from({ length: 6 }, (_, i) => ({
    repo: 'r1', component: 'lodash', id: 'CVE-1', sev: 'high', file: `n/f${i}.js`,
  }));
  ingest(doc, { rollup: mkRollup({ scanners: { depsRetire: { ran: 1 } }, scannerFindings: { depsRetire: rows } }) });
  assert.ok(doc.byKey['gs:r1|depsRetire|component=lodash,id=CVE-1'], 'the key names the identity, not "undefined"');
  assert.equal(doc.byKey['gs:r1|depsRetire|undefined'], undefined, 'and the legacy shape is no longer minted');
  // two identities now bucket separately — one group per (repo, category, identity)
  const rows2 = rows.map((r, i) => (i < 3 ? r : { ...r, component: 'underscore.js', id: 'CVE-2' }));
  const doc2 = emptyIssuesDoc();
  ingest(doc2, { rollup: mkRollup({ scanners: { depsRetire: { ran: 1 } }, scannerFindings: { depsRetire: rows2 } }), groupThreshold: 3 });
  assert.equal(Object.keys(doc2.issues).length, 2, 'distinct identities must never share one group issue');
});

const rowAt = (line, o = {}) => row({ line, ...o });

// ── movement, after D12 (operator ruling, 2026-08-13) ────────────────────────────────────────
// `identityFor` is (rule, file), so a moved row mints the SAME key — the move machinery is gone.
// `moved`/`ambiguousMoves` in the ingest summary are inert; removal is filed, not done here.

test('a row at a NEW LINE is the same issue — no move to detect, because identity did not change', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: mkRollup({ scanners: { sast: { ran: 1 } }, scannerFindings: { sast: [rowAt(2)] } }) });
  const id = soleIssue(doc).id;
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: { sast: { ran: 1 } }, scannerFindings: { sast: [rowAt(9)] } }),
  });
  assert.deepEqual(s.created, [], 'a moved row must not mint a duplicate — the defect this all guards');
  assert.equal(Object.keys(doc.issues).length, 1, 'and must not become a second issue');
  assert.equal(doc.issues[id].source.key, 'sc:r1|sast|no-eval|src/app.js', 'the key never moved');
  assert.equal(doc.byKey['sc:r1|sast|no-eval|src/app.js'], id);
  assert.equal(s.moved ?? 0, 0, 'nothing to re-point: the row moved, the identity did not');
  assert.deepEqual(identityProblems(doc), []);
});

test('THREE rows of one rule in one file are ONE finding — the ambiguity cannot arise (D12)', () => {
  // per-line granularity was traded for identity stability (D12)
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: mkRollup({ scanners: { sast: { ran: 1 } },
    scannerFindings: { sast: [rowAt(2), rowAt(20), rowAt(40)] } }) });
  assert.equal(Object.keys(doc.issues).length, 1, 'one place, one issue');
  const id = soleIssue(doc).id;

  // two occurrences vanish and a new line appears — the place is still occupied by the same issue
  const s = ingest(doc, {
    rollup: mkRollup({ sliceId: 'sweep-2', generated: hoursBefore(1), scanners: { sast: { ran: 1 } },
      scannerFindings: { sast: [rowAt(2), rowAt(77)] } }),
  });
  assert.deepEqual(s.created, [], 'no new finding — nothing appeared that was not already here');
  assert.equal(s.moved ?? 0, 0, 'and no move, because identity did not change');
  assert.equal(Object.keys(doc.issues).length, 1, 'still one issue');
  assert.equal(doc.issues[id].state, 'open', 'and it did not auto-close on the occurrences that went');
  assert.deepEqual(identityProblems(doc), [], 'no two open issues may claim one sourceKey');
  assert.equal(doc.byKey[doc.issues[id].source.key], id, 'indexed by its own key');
});

test('the duplicate LOOP is closed: repeated ingests over an ambiguous place add nothing new', () => {
  const doc = emptyIssuesDoc();
  ingest(doc, { rollup: mkRollup({ scanners: { sast: { ran: 1 } },
    scannerFindings: { sast: [rowAt(2), rowAt(20), rowAt(40)] } }) });
  const rows = [rowAt(2), rowAt(77)];   // the same ambiguous shape, every slice
  let n = Object.keys(doc.issues).length;
  for (let i = 2; i <= 6; i++) {
    ingest(doc, { rollup: mkRollup({ sliceId: `sweep-${i}`, generated: hoursBefore(8 - i),
      scanners: { sast: { ran: 1 } }, scannerFindings: { sast: rows } }) });
    const now = Object.keys(doc.issues).length;
    if (i > 2) assert.equal(now, n, `ingest ${i} minted ${now - n} issues — the loop is not closed`);
    n = now;
  }
  assert.deepEqual(identityProblems(doc), []);
});

test('identityProblems names a store where two open issues claim one sourceKey', () => {
  const doc = emptyIssuesDoc();
  // two rows in DIFFERENT FILES are genuinely two findings under the line-free identity (D12)
  ingest(doc, { rollup: mkRollup({ scanners: { sast: { ran: 1 } },
    scannerFindings: { sast: [row(), row({ file: 'src/other.js' })] } }) });
  const [a, b] = Object.keys(doc.issues);
  assert.ok(a && b, 'precondition: two distinct issues to collide');
  doc.issues[b].source.key = doc.issues[a].source.key;      // simulate the corruption
  const p = identityProblems(doc);
  assert.equal(p.length, 1);
  assert.match(p[0], /claimed by 2 open issues/);
});
