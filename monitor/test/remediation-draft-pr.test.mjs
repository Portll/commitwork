// monitor/remediation-draft-pr.mjs end to end against a git host on disk and a fake gh: mode
// gating, the own and upstream paths, fork creation, the draft flag, the PR body, CLA and DCO, and
// the ledger event each outcome writes. No network, no real gh, no real push.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { createPr } from '../../bin/create-pr.mjs';
import { loadIssues, verifyChain } from '../issue-store.mjs';
import { openDraftRemediationPR } from '../remediation-draft-pr.mjs';
import { makeFixture, goStub, adv } from './lib/draft-pr-fixture.mjs';

const F = makeFixture();
after(() => rmSync(F.TMP, { recursive: true, force: true }));
const BRANCH = 'commitwork/deps/go-2026-0001';
const LIVE = { fixed: false, sha: 'feedface' };
const policy = (draftPr = {}, mode = 'draft-pr') => ({ mode, draftPr: { targets: ['own', 'upstream'], ready: 'never', maxOpenPerRepo: 1, maxOpenPerDay: 3, ...draftPr } });
let captured;
const wrapCreate = (o) => { captured = { ...o, body: readFileSync(o.bodyFile, 'utf8') }; return createPr(o); };
const run = (slug, { pol = policy(), env = {}, go = {}, store = F.store(), a = {} } = {}) => {
  F.resetCalls();
  captured = null;
  const r = openDraftRemediationPR(adv(slug, a), { policy: pol, headState: LIVE, issues: { path: store.path }, env: F.env(env), seams: { ...goStub(go), createPr: wrapCreate } });
  return { r, store, events: loadIssues({ path: store.path }).events.filter((e) => e.type.startsWith('remediation-pr-')) };
};
const prCreate = () => F.calls().find((a) => a[0] === 'pr' && a[1] === 'create');

test('report and hitl-item open nothing and touch neither gh nor the store', () => {
  for (const mode of ['report', 'hitl-item']) {
    const { r, events } = run('acme/never', { pol: policy({}, mode) });
    assert.equal(r.state, 'disabled');
    assert.equal(r.recorded, false);
    assert.deepEqual(F.calls(), []);
    assert.deepEqual(events, []);
  }
});

test('own repository: a commitwork/ branch on origin and gh pr create --draft; the opened event carries the URL', () => {
  const bare = F.repo('tester/tools');
  const { r, events, store } = run('tester/tools', { env: { STUB_PERM: 'ADMIN' } });
  assert.equal(r.state, 'opened', JSON.stringify(r));
  assert.equal(r.draft, true);
  assert.equal(r.target, 'own');
  assert.ok(F.ref(bare, `refs/heads/${BRANCH}`), 'the branch reached the repository');
  const create = prCreate();
  assert.ok(create.includes('--draft'));
  assert.ok(!create.includes('--repo'), 'no fork, no cross-repository head');
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'remediation-pr-opened');
  assert.equal(events[0].issueId, store.issueId);
  assert.equal(events[0].data.url, 'https://github.test/own/pull/7');
  assert.equal(events[0].data.draft, true);
  assert.deepEqual(verifyChain(loadIssues({ path: store.path })), []);
  const again = run('tester/tools', { env: { STUB_PERM: 'ADMIN' }, store });
  assert.deepEqual([again.r.state, again.r.url, again.events.length], ['already-open', 'https://github.test/own/pull/7', 1], 'an advisory with a PR open is not attempted again');
  assert.deepEqual(F.calls(), []);
});

test('ready: own-only lets an own PR open ready, and never an upstream one', () => {
  F.repo('tester/ready-own');
  assert.equal(run('tester/ready-own', { pol: policy({ ready: 'own-only' }), env: { STUB_PERM: 'ADMIN' } }).r.draft, false);
  assert.ok(!prCreate().includes('--draft'));
  F.repo('acme/ready');
  F.emptyBare('tester/ready');
  const up = run('acme/ready', { pol: policy({ ready: 'own-only' }), env: { STUB_PERM: 'READ' } });
  assert.equal(up.r.draft, true, JSON.stringify(up.r));
  assert.ok(prCreate().includes('--draft'));
});

test('upstream repository: forked under the gh identity, pushed to the fork, opened as a draft against upstream', () => {
  const up = F.repo('acme/widgets');
  const fork = F.emptyBare('tester/widgets');
  const { r, events } = run('acme/widgets', { env: { STUB_PERM: 'WRITE' } });
  assert.equal(r.state, 'opened', JSON.stringify(r));
  assert.equal(r.target, 'upstream');
  assert.ok(F.calls().some((a) => a[0] === 'repo' && a[1] === 'fork' && a[2] === 'acme/widgets'), 'the fork was made');
  assert.ok(F.ref(fork, `refs/heads/${BRANCH}`), 'the branch is on the fork');
  assert.equal(F.ref(up, `refs/heads/${BRANCH}`), null, 'nothing was pushed upstream');
  const create = prCreate();
  assert.deepEqual(create.slice(2, 8), ['--repo', 'acme/widgets', '--head', `tester:${BRANCH}`, '--base', 'main']);
  assert.ok(create.includes('--draft'));
  assert.equal(events[0].data.fork, 'tester/widgets');
  assert.equal(events[0].data.target, 'upstream');
});

