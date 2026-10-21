// admin/lib/served-projection.mjs — the read-time allowlist, pinned with the same witness the
// sweep verdicts use: monitor/sweep-verdict.mjs assertServedSafe (absolute-path values and
// session/pid keys throw at any depth). Every projector output goes through it here, so a field
// added to a projector without a decision fails this file before it crosses a tunnel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertServedSafe } from '../../monitor/sweep-verdict.mjs';
import {
  readJSONState, projectConservation, projectAnomalies, projectTimelineVerify,
  projectFatigue, projectCalibration, projectEscalations, projectRuntimeTls, projectRuntimeCspm,
} from '../lib/served-projection.mjs';

const TMP = mkdtempSync(join(tmpdir(), 'cw-proj-'));
test.after(() => rmSync(TMP, { recursive: true, force: true }));

// ── readJSONState: only ENOENT is absence ───────────────────────────────────────────────────────
test('readJSONState: absent / unreadable / ok are three states, never an empty object', () => {
  assert.equal(readJSONState(join(TMP, 'nope.json')).state, 'absent');
  const bad = join(TMP, 'bad.json');
  writeFileSync(bad, '{ torn');
  assert.deepEqual(readJSONState(bad), { state: 'unreadable', detail: 'parse' });
  const ok = join(TMP, 'ok.json');
  writeFileSync(ok, '{"a":1}');
  assert.deepEqual(readJSONState(ok), { state: 'ok', data: { a: 1 } });
});

// ── conservation ────────────────────────────────────────────────────────────────────────────────
test('conservation: absent field is never-checked, never a clean zero', () => {
  assert.deepEqual(projectConservation(undefined), { state: 'never-checked' });
  assert.deepEqual(projectConservation(null), { state: 'never-checked' });
});

test('conservation: checked + violations carry only the four declared numbers per row', () => {
  const p = projectConservation({
    checked: ['secrets', 'iac'],
    violations: [{ category: 'secrets', declared: 5, published: 3, truncated: 1, session: 'leak-me', extra: '/work/x' }],
  });
  assert.equal(p.state, 'checked');
  assert.deepEqual(p.checked, ['secrets', 'iac']);
  assert.deepEqual(p.violations, [{ category: 'secrets', declared: 5, published: 3, truncated: 1 }]);
  assert.equal(assertServedSafe(p), true);
});

// ── anomalies ───────────────────────────────────────────────────────────────────────────────────
test('anomalies: absent file is never-measured; unreadable is its own state, never []', () => {
  assert.deepEqual(projectAnomalies({ state: 'absent' }), { state: 'never-measured' });
  assert.equal(projectAnomalies({ state: 'unreadable', detail: 'parse' }).state, 'unreadable');
  assert.equal(projectAnomalies({ state: 'ok', data: { not: 'array' } }).state, 'unreadable');
});

test('anomalies: rows are allowlisted, hash is a 12-char prefix, display truncation is counted', () => {
  const repos = Array.from({ length: 25 }, (_, i) => `repo-${String(i).padStart(2, '0')}`);
  const p = projectAnomalies({ state: 'ok', data: [{
    category: 'secrets', hash: 'a'.repeat(64), repoCount: 26, bytes: 900, repos, truncated: 1,
    session: 'leak', pid: 42, absolutePath: '/tmp/never',
  }] });
  assert.equal(p.state, 'measured');
  assert.equal(p.count, 1);
  const a = p.anomalies[0];
  assert.equal(a.hash.length, 12);
  assert.equal(a.repos.length, 20);
  assert.equal(a.truncated, 1 + 5, 'file-level cap + display cap, summed and stated');
  assert.equal('absolutePath' in a, false);
  assert.equal(assertServedSafe(p), true);
});

test('anomalies: measured empty is a corroborated zero — state measured, count 0', () => {
  assert.deepEqual(projectAnomalies({ state: 'ok', data: [] }), { state: 'measured', count: 0, anomalies: [] });
});

// ── timeline verify ─────────────────────────────────────────────────────────────────────────────
function seedHistory(name, rows) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), JSON.stringify(rows));
  return dir;
}

test('timelineVerify: no index is no-history; corrupt index is unreadable, never absent', () => {
  assert.deepEqual(projectTimelineVerify(join(TMP, 'no-such-history')), { state: 'no-history' });
  const dir = seedHistory('hist-corrupt', []);
  writeFileSync(join(dir, 'index.json'), '{');
  assert.equal(projectTimelineVerify(dir).state, 'unreadable');
});

