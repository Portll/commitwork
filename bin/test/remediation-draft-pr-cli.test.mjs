// bin/remediation-draft-pr.mjs: without --open it reports and runs nothing; the shipped report mode
// opens nothing even with --open; an unreadable policy is exit 3, not an empty run; --reconcile
// records a merge. Against a temporary policy, issue store and the fake gh of the monitor suites.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appendIssueEvent, loadIssues } from '../../monitor/issue-store.mjs';
import { makeFixture, adv, AT } from '../../monitor/test/lib/draft-pr-fixture.mjs';

const CLI = resolve(import.meta.dirname, '..', 'remediation-draft-pr.mjs');
const F = makeFixture();
after(() => rmSync(F.TMP, { recursive: true, force: true }));
const INPUT = join(F.TMP, 'advisories.json');
writeFileSync(INPUT, JSON.stringify({ advisories: [adv('acme/cli')], headStates: { 'GO-2026-0001': { fixed: false } } }));
const policyFile = (doc) => { const p = join(F.TMP, `policy-${Math.random().toString(36).slice(2)}.json`); writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc)); return p; };
const cli = (args, env) => { F.resetCalls(); return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: F.env(env) }); };

test('a dry run names what would be attempted and runs no gh command', () => {
  const store = F.store();
  const r = cli([INPUT], { CW_REMEDIATION_POLICY: policyFile({ mode: 'draft-pr' }), CW_ISSUES: store.path });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).state, 'ready-to-attempt');
  assert.match(r.stderr, /dry run \(pass --open to act\): ready-to-attempt=1/);
  assert.deepEqual(F.calls(), []);
});

test('report mode opens nothing even with --open', () => {
  const r = cli([INPUT, '--open'], { CW_REMEDIATION_POLICY: policyFile({ mode: 'report' }), CW_ISSUES: F.store().path });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).state, 'disabled');
  assert.deepEqual(F.calls(), []);
});

test('an unreadable policy is exit 3 and no input is usage exit 2', () => {
  assert.equal(cli([INPUT], { CW_REMEDIATION_POLICY: policyFile('{ nope'), CW_ISSUES: F.store().path }).status, 3);
  assert.equal(cli([], {}).status, 2);
});

test('--reconcile records a merged PR on its issue', () => {
  const store = F.store([(doc, id) => appendIssueEvent(doc, 'remediation-pr-opened', id, { advisory: 'GO-2026-0001', package: 'example.test/dep', upstream: 'acme/cli', url: 'https://github.test/acme/cli/pull/1', draft: true }, AT)]);
  const r = cli(['--reconcile'], { CW_ISSUES: store.path, STUB_PR_VIEW: JSON.stringify({ state: 'MERGED', mergedAt: AT, mergedBy: { login: 'maintainer' } }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout.trim()).state, 'MERGED');
  assert.ok(F.calls().some((a) => a[0] === 'pr' && a[1] === 'view' && a[2] === 'https://github.test/acme/cli/pull/1'));
  assert.deepEqual(loadIssues({ path: store.path }).events.slice(-2).map((e) => e.type), ['remediation-pr-merged', 'fix-authored']);
});
