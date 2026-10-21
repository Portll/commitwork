// Builds the commit message string for a remediation job (lib/cobolwork-remediation.mjs commitMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitMessage } from '../cobolwork-remediation.mjs';

test('returns a message with passed verdict and single attempt', () => {
  const job = {
    id: 'job-1',
    attempts: [1],
    finding: { rule: 'R1', path: 'p.cbl' },
    final: { verdict: 'pass', outcome: 'ok', attempt: 1 }
  };
  const expected = [
    'fix: R1 in p.cbl, passed by the cobolwork gate',
    '',
    'cobolwork gate: pass (ok), attempt 1 of 1, job job-1.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('returns a message with fail verdict and multiple attempts', () => {
  const job = {
    id: 'job-2',
    attempts: [1, 2, 3],
    finding: { rule: 'R2', path: 'q.cbl' },
    final: { verdict: 'fail', outcome: 'err', attempt: 3 }
  };
  const expected = [
    'fix: R2 in q.cbl, left undecided by the cobolwork gate',
    '',
    'cobolwork gate: fail (err), attempt 3 of 3, job job-2.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('returns a message with undecided verdict and operator note', () => {
  const job = {
    id: 'job-3',
    attempts: [1, 2],
    finding: { rule: 'R3', path: 'r.cbl' },
    final: { verdict: 'undecided', outcome: 'unknown', attempt: 2 }
  };
  const expected = [
    'fix: R3 in r.cbl, left undecided by the cobolwork gate',
    '',
    'cobolwork gate: undecided (unknown), attempt 2 of 2, job job-3.',
    'Applied by the operator with the gate undecided.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('handles missing finding object gracefully', () => {
  const job = {
    id: 'job-4',
    attempts: [1],
    final: { verdict: 'pass', outcome: 'ok', attempt: 1 }
  };
  const expected = [
    'fix:  in , passed by the cobolwork gate',
    '',
    'cobolwork gate: pass (ok), attempt 1 of 1, job job-4.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('handles missing attempts array gracefully', () => {
  const job = {
    id: 'job-5',
    finding: { rule: 'R5', path: 's.cbl' },
    final: { verdict: 'fail', outcome: 'bad', attempt: 1 }
  };
  const expected = [
    'fix: R5 in s.cbl, left undecided by the cobolwork gate',
    '',
    'cobolwork gate: fail (bad), attempt 1 of 0, job job-5.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('replaces non-printable characters in rule with question marks', () => {
  const job = {
    id: 'job-6',
    attempts: [1],
    finding: { rule: 'R\x006', path: 't.cbl' },
    final: { verdict: 'pass', outcome: 'ok', attempt: 1 }
  };
  const expected = [
    'fix: R?6 in t.cbl, passed by the cobolwork gate',
    '',
    'cobolwork gate: pass (ok), attempt 1 of 1, job job-6.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('truncates rule to 80 characters', () => {
  const longRule = 'A'.repeat(100);
  const job = {
    id: 'job-7',
    attempts: [1],
    finding: { rule: longRule, path: 'u.cbl' },
    final: { verdict: 'pass', outcome: 'ok', attempt: 1 }
  };
  const expected = [
    `fix: ${'A'.repeat(80)} in u.cbl, passed by the cobolwork gate`,
    '',
    'cobolwork gate: pass (ok), attempt 1 of 1, job job-7.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});

test('truncates path to 120 characters', () => {
  const longPath = 'B'.repeat(150);
  const job = {
    id: 'job-8',
    attempts: [1],
    finding: { rule: 'R8', path: longPath },
    final: { verdict: 'pass', outcome: 'ok', attempt: 1 }
  };
  const expected = [
    `fix: R8 in ${'B'.repeat(120)}, passed by the cobolwork gate`,
    '',
    'cobolwork gate: pass (ok), attempt 1 of 1, job job-8.',
    '',
  ].join('\n');
  assert.equal(commitMessage(job), expected);
});