test('timelineVerify: verified / unverified-legacy / unreadable are three per-slice states', () => {
  const body = JSON.stringify({ sliceId: 'sweep-1' });
  const rows = [
    { sliceId: 's-legacy', stamp: '20260101000000', generated: '2026-01-01T00:00:00Z', file: '20260101000000.json' },
    { sliceId: 's-good', stamp: '20260102000000', generated: '2026-01-02T00:00:00Z', file: '20260102000000.json',
      sliceSha256: createHash('sha256').update(body).digest('hex') },
    { sliceId: 's-tampered', stamp: '20260103000000', generated: '2026-01-03T00:00:00Z', file: '20260103000000.json',
      sliceSha256: 'f'.repeat(64) },
    { sliceId: 's-gone', stamp: '20260104000000', generated: '2026-01-04T00:00:00Z', file: '20260104000000.json',
      sliceSha256: 'e'.repeat(64) },
  ];
  const dir = seedHistory('hist-mixed', rows);
  writeFileSync(join(dir, '20260102000000.json'), body);
  writeFileSync(join(dir, '20260103000000.json'), body); // bytes exist but do not match the record
  const p = projectTimelineVerify(dir);
  assert.equal(p.state, 'ok');
  assert.deepEqual(p.counts, { verified: 1, 'unverified-legacy': 1, unreadable: 2 });
  const by = Object.fromEntries(p.slices.map((s) => [s.sliceId, s]));
  assert.equal(by['s-legacy'].verify, 'unverified-legacy');
  assert.equal(by['s-good'].verify, 'verified');
  assert.equal(by['s-tampered'].verify, 'unreadable');
  assert.equal(by['s-tampered'].detail, 'sha256-mismatch');
  assert.equal(by['s-gone'].verify, 'unreadable');
  assert.equal(assertServedSafe(p), true);
});

test('timelineVerify: the window is capped and the cap is stated (window vs total)', () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({
    sliceId: `s-${i}`, stamp: `2026010${i}000000`, generated: `2026-01-0${i + 1}T00:00:00Z`, file: `x${i}.json`,
  }));
  const p = projectTimelineVerify(seedHistory('hist-cap', rows), { cap: 2 });
  assert.equal(p.window, 2);
  assert.equal(p.total, 5);
  assert.deepEqual(p.slices.map((s) => s.sliceId), ['s-3', 's-4'], 'newest slices survive the cap');
});

// ── fatigue ─────────────────────────────────────────────────────────────────────────────────────
test('fatigue: absent journal is no-journal (unknown), never an empty list', () => {
  assert.deepEqual(projectFatigue({ absent: true, records: [] }, { targets: [], empty: true }), { state: 'no-journal' });
});

test('fatigue: a zero with no suppression-label rows ever recorded is UNREINFORCED, its own state', () => {
  const journal = { absent: false, records: [{ kind: 'finding-adjudication', findingKey: 'k' }] };
  assert.deepEqual(projectFatigue(journal, { targets: [], empty: true }), { state: 'zero-unreinforced' });
});

test('fatigue: a zero where labels exist and all are adjudicated is corroborated — a different state', () => {
  const journal = { absent: false, records: [
    { kind: 'suppression-label', target: 'k', count: 3 },
    { kind: 'finding-adjudication', findingKey: 'k' },
  ] };
  assert.deepEqual(projectFatigue(journal, { targets: [], empty: true }), { state: 'zero-corroborated' });
});

test('fatigue: targets carry the allowlist only — who and the derived sentence never cross', () => {
  const journal = { absent: false, records: [{ kind: 'suppression-label', target: 't', count: 2 }] };
  const p = projectFatigue(journal, { targets: [
    { target: 'monitor/x.mjs secrets aws-key', count: 7, labels: 2, everExpiring: true, who: 'operator-name', sentence: 'free text' },
  ] });
  assert.equal(p.state, 'ok');
  assert.deepEqual(p.targets, [{ target: 'monitor/x.mjs secrets aws-key', count: 7, labels: 2, everExpiring: true }]);
  assert.equal(assertServedSafe(p), true);
});

// ── calibration ─────────────────────────────────────────────────────────────────────────────────
test('calibration: no records is no-records — UNKNOWN, not zero', () => {
  assert.deepEqual(projectCalibration(null), { state: 'no-records' });
  assert.deepEqual(projectCalibration({ generated: 'x', checks: {} }), { state: 'no-records' });
});

test('calibration: rates stay null when nothing is adjudicated — null is served, never 0', () => {
  const p = projectCalibration({ generated: '2026-09-01T00:00:00.000Z', checks: {
    secrets: { human: { denominator: 0, adjudicated: 0, unadjudicated: 4, falseAlarmRate: null, falseCleanRate: null, cohortUnknown: 1,
      cohorts: { standing: {}, delta: {} } } },
  } });
  assert.equal(p.state, 'ok');
  const m = p.checks.secrets.human;
  assert.equal(m.falseAlarmRate, null);
  assert.equal(m.falseCleanRate, null);
  assert.equal(m.unadjudicated, 4);
  assert.equal('cohorts' in m, false, 'cohort detail is CLI-only, not on the wire');
  assert.equal(assertServedSafe(p), true);
});