test('the PR body names the advisory and link, the call path, the versions, the head probe, the commands and their results, and that nobody reviewed it', () => {
  F.repo('tester/body');
  run('tester/body', { env: { STUB_PERM: 'ADMIN' } });
  const b = captured.body;
  assert.match(b, /\[GO-2026-0001\]\(https:\/\/pkg\.go\.dev\/vuln\/GO-2026-0001\)/);
  assert.match(b, /- `example\.test\/widgets\/cmd\.main`\n- `example\.test\/dep\.Parse`/);
  assert.match(b, /\| `example\.test\/dep` \| v1\.0\.0 \| v1\.2\.0 \|/);
  assert.match(b, /`main` at `[0-9a-f]{40}` still reported GO-2026-0001 \(still-reachable-upstream\)/);
  assert.match(b, /\| `go build \.\/\.\.\.` \| 0 \| passed \|/);
  assert.match(b, /\| `govulncheck -format json \.\/\.\.\.` \| 0 \| GO-2026-0001 no longer reported/);
  assert.match(b, /Prepared 2026-10-22T03:00:00\.000Z by an automated tool \(commitwork remediation-draft-pr\)\. No person has reviewed it yet\.\n$/);
  assert.doesNotMatch(b, /fleet-widgets|ISS-/, 'nothing from the scanning side reaches the upstream');
});

test('a CLA is an ask that keeps the PR draft even where ready is allowed; a DCO is met with a sign-off', () => {
  F.repo('tester/cla', { 'CONTRIBUTING.md': 'Before we can merge, sign our Contributor License Agreement.\n\nEvery commit needs a Signed-off-by line (DCO).\n' });
  const { r, events } = run('tester/cla', { pol: policy({ ready: 'own-only' }), env: { STUB_PERM: 'ADMIN' } });
  assert.equal(r.state, 'opened', JSON.stringify(r));
  assert.equal(r.draft, true, 'a CLA keeps it draft');
  assert.match(captured.body, /### Before this leaves draft\n\n- \[ \] This repository asks for a contributor licence agreement \(CONTRIBUTING\.md\)/);
  assert.match(captured.body, /carries a `Signed-off-by` line for its author, as `CONTRIBUTING\.md` asks/);
  assert.equal(events[0].data.dco, true);
  assert.equal(events[0].data.asks.length, 1);
  assert.match(F.message(`${F.HOST}/tester/cla.git`, BRANCH), /\n\nSigned-off-by: Test Operator <operator@example\.test>$/);
});

test('every failure past the issue lookup is recorded with its reason, and a repeat of the same reason is not written twice', () => {
  F.repo('tester/fail');
  const store = F.store();
  const cases = [
    [{ env: { STUB_PERM: 'ADMIN' }, go: { buildOk: false } }, 'build-failed', /build-failed/],
    [{ env: { STUB_PERM: 'ADMIN' }, go: { verifyOk: false } }, 'advisory-check-failed', /still-reachable/],
    [{ env: { STUB_PERM: 'ADMIN' }, go: { fixed: true } }, 'upstream-already-fixed', /analysed-advisory-absent/],
    [{ env: { STUB_PERM: 'ADMIN' }, go: { applyOk: false } }, 'fix-did-not-apply', /exited 1/],
    [{ env: {} }, 'target-unreadable', /could not be read/],
    [{ env: { STUB_PERM: 'READ' }, pol: policy({ targets: ['own'] }) }, 'target-not-enabled', /is upstream \(READ\)/],
    [{ env: { STUB_PERM: 'ADMIN', STUB_CREATE_FAIL: '1' } }, 'create-pr-failed', /HTTP 422/],
  ];
  const BARE = `${F.HOST}/tester/fail.git`;
  for (const [opts, reason, detail] of cases) {
    if (reason === 'create-pr-failed') assert.equal(F.ref(BARE, `refs/heads/${BRANCH}`), null, 'no failure before create-pr pushed a branch');
    const { r, events } = run('tester/fail', { ...opts, store });
    assert.equal(r.state, 'not-opened', reason);
    assert.equal(r.reason, reason);
    assert.equal(r.recorded, true, reason);
    assert.equal(events.at(-1).type, 'remediation-pr-not-opened');
    assert.equal(events.at(-1).data.reason, reason);
    assert.match(events.at(-1).data.detail, detail);
  }
  const once = run('tester/fail', { env: { STUB_PERM: 'READ' }, pol: policy({ targets: ['own'] }), store });
  assert.equal(once.r.recorded, true, 'a changed reason is a new event');
  const before = loadIssues({ path: store.path }).events.length;
  const again = run('tester/fail', { env: { STUB_PERM: 'READ' }, pol: policy({ targets: ['own'] }), store });
  assert.equal(again.r.recorded, false, 'the same reason again is not a new event');
  assert.equal(loadIssues({ path: store.path }).events.length, before);
});

test('a default branch that cannot be cloned is never a target; an advisory with no issue is not attempted', () => {
  const missing = run('acme/absent', { env: { STUB_PERM: 'READ' } });
  assert.equal(missing.r.reason, 'default-branch-unreadable');
  assert.equal(missing.r.recorded, true);
  const orphan = run('acme/absent', { a: { repo: 'elsewhere' } });
  assert.equal(orphan.r.reason, 'no-issue');
  assert.equal(orphan.r.recorded, false);
  assert.deepEqual(F.calls(), [], 'nothing ran for an advisory it cannot record');
});

test('a dry run stops before any gh, git or go command', () => {
  F.resetCalls();
  const store = F.store();
  const r = openDraftRemediationPR(adv('acme/dry'), { policy: policy(), headState: LIVE, issues: { path: store.path }, env: F.env(), dryRun: true, seams: { probe: () => assert.fail('probe ran') } });
  assert.equal(r.state, 'ready-to-attempt');
  assert.deepEqual(F.calls(), []);
});
