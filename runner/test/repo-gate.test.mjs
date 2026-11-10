import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVING_POLICY, repoGate } from '../repo-gate.mjs';
import { fixture } from './lib/fixtures.mjs';

const policy = (p) => ({ approval_policy: p });

test('a private repository is served whatever the fork policy says', () => {
  const g = repoGate(fixture('repo-private.json'), null);
  assert.deepEqual([g.served, g.code], [true, 'repo-private']);
  assert.equal(repoGate(fixture('repo-private.json'), policy('first_time_contributors')).served, true);
});

test('a public repository with the wrong fork policy is refused, naming the policy', () => {
  const g = repoGate(fixture('repo-public.json'), fixture('fork-approval.json'));
  assert.deepEqual([g.served, g.code], [false, 'repo-approval-weak']);
  assert.match(g.reason, /first_time_contributors/);
  assert.equal(repoGate(fixture('repo-public.json'), policy('first_time_contributors_new_to_github')).code, 'repo-approval-weak');
});

test('a public repository is served only at all_external_contributors', () => {
  const g = repoGate(fixture('repo-public.json'), policy(SERVING_POLICY));
  assert.deepEqual([g.served, g.code], [true, 'repo-public-approved']);
});

test('unreadable metadata or policy is unmeasured, not served and not refused', () => {
  const err = { error: { status: 502, reason: 'Bad Gateway' } };
  assert.deepEqual([repoGate(err, null).served, repoGate(err, null).code], [false, 'repo-unmeasured']);
  const p = repoGate(fixture('repo-public.json'), err);
  assert.deepEqual([p.served, p.code], [false, 'repo-unmeasured']);
  assert.match(p.reason, /502 Bad Gateway/);
  assert.equal(repoGate({}, null).code, 'repo-unmeasured');
});

test('visibility falls back to the private flag; any other visibility is refused', () => {
  assert.equal(repoGate({ private: true }, null).code, 'repo-private');
  assert.equal(repoGate({ private: false }, policy('first_time_contributors')).code, 'repo-approval-weak');
  assert.equal(repoGate({ visibility: 'internal', private: true }, null).code, 'repo-visibility-unsupported');
});
