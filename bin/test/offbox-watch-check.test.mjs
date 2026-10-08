// bin/test/offbox-watch-check.test.mjs — the local half of the off-box watcher, against real
// repositories and a controlled clock.
//
// The state this file exists to prove is STALE-LEDGER. The watcher's own alarms are red workflow
// runs in a private repository, so a watcher that stops running raises nothing at all: measured
// 2026-09-24, every workflow in commitwork-remote had failed at startup since 2026-09-19 and no
// check on this box noticed for five days. Freshness is therefore a finding, never an absence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { check, newestObservation, pagePayload, page, notify, pageIssue, issueBody, classifyGhFailure,
  ISSUE_TITLE, classifyFetchFailure, config } from '../offbox-watch-check.mjs';

const sh = (cwd, args, env = {}) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

let dir;
function world() {
  dir = mkdtempSync(join(tmpdir(), 'cw-offbox-'));
  const remote = join(dir, 'remote.git');
  spawnSync('git', ['init', '-q', '--bare', remote]);
  const clone = join(dir, 'clone');
  spawnSync('git', ['clone', '-q', remote, clone]);
  sh(clone, ['config', 'user.email', 't@t']); sh(clone, ['config', 'user.name', 't']);
  return { remote, clone };
}
/** Put `text` on `branch` with a commit dated `whenISO`. */
function put(w, branch, file, text, whenISO) {
  const blob = spawnSync('git', ['-C', w.clone, 'hash-object', '-w', '--stdin'], { input: text, encoding: 'utf8' }).stdout.trim();
  const tree = spawnSync('git', ['-C', w.clone, 'mktree'], { input: `100644 blob ${blob}\t${file}\n`, encoding: 'utf8' }).stdout.trim();
  const parent = spawnSync('git', ['-C', w.clone, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`], { encoding: 'utf8' }).stdout.trim();
  const env = { GIT_AUTHOR_DATE: whenISO, GIT_COMMITTER_DATE: whenISO, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const c = spawnSync('git', ['-C', w.clone, 'commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', branch],
    { encoding: 'utf8', env: { ...process.env, ...env } }).stdout.trim();
  sh(w.clone, ['update-ref', `refs/heads/${branch}`, c]);
  sh(w.clone, ['push', '-q', 'origin', `refs/heads/${branch}:refs/heads/${branch}`]);
  return c;
}
const obs = (verdict, observedAt, alarms = []) => `${JSON.stringify({ v: 1, kind: 'witness-observation', observedAt, verdict, alarms, prev: 'genesis' })}\n`;
const envFor = (w, over = {}) => ({ CW_WITNESS_REPO: w.clone, CW_WITNESS_REMOTE: 'origin', ...over });

test.afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

test('a fresh ledger whose newest observation is ok reads ok', () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-24T12:00:00Z');
  put(w, 'watch-ledger', 'ledger.jsonl', obs('ok', '2026-09-24T12:30:00Z'), '2026-09-24T12:30:00Z');
  const r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) });
  assert.equal(r.state, 'ok');
  assert.equal(r.code, 0);
  assert.equal(r.ledgerAgeH, 0.5);
});

test('a ledger that stopped moving is STALE-LEDGER — the watcher not running is the finding', () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-24T12:00:00Z');
  put(w, 'watch-ledger', 'ledger.jsonl', obs('ok', '2026-09-19T14:44:00Z'), '2026-09-19T14:44:00Z');
  const r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) });
  assert.equal(r.state, 'STALE-LEDGER');
  assert.equal(r.code, 1);
  assert.ok(r.ledgerAgeH > 100, `age ${r.ledgerAgeH}`);
  assert.match(r.detail, /not running/);
});

test('a witness that stopped moving is STALE-WITNESS, even with a fresh ledger', () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-20T01:00:00Z');
  put(w, 'watch-ledger', 'ledger.jsonl', obs('ok', '2026-09-24T12:30:00Z'), '2026-09-24T12:30:00Z');
  const r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) });
  assert.equal(r.state, 'STALE-WITNESS');
  assert.equal(r.code, 1);
});

// The witness moves only during the nightly sweep ladder. A 10h-old witness on an afternoon is the
// normal state, and under the ledger's 6h bound it paged issue #1 hourly until the next night.
test('a witness from last night is ok in the afternoon — it has its own bound, not the ledger one', () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-24T03:00:00Z');
  put(w, 'watch-ledger', 'ledger.jsonl', obs('ok', '2026-09-24T12:30:00Z'), '2026-09-24T12:30:00Z');
  const r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) });
  assert.equal(r.witnessAgeH, 10);
  assert.equal(r.state, 'ok');
  const tight = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z', CW_OFFBOX_WITNESS_MAX_AGE_H: '8' }) });
  assert.equal(tight.state, 'STALE-WITNESS', 'the witness bound must still bite when it is exceeded');
});

test("the watcher's own alarm is carried through verbatim, not re-derived", () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-24T12:00:00Z');
  put(w, 'watch-ledger', 'ledger.jsonl', obs('ALARM', '2026-09-24T12:30:00Z', ['witness rewritten: abc is not an ancestor of def']), '2026-09-24T12:30:00Z');
  const r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) });
  assert.equal(r.state, 'ALARM');
  assert.equal(r.code, 1);
  assert.deepEqual(r.alarms, ['witness rewritten: abc is not an ancestor of def']);
});

// git exports GIT_DIR to hooks. Inherited, it outranks `-C`, and a sweep started by a post-commit
// hook in a linked worktree read commitwork's own origin instead of the witness repository.
test('an inherited GIT_DIR does not redirect the check to another repository', () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-24T12:00:00Z');
  put(w, 'watch-ledger', 'ledger.jsonl', obs('ok', '2026-09-24T12:30:00Z'), '2026-09-24T12:30:00Z');
  const decoy = join(dir, 'decoy.git');
  spawnSync('git', ['init', '-q', '--bare', decoy]);
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_WORK_TREE: process.env.GIT_WORK_TREE };
  process.env.GIT_DIR = decoy;
  process.env.GIT_WORK_TREE = dir;
  let r;
  try { r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) }); }
  finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  assert.equal(r.state, 'ok', `read the wrong repository: ${r.state} ${r.detail || ''}`);
  const refs = spawnSync('git', ['--git-dir', decoy, 'for-each-ref'], { encoding: 'utf8' }).stdout.trim();
  assert.equal(refs, '', 'the decoy repository must gain no refs');
});

test('never observed is no-ledger and exits 2 — an absence is not a pass', () => {
  const w = world();
  put(w, 'witness-anchors', 'witness.json', '{"v":1}\n', '2026-09-24T12:00:00Z');
  const r = check({ env: envFor(w, { CW_NOW: '2026-09-24T13:00:00Z' }) });
  assert.equal(r.state, 'no-ledger');
  assert.equal(r.code, 2);
});

test('no witness clone is no-repository, not a clean result', () => {
  const r = check({ env: { CW_WITNESS_REPO: join(tmpdir(), 'cw-offbox-does-not-exist') } });
  assert.equal(r.state, 'no-repository');
  assert.equal(r.code, 2);
});

test('the newest observation wins even when the ledger is out of order, and torn lines are counted', () => {
  const t = obs('ok', '2026-09-24T10:00:00Z') + 'not json\n' + obs('ALARM', '2026-09-24T12:00:00Z');
  const n = newestObservation(t);
  assert.equal(n.records, 3);
  assert.equal(n.torn, 1);
  assert.equal(n.newest.verdict, 'ALARM');
});

test('a fetch failure is classified: absent, not-permitted and offline are different states', () => {
  assert.equal(classifyFetchFailure("fatal: couldn't find remote ref refs/heads/watch-ledger"), 'absent');
  assert.equal(classifyFetchFailure('fatal: Authentication failed for https://github.com/x/y'), 'not-permitted');
  assert.equal(classifyFetchFailure('fatal: unable to access: Could not resolve host'), 'offline');
});

test('the page carries a ref and a state, never a path, host or ledger body', () => {
  const p = pagePayload({ state: 'STALE-LEDGER', ledgerTip: 'a'.repeat(40), ledgerAgeH: 118.9, witnessAgeH: 13.3, alarms: [] }, '2026-09-24T13:00:00Z');
  const s = JSON.stringify(p);
  assert.doesNotMatch(s, /\/Users\/|github\.com|commitwork-remote|\.jsonl/);
  assert.equal(p.ref.length, 16);
  assert.equal(p.state, 'STALE-LEDGER');
  assert.equal(p.ledgerAgeHours, 118.9);
});

test('a non-https target is refused in the core, before any request', async () => {
  let called = 0;
  const r = await page({ state: 'ALARM', ledgerTip: 'x' },
    { env: { CW_OFFBOX_WEBHOOK_URL: 'http://example.invalid/hook', CW_SECRETS_FILE: join(tmpdir(), 'no-such-secrets.json') },
      fetchImpl: async () => { called++; return { ok: true, status: 200 }; } });
  assert.equal(r.paged, 'refused');
  assert.equal(called, 0, 'refusal must happen before the transport is touched');
});

test('no declared webhook is no-url — reported, never a silent no-op', async () => {
  const r = await page({ state: 'ALARM', ledgerTip: 'x' },
    { env: { CW_SECRETS_FILE: join(tmpdir(), 'no-such-secrets.json') }, fetchImpl: async () => ({ ok: true, status: 200 }) });
  assert.equal(r.paged, 'no-url');
  assert.match(r.reason, /no route/);
});

/** A gh stand-in holding one repository's open issues; comments are recorded, never delivered. */
function ghWorld() {
  const calls = [];
  let issues = [];
  let comments = 0;
  const impl = (args) => {
    calls.push(args.join(' '));
    const path = args[1] || '';
    if (/issues\?state=open/.test(path)) {
      const hit = issues.find((i) => i.title === ISSUE_TITLE);
      return { ok: true, out: hit ? String(hit.number) : '', err: '' };
    }
    if (/issues\/\d+\/comments$/.test(path)) { comments++; return { ok: true, out: '{}', err: '' }; }
    if (/issues$/.test(path)) { issues = [{ number: 12, title: ISSUE_TITLE }]; return { ok: true, out: '12', err: '' }; }
    return { ok: false, out: '', err: 'unexpected' };
  };
  return { impl, calls, get comments() { return comments; } };
}
const alarm = { state: 'STALE-LEDGER', ledgerTip: 'a'.repeat(40), ledgerAgeH: 118.9, witnessAgeH: 13.3, alarms: [] };
const noSecrets = { CW_SECRETS_FILE: join(tmpdir(), 'no-such-secrets.json'), CW_NOW: '2026-09-25T01:00:00Z' };

test('with no webhook declared the alarm still has a route: an issue in the witness repository', async () => {
  const g = ghWorld();
  const r = await notify(alarm, { env: noSecrets, fetchImpl: async () => { throw new Error('must not be called'); }, ghImpl: g.impl });
  assert.deepEqual({ paged: r.paged, webhook: r.webhook, number: r.number }, { paged: 'issue-opened', webhook: 'no-url', number: 12 });
});

test('the issue route opens ONE issue per outage and comments after that', async () => {
  const g = ghWorld();
  const env = { ...noSecrets };
  assert.equal((await pageIssue(alarm, { env, ghImpl: g.impl })).issue, 'opened');
  const second = await pageIssue(alarm, { env, ghImpl: g.impl });
  assert.deepEqual(second, { issue: 'commented', number: 12 });
  assert.equal(g.comments, 1);
});

test('a refused issue API is not-permitted', async () => {
  const denied = await pageIssue(alarm, { env: noSecrets, ghImpl: () => ({ ok: false, out: '', err: 'HTTP 403: Resource not accessible' }) });
  assert.equal(denied.issue, 'not-permitted');
  assert.equal(classifyGhFailure('dial tcp: lookup api.github.com'), 'offline');
});

// The webhook terminates on the watched box. If its delivery could stand in for the issue, whoever
// controls the box could satisfy the page locally and silence the route that leaves.
test('a delivered webhook never stands in for the issue route — both fire', async () => {
  const g = ghWorld();
  const seen = [];
  const out = await notify(alarm, {
    env: { ...noSecrets, CW_OFFBOX_WEBHOOK_URL: 'https://example.invalid/hook', CW_OFFBOX_PAGE_TOKEN: 't'.repeat(40) },
    fetchImpl: async (url, init) => { seen.push(init.headers.authorization); return { ok: true, status: 200 }; },
    ghImpl: g.impl });
  assert.deepEqual({ paged: out.paged, webhook: out.webhook }, { paged: 'issue-opened', webhook: 'sent' });
  assert.ok(g.calls.some((c) => /issues$|issues -f/.test(c)), g.calls.join(' | '));
  assert.deepEqual(seen, [`Bearer ${'t'.repeat(40)}`], 'the declared token must travel as a bearer');
});

test('the issue body carries the opaque payload, never a path, host or ledger body', () => {
  const b = issueBody(alarm, '2026-09-25T01:00:00Z');
  assert.doesNotMatch(b, /\/Users\/|github\.com|commitwork-remote|\.jsonl|portll/i);
  assert.match(b, /state: STALE-LEDGER/);
  assert.match(b, /ledger age: 118\.9h/);
});

test('config reads the environment at call time, not at import', () => {
  const a = config({ CW_OFFBOX_MAX_AGE_H: '2' });
  const b = config({ CW_OFFBOX_MAX_AGE_H: '9' });
  assert.equal(a.maxAgeH, 2);
  assert.equal(b.maxAgeH, 9);
  assert.equal(config({}).maxAgeH, 6);
  assert.equal(config({}).witnessMaxAgeH, 24);
  assert.equal(config({ CW_OFFBOX_WITNESS_MAX_AGE_H: '30' }).witnessMaxAgeH, 30);
});
