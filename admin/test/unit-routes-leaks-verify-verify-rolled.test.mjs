// Verifies whether a leaked value was rolled by checking git history (admin/routes/leaks-verify.mjs verifyRolled).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRolled } from '../routes/leaks-verify.mjs';

const longToken = 'a'.repeat(12);
const shortToken = 'a'.repeat(11);

test('returns weak none when no token is found', () => {
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${shortToken}`, run: () => null });
  assert.equal(result.tier, 'weak');
  assert.equal(result.verdict, 'none');
  assert.equal(result.detail, `no run of 12+ characters on the line to trace through history`);
  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].name, 'trace-token');
  assert.equal(result.checks[0].result, 'unavailable');
});

test('returns weak none when git is unavailable', () => {
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${longToken}`, run: () => null });
  assert.equal(result.tier, 'weak');
  assert.equal(result.verdict, 'none');
  assert.equal(result.detail, 'no history to read; the claim could not be checked');
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[0].name, 'trace-token');
  assert.equal(result.checks[0].result, 'pass');
  assert.equal(result.checks[1].name, 'git');
  assert.equal(result.checks[1].result, 'unavailable');
});

test('returns weak none when annotation time is missing', () => {
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: null, matched: `value=${longToken}`, run: () => 'ok' });
  assert.equal(result.tier, 'weak');
  assert.equal(result.verdict, 'none');
  assert.equal(result.detail, 'without the annotation time there is no interval to search');
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[1].name, 'annotation-time');
  assert.equal(result.checks[1].result, 'unavailable');
});

test('returns weak none when no commit exists before annotation time', () => {
  const run = (cwd, args) => {
    if (args[0] === 'rev-parse') return 'ok';
    if (args[0] === 'rev-list') return null;
    return null;
  };
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${longToken}`, run });
  assert.equal(result.tier, 'weak');
  assert.equal(result.verdict, 'none');
  assert.equal(result.detail, 'the file has no committed state as of the annotation');
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[1].name, 'blob-at-annotation');
  assert.equal(result.checks[1].result, 'unavailable');
});

test('returns strong contradicts when value is still present in old blob', () => {
  const run = (cwd, args) => {
    if (args[0] === 'rev-parse') return 'ok';
    if (args[0] === 'rev-list') return 'abc123def456\n';
    if (args[0] === 'show') return `value=${longToken}`;
    if (args[0] === 'log') return '';
    return null;
  };
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${longToken}`, run });
  assert.equal(result.tier, 'strong');
  assert.equal(result.verdict, 'contradicts');
  assert.equal(result.detail, `the value on this line is byte-identical to f.txt as of 2024-01-01 \u2014 nothing was rolled`);
  assert.equal(result.checks.length, 3);
  assert.equal(result.checks[1].result, 'fail');
  assert.equal(result.checks[2].result, 'fail');
});

test('returns strong supports when value changed in commits after annotation', () => {
  const run = (cwd, args) => {
    if (args[0] === 'rev-parse') return 'ok';
    if (args[0] === 'rev-list') return 'abc123def456\n';
    if (args[0] === 'show') return 'other content';
    if (args[0] === 'log') return 'newcommit123\n';
    return null;
  };
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${longToken}`, run });
  assert.equal(result.tier, 'strong');
  assert.equal(result.verdict, 'supports');
  assert.equal(result.detail, 'the value changed in 1 commit(s) after 2024-01-01; latest newcommit123');
  assert.equal(result.checks.length, 3);
  assert.equal(result.checks[1].result, 'pass');
  assert.equal(result.checks[2].result, 'pass');
});

test('returns medium supports when value absent but no commits found', () => {
  const run = (cwd, args) => {
    if (args[0] === 'rev-parse') return 'ok';
    if (args[0] === 'rev-list') return 'abc123def456\n';
    if (args[0] === 'show') return 'other content';
    if (args[0] === 'log') return '';
    return null;
  };
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${longToken}`, run });
  assert.equal(result.tier, 'medium');
  assert.equal(result.verdict, 'supports');
  assert.equal(result.detail, `today's value is absent from f.txt as of 2024-01-01, but no commit in the interval names the change`);
  assert.equal(result.checks.length, 3);
  assert.equal(result.checks[1].result, 'pass');
  assert.equal(result.checks[2].result, 'fail');
});

test('returns weak none when blob cannot be read', () => {
  const run = (cwd, args) => {
    if (args[0] === 'rev-parse') return 'ok';
    if (args[0] === 'rev-list') return 'abc123def456\n';
    if (args[0] === 'show') return null;
    return null;
  };
  const result = verifyRolled({ root: '/repo', file: 'f.txt', at: '2024-01-01', matched: `value=${longToken}`, run });
  assert.equal(result.tier, 'weak');
  assert.equal(result.verdict, 'none');
  assert.equal(result.detail, 'the file as of the annotation could not be read');
  assert.equal(result.checks.length, 2);
  assert.equal(result.checks[1].name, 'blob-at-annotation');
  assert.equal(result.checks[1].result, 'unavailable');
});
