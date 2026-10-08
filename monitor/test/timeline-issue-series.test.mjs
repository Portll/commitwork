// monitor/test/timeline-issue-series.test.mjs — the timeline's SECOND set of counts, from the
// issue tracker: the ledger count stays untouched; machine-tier closes and human decisions count
// apart; an in-force suppressing ruling is human-green on an open issue; a close naming no slice
// is unattributable; only ENOENT means "no tracker". Runs timeline.mjs end-to-end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { emptyIssuesDoc, mintIssue, saveIssues, withIssuesLock, closeIssue, mutateIssue } from '../issue-store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..', '..');
const TIMELINE = join(CW, 'monitor', 'timeline.mjs');

const SLICES = ['sweep-1', 'sweep-2'];
const T = (h) => new Date(Date.UTC(2026, 7, 1, h)).toISOString();

// A minimal but REAL out dir: history/index.json + one v1 slice per entry, plus a dep ledger with a
// single verified entry so the "ledger count is unchanged" assertion has something to bite on.
function mkOut(root) {
  const out = join(root, 'out');
  mkdirSync(join(out, 'history'), { recursive: true });
  const idx = SLICES.map((sliceId, i) => ({ stamp: `2026080100000${i}`, file: `${sliceId}.json`, generated: T(i) }));
  writeFileSync(join(out, 'history', 'index.json'), JSON.stringify(idx));
  SLICES.forEach((sliceId, i) => {
    writeFileSync(join(out, 'history', `${sliceId}.json`), JSON.stringify({
      sliceVersion: 1, sliceId, generated: T(i), kind: 'sweep',
      toolRuns: { alpha: { osv: 1 } }, scope: { repos: ['alpha'] },
      totals: { crit: 0, high: 1, med: 0, low: 0, cves: 1 },
      counts: { born: 1, cleaned: 0, unconfirmed: 0, accepted: 0, carried: 0 },
      findings: [{ repo: 'alpha', id: 'GHSA-1', package: 'lodash', severity: 'high', state: 'persisting', key: 'alpha|osv|GHSA-1|lodash|' }],
      resolved: [], carried: [], anchors: {},
    }));
  });
  writeFileSync(join(out, 'remediation-ledger.json'), JSON.stringify({ entries: [{
    key: 'alpha|osv|GHSA-0|lodash|', legacyKey: 'alpha|GHSA-0|lodash', vulnId: 'GHSA-0', repo: 'alpha', tool: 'npm',
    package: 'lodash', path: 'package-lock.json', severity: 'high', fromVersion: '4.17.0', toVersion: '4.17.21',
    fixCommit: null, bornSlice: 'sweep-1', resolvedSlice: 'sweep-2', prevSlice: 'sweep-1', at: T(1),
    evidence: { tier: 'strong', detail: 'lodash 4.17.0 -> 4.17.21' },
  }] }));
  return out;
}

// One issue of each kind the page must keep apart.
function mkIssues(path) {
  const doc = emptyIssuesDoc();
  doc.organisation = 'FIXTURE';
  const scanner = (key, rule) => ({
    area: 'fixarea', repo: 'alpha', kind: 'code', severity: 'high',
    title: `${rule} [sastCodeql] (alpha)`, body: null,
    source: { kind: 'scanner-row', key, tool: 'sastCodeql', rule },
    anchor: { file: 'src/a.js', line: 1, hash: 'abc123abc123' },
  });

  // (a) closed on MACHINE evidence, in sweep-2 — the only one that may draw on the issues line
  const proved = mintIssue(doc, scanner('sc:alpha|sastCodeql|r1|src/a.js|1', 'r1'), T(0)).id;
  mutateIssue(doc, proved, (i) => {
    i.state = 'closed'; i.closedAs = 'fixed';
    i.evidence.push({ at: T(1), tier: 'anchor-drift', sliceId: 'sweep-2', detail: 'anchored line changed' });
  }, 'issue-closed', { closedAs: 'fixed', tier: 'anchor-drift', auto: true }, T(1));

  // (b) closed by a PERSON — a decision, not a proof. Slice-attributed so it could have drawn.
  const decided = mintIssue(doc, scanner('sc:alpha|sastCodeql|r2|src/a.js|2', 'r2'), T(0)).id;
  mutateIssue(doc, decided, (i) => {
    i.state = 'closed'; i.closedAs = 'accepted';
    i.evidence.push({ at: T(1), tier: 'manual', sliceId: 'sweep-2', detail: 'accepted by the operator' });
  }, 'issue-closed', { closedAs: 'accepted' }, T(1));

  // (c) closed with NO slice in its evidence — unattributable (this is the shape every real
  // rekey-superseded close has: linkIssues writes {at, tier:'manual', detail} and no sliceId)
  const orphan = mintIssue(doc, scanner('sc:alpha|sastCodeql|r3|src/a.js|3', 'r3'), T(0)).id;
  closeIssue(doc, orphan, { as: 'superseded', evidence: 'duplicate of another id', at: T(1) });

  // (d) OPEN, carrying an in-force false-positive ruling — human-green
  const green = mintIssue(doc, scanner('sc:alpha|sastCodeql|r4|src/a.js|4', 'r4'), T(0)).id;
  mutateIssue(doc, green, (i) => {
    i.dispositions = [{
      id: 'DSP-0123456789ab', disposition: 'false-positive', reason: 'the sink is a constant',
      who: 'op@example.com', whoKind: 'human', channel: 'http', at: T(1),
      expires: '2099-01-01T00:00:00.000Z', subjectDigest: `sha256:${'a'.repeat(64)}`,
      rescan: 'none', invalidatedAt: null, invalidatedReason: null,
    }];
  }, 'issue-disposition', {}, T(1));

  // (e) OPEN, carrying an EXPIRED ruling — out of force, so NOT human-green
  const stale = mintIssue(doc, scanner('sc:alpha|sastCodeql|r5|src/a.js|5', 'r5'), T(0)).id;
  mutateIssue(doc, stale, (i) => {
    i.dispositions = [{
      id: 'DSP-0123456789ac', disposition: 'not-applicable', reason: 'was true last quarter',
      who: 'op@example.com', whoKind: 'human', channel: 'http', at: T(1),
      expires: '2020-01-01T00:00:00.000Z', subjectDigest: `sha256:${'b'.repeat(64)}`,
      rescan: 'none', invalidatedAt: null, invalidatedReason: null,
    }];
  }, 'issue-disposition', {}, T(1));

  // saveIssues refuses to write without the store's lock — a fixture build is not exempt
  withIssuesLock(() => saveIssues(doc, { path }), { path });
  return { proved, decided, orphan, green, stale };
}

