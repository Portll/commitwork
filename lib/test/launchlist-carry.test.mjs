// lib/launchlist.mjs carryForward and the held acceptance. A run that did not ask for an opt-in
// check (--history, --tests) must not write unmeasured over its last measurement: acceptances bind
// to the evidence digest, and on 2026-10-04 a flagless run 67 s after a history acceptance voided it.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carryForward, evaluateProject, digestEvidence, OPT_IN_CHECKS, STATUS } from '../launchlist.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TMP = mkdtempSync(join(tmpdir(), 'cw-launchlist-carry-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const ITEMS = [
  { id: 'pub.secrets.history', check: 'secretsHistory', severity: 'HARD', section: 'secrets', title: 'h' },
  { id: 'pub.build.public-test', check: 'publicTest', severity: 'HARD', section: 'build', title: 't' },
  { id: 'pub.secrets.head', check: 'secretsHead', severity: 'HARD', section: 'secrets', title: 'x' },
];
const HISTORY = { status: STATUS.FAIL, summary: '87 finding(s) in 44 commit(s) over 3118 commit(s)', evidence: ['generic-api-key: 60'] };
const NOT_RUN = { status: STATUS.UNMEASURED, summary: 'history scan not run (pass --history)', evidence: [] };
const PREVIOUS = { measuredAt: '2026-10-04T10:45:06.000Z', results: { 'pub.secrets.history': HISTORY, 'pub.secrets.head': { status: STATUS.FAIL, summary: 'old', evidence: [] } } };

test('the opt-in checks are the two a run performs only when its flag asks', () => {
  assert.deepEqual({ ...OPT_IN_CHECKS }, { secretsHistory: 'history', publicTest: 'tests' });
});

test('a run that did not ask carries the last measurement forward, and says when it was taken', () => {
  const out = carryForward({ 'pub.secrets.history': NOT_RUN, 'pub.secrets.head': { status: STATUS.PASS, summary: 'new', evidence: [] } }, PREVIOUS, { items: ITEMS, flags: {} });
  assert.deepEqual(out['pub.secrets.history'], { ...HISTORY, carriedFrom: '2026-10-04T10:45:06.000Z' });
  assert.equal(out['pub.secrets.head'].summary, 'new', 'a check every run performs is never carried');
  const again = carryForward({ 'pub.secrets.history': NOT_RUN }, { measuredAt: '2026-10-05T00:00:00.000Z', results: out }, { items: ITEMS, flags: {} });
  assert.equal(again['pub.secrets.history'].carriedFrom, '2026-10-04T10:45:06.000Z', 'a second carry keeps the original measurement time');
});

test('a run that asked keeps what it measured, and nothing unmeasured is carried', () => {
  const fresh = { status: STATUS.PASS, summary: 'no findings', evidence: [] };
  assert.deepEqual(carryForward({ 'pub.secrets.history': fresh }, PREVIOUS, { items: ITEMS, flags: { history: true } })['pub.secrets.history'], fresh);
  const unmeasuredBefore = { measuredAt: 'x', results: { 'pub.secrets.history': NOT_RUN } };
  assert.deepEqual(carryForward({ 'pub.secrets.history': NOT_RUN }, unmeasuredBefore, { items: ITEMS, flags: {} })['pub.secrets.history'], NOT_RUN);
  assert.deepEqual(carryForward({ 'pub.secrets.history': NOT_RUN }, null, { items: ITEMS, flags: {} })['pub.secrets.history'], NOT_RUN);
});

const evaluate = (result) => {
  const spec = { items: ITEMS.slice(0, 1).map((i) => ({ ...i, profile: 'publication' })) };
  const tick = { state: 'done', by: 'peer', at: 't', evidenceDigest: digestEvidence(HISTORY) };
  const state = { ticks: { p: { 'pub.secrets.history': tick } }, items: {}, log: [] };
  return evaluateProject('p', { spec, config: {}, state, results: { measuredAt: 'm', results: { 'pub.secrets.history': result } } }).rows[0];
};

test('an acceptance holds over a carried result, is held but not counted over no evidence, and lapses on changed evidence', () => {
  const carried = evaluate({ ...HISTORY, carriedFrom: '2026-10-04T10:45:06.000Z' });
  assert.deepEqual([carried.accepted, carried.done, carried.lapsed, carried.stale], [true, true, false, false]);
  const absent = evaluate(NOT_RUN);
  assert.deepEqual([absent.accepted, absent.done, absent.lapsed, absent.stale], [false, false, false, true]);
  const changed = evaluate({ ...HISTORY, summary: '88 finding(s) in 45 commit(s) over 3120 commit(s)' });
  assert.deepEqual([changed.accepted, changed.done, changed.lapsed, changed.stale], [false, false, true, false]);
});

test('a flagless run of the CLI no longer reopens an accepted history check', () => {
  const fix = join(TMP, 'fx');
  execFileSync('git', ['init', '-q', '-b', 'main', fix]);
  writeFileSync(join(fix, 'README.md'), '# fx\n');
  execFileSync('git', ['-C', fix, '-c', 'user.email=f@example.com', '-c', 'user.name=f', '-c', 'commit.gpgsign=false', 'add', '-A']);
  execFileSync('git', ['-C', fix, '-c', 'user.email=f@example.com', '-c', 'user.name=f', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'fx']);

  const spec = JSON.parse(readFileSync(join(REPO, 'manifests', 'launchlist.json'), 'utf8'));
  spec.items = spec.items.filter((i) => i.id === 'pub.secrets.history');
  const store = join(TMP, 'store');
  mkdirSync(join(store, 'results'), { recursive: true });
  writeFileSync(join(TMP, 'spec.json'), JSON.stringify(spec));
  writeFileSync(join(store, 'config.json'), JSON.stringify({ projects: { fx: { repo: fix, profiles: ['publication'] } } }));
  writeFileSync(join(store, 'results', 'fx.json'), JSON.stringify(PREVIOUS));
  const tick = { state: 'done', note: 'accepted on the fresh-root route', by: 'peer', at: '2026-10-04T10:45:06.000Z', evidenceDigest: digestEvidence(HISTORY) };
  writeFileSync(join(store, 'state.json'), JSON.stringify({ ticks: { fx: { 'pub.secrets.history': tick } }, items: {}, log: [] }));

  const env = { ...process.env, CW_LAUNCHLIST_DIR: store, CW_LAUNCHLIST_SPEC: join(TMP, 'spec.json'), CW_LAUNCHLIST_HTML: join(TMP, 'out.html') };
  const r = spawnSync(process.execPath, [join(REPO, 'bin', 'launchlist.mjs'), 'run', '--project', 'fx'], { env, encoding: 'utf8', timeout: 120_000 });
  assert.notEqual(r.status, 2, r.stderr);
  const saved = JSON.parse(readFileSync(join(store, 'results', 'fx.json'), 'utf8')).results['pub.secrets.history'];
  assert.deepEqual(saved, { ...HISTORY, carriedFrom: PREVIOUS.measuredAt });
  const status = spawnSync(process.execPath, [join(REPO, 'bin', 'launchlist.mjs'), 'status', '--project', 'fx'], { env, encoding: 'utf8' });
  assert.match(status.stdout, /1\/1 done/, `the accepted history check must stay done:\n${status.stdout}`);
});
