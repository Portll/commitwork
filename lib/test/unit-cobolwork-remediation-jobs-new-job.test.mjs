// Builds a queued remediation job object with schema, id, and initial state (lib/cobolwork-remediation-jobs.mjs newJob).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newJob } from '../cobolwork-remediation-jobs.mjs';

test('returns schema constant for any input', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.equal(job.schema, 'commitwork/cobolwork-remediation-job.v1');
});

test('returns queued state and null final, review, applied, error', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.equal(job.state, 'queued');
  assert.equal(job.final, null);
  assert.equal(job.review, null);
  assert.equal(job.applied, null);
  assert.equal(job.error, null);
});

test('returns empty events and attempts arrays', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.deepEqual(job.events, []);
  assert.deepEqual(job.attempts, []);
});

test('returns empty verifications array', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.deepEqual(job.verifications, []);
});

test('coerces remote false to boolean false', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', remote: false });
  assert.equal(job.remote, false);
  assert.equal(job.sourceLeavesMachine, false);
});

test('coerces remote true to boolean true', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', remote: true });
  assert.equal(job.remote, true);
  assert.equal(job.sourceLeavesMachine, true);
});

test('coerces remote 0 to boolean false', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', remote: 0 });
  assert.equal(job.remote, false);
  assert.equal(job.sourceLeavesMachine, false);
});

test('coerces remote 1 to boolean true', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', remote: 1 });
  assert.equal(job.remote, true);
  assert.equal(job.sourceLeavesMachine, true);
});

test('coerces remote empty string to boolean false', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', remote: '' });
  assert.equal(job.remote, false);
  assert.equal(job.sourceLeavesMachine, false);
});

test('coerces remote non-empty string to boolean true', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', remote: 'yes' });
  assert.equal(job.remote, true);
  assert.equal(job.sourceLeavesMachine, true);
});

test('defaults maxAttempts to 3 when omitted', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.equal(job.maxAttempts, 3);
});

test('uses provided maxAttempts value', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', maxAttempts: 5 });
  assert.equal(job.maxAttempts, 5);
});

test('defaults project to null when omitted', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.equal(job.project, null);
});

test('uses provided project value', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', project: 'proj' });
  assert.equal(job.project, 'proj');
});

test('passes through repo and fingerprint', () => {
  const job = newJob({ repo: '/my/repo', fingerprint: 'abc123' });
  assert.equal(job.repo, '/my/repo');
  assert.equal(job.fingerprint, 'abc123');
});

test('passes through engines value', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1', engines: ['e1', 'e2'] });
  assert.deepEqual(job.engines, ['e1', 'e2']);
});

test('createdAt is a string from iso helper', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.equal(typeof job.createdAt, 'string');
  assert.ok(job.createdAt.length > 0);
});

test('defaults remote to false when omitted', () => {
  const job = newJob({ repo: '/r', fingerprint: 'fp1' });
  assert.equal(job.remote, false);
  assert.equal(job.sourceLeavesMachine, false);
});