// ── escalations ─────────────────────────────────────────────────────────────────────────────────
const escRec = (o = {}) => ({ kind: 'finding-adjudication', findingKey: 'secrets|alpha|aws-key', category: 'secrets',
  repo: 'alpha', truth: null, machineVerdict: null, provenance: 'escalation:disagreement(3)', model: 'qwen-7b',
  at: '2026-09-01T00:00:00Z',
  basis: { place: null, artifact: null, sha256: 'b'.repeat(64) },
  evidence: { place: null, artifact: null, sha256: 'c'.repeat(64) }, ...o });

test('escalations: absent journal is no-journal — unknown, never an empty queue', () => {
  assert.deepEqual(projectEscalations({ absent: true, records: [] }), { state: 'no-journal' });
});

test('escalations: a zero splits on whether the reviewer has ever written here (violet ≠ explicit uncertainty)', () => {
  assert.deepEqual(projectEscalations({ absent: false, records: [{ kind: 'finding-adjudication', findingKey: 'k', truth: 'true-alarm' }] }),
    { state: 'zero-unreinforced' }, 'no provenance-bearing row: nothing feeds this queue');
  assert.deepEqual(projectEscalations({ absent: false, records: [escRec({ provenance: 'unanimous(3)' })] }),
    { state: 'zero-corroborated' }, 'the reviewer writes here and nothing escalated');
});

test('escalations: rows parse reason+chains, seal existence only — the sha256 never crosses', () => {
  const p = projectEscalations({ absent: false, records: [escRec(), escRec({ findingKey: 'iac|beta|r', category: 'iac', provenance: 'escalation:not-a-known-format' })] });
  assert.equal(p.state, 'ok');
  assert.equal(p.pending, 2);
  assert.equal(p.rows[0].findingKey, 'iac|beta|r', 'newest first');
  assert.deepEqual({ reason: p.rows[1].reason, chains: p.rows[1].chains }, { reason: 'disagreement', chains: 3 });
  assert.deepEqual({ reason: p.rows[0].reason, chains: p.rows[0].chains }, { reason: 'unparsed', chains: null },
    'unparseable provenance is its own reading, never a guessed reason');
  assert.equal(p.rows[1].evidenceSealed, true);
  assert.ok(!JSON.stringify(p).includes('c'.repeat(64)), 'the envelope digest crossed the tunnel');
  assert.ok(!('truth' in p.rows[1]) && !('machineVerdict' in p.rows[1]), 'no verdict-shaped field may leave — this queue must not render adjudicated');
  assert.equal(assertServedSafe(p), true);
});

test('escalations: a later human adjudication resolves the key out of the queue, counted not erased', () => {
  const p = projectEscalations({ absent: false, records: [
    escRec(), escRec({ findingKey: 'iac|beta|r', category: 'iac' }),
    { kind: 'finding-adjudication', findingKey: 'iac|beta|r', truth: 'false-alarm', provenance: null },
  ] });
  assert.equal(p.pending, 1);
  assert.equal(p.resolved, 1);
  assert.deepEqual(p.rows.map((r) => r.findingKey), ['secrets|alpha|aws-key']);
});

test('escalations: the served window is capped and the cap is stated', () => {
  const records = Array.from({ length: 55 }, (_, i) => escRec({ findingKey: `k${i}` }));
  const p = projectEscalations({ absent: false, records });
  assert.equal(p.rows.length, 50);
  assert.equal(p.truncated, 5);
  assert.equal(p.pending, 55);
});

// ── runtime raw-passthrough repair ──────────────────────────────────────────────────────────────
test('tls: null in, null out; otherwise only the four rendered fields survive', () => {
  assert.equal(projectRuntimeTls(null), null);
  const p = projectRuntimeTls({
    status: 'ok', target: 'https://internal-host.corp.example', session: 's',
    headers: { ran: true, grade: 'B', missing: ['content-security-policy'], observed: { server: 'nginx/1.2 secret-banner' } },
  });
  assert.deepEqual(p, { status: 'ok', headers: { ran: true, grade: 'B', missing: ['content-security-policy'] } });
  assert.equal(assertServedSafe(p), true);
});

test('cspm: null in, null out; ran/pass/fail/reason only, reason capped', () => {
  assert.equal(projectRuntimeCspm(null), null);
  const p = projectRuntimeCspm({ ran: false, reason: 'r'.repeat(500), token: 'ghp_secret', results: [{ raw: true }] });
  assert.equal(p.ran, false);
  assert.equal(p.reason.length, 200);
  assert.equal('token' in p, false);
  assert.equal('results' in p, false);
  assert.equal(assertServedSafe(p), true);
});