// Run the real script and read back the payload it embedded.
function build(root, { issues = null } = {}) {
  const out = mkOut(root);
  const env = { ...process.env, CW_MONITOR_OUT: out };
  if (issues === null) delete env.CW_ISSUES; else env.CW_ISSUES = issues;
  const r = spawnSync(process.execPath, [TIMELINE], { env, encoding: 'utf8' });
  return { r, out, read: () => {
    const html = readFileSync(join(out, 'timeline.html'), 'utf8');
    const m = html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/);
    assert.ok(m, 'the page must embed its data');
    return JSON.parse(m[1].replace(/<\\\//g, '</'));
  } };
}

test('the issue tracker contributes its OWN counts and leaves the dep ledger untouched', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  try {
    const ids = mkIssues(join(root, 'issues.json'));
    const b = build(root, { issues: join(root, 'issues.json') });
    assert.equal(b.r.status, 0, `timeline.mjs failed: ${b.r.stderr}`);
    const d = b.read();

    assert.equal(d.ledger.length, 1, 'the dep ledger count is exactly what the ledger holds');
    assert.equal(d.ledger[0].tier, 'strong');

    assert.ok(d.issues, 'the issue facts travel with the payload');
    const proved = d.issues.closures.filter((c) => c.proved);
    const decided = d.issues.closures.filter((c) => !c.proved);
    assert.deepEqual(proved.map((c) => c.id), [ids.proved], 'only the machine-tier close is proved');
    assert.equal(proved[0].tier, 'anchor-drift');
    assert.equal(proved[0].sliceId, 'sweep-2', 'the step lands on the slice its proof appeared in');
    assert.deepEqual(decided.map((c) => c.id), [ids.decided], 'a human close is counted, and counted apart');
    assert.equal(decided[0].closedAs, 'accepted');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a close with no slice in its evidence is UNATTRIBUTABLE, not banked into the last column', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  try {
    const ids = mkIssues(join(root, 'issues.json'));
    const d = build(root, { issues: join(root, 'issues.json') }).read();
    assert.equal(d.issues.unattributable, 1);
    assert.ok(!d.issues.closures.some((c) => c.id === ids.orphan), 'it must not appear on any slice');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('human-green counts an IN-FORCE ruling on an OPEN issue, and an expired one does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  try {
    const ids = mkIssues(join(root, 'issues.json'));
    const d = build(root, { issues: join(root, 'issues.json') }).read();
    assert.deepEqual(d.issues.humanGreen.map((g) => g.id), [ids.green],
      'an expired ruling is out of force — the finding is back to having no judgement');
    assert.equal(d.issues.humanGreen[0].disposition, 'false-positive');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the page states the two populations are not summed', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  try {
    mkIssues(join(root, 'issues.json'));
    const b = build(root, { issues: join(root, 'issues.json') });
    const html = readFileSync(join(b.out, 'timeline.html'), 'utf8');
    assert.match(html, /cleaned — dep ledger/, 'the ledger KPI names what it can count');
    assert.match(html, /closed — scanner-proved/);
    assert.match(html, /closed — human decision/);
    assert.match(html, /human-green \(still open\)/);
    assert.match(html, /deliberately not summed/, 'and says so where the lines are drawn');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── fail closed ──────────────────────────────────────────────────────────────
test('an ABSENT issue store yields issues:null — the line is absent, which is not zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  try {
    const b = build(root, { issues: join(root, 'never-written.json') });
    assert.equal(b.r.status, 0, `timeline.mjs must still build without a tracker: ${b.r.stderr}`);
    assert.equal(b.read().issues, null);
    const html = readFileSync(join(b.out, 'timeline.html'), 'utf8');
    assert.match(html, /No issue store was readable, so the issues line is absent — that is not zero/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a CORRUPT issue store fails the build — it must never render as zero closes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-tl-'));
  try {
    const p = join(root, 'issues.json');
    writeFileSync(p, 'truncated mid-wri{{{');
    const b = build(root, { issues: p });
    assert.notEqual(b.r.status, 0, 'a corrupt store must stop the viewer, not be drawn as clean');
    assert.match(b.r.stderr, /unreadable|refusing to draw it as zero closes/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
