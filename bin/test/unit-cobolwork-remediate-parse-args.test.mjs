// Parses CLI argv into an options object with flags and positional args (bin/cobolwork-remediate.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../cobolwork-remediate.mjs';

test('returns empty object with empty positional array for empty argv', () => {
  const result = parseArgs([]);
  assert.deepEqual(result, { _: [] });
});

test('collects positional arguments into underscore array', () => {
  const result = parseArgs(['foo', 'bar', 'baz']);
  assert.deepEqual(result, { _: ['foo', 'bar', 'baz'] });
});

test('parses --repo option with value', () => {
  const result = parseArgs(['--repo', '/path/to/repo']);
  assert.equal(result.repo, '/path/to/repo');
  assert.deepEqual(result._, []);
});

test('parses --fingerprint option with value', () => {
  const result = parseArgs(['--fingerprint', 'abc123']);
  assert.equal(result.fingerprint, 'abc123');
  assert.deepEqual(result._, []);
});

test('parses --name option with value', () => {
  const result = parseArgs(['--name', 'my-job']);
  assert.equal(result.name, 'my-job');
  assert.deepEqual(result._, []);
});

test('parses --attempts option as number', () => {
  const result = parseArgs(['--attempts', '3']);
  assert.equal(result.attempts, 3);
  assert.deepEqual(result._, []);
});

test('parses --job option with value', () => {
  const result = parseArgs(['--job', 'job-42']);
  assert.equal(result.job, 'job-42');
  assert.deepEqual(result._, []);
});

test('parses --dir option with value', () => {
  const result = parseArgs(['--dir', '/tmp/jobs']);
  assert.equal(result.dir, '/tmp/jobs');
  assert.deepEqual(result._, []);
});

test('sets remote flag to true for --remote', () => {
  const result = parseArgs(['--remote']);
  assert.equal(result.remote, true);
  assert.deepEqual(result._, []);
});

test('sets acknowledgeUndecided flag to true for --acknowledge-undecided', () => {
  const result = parseArgs(['--acknowledge-undecided']);
  assert.equal(result.acknowledgeUndecided, true);
  assert.deepEqual(result._, []);
});

test('throws error for unknown option starting with double dash', () => {
  assert.throws(() => parseArgs(['--unknown-flag']), /unknown option --unknown-flag/);
});

test('throws error when option value is missing at end of argv', () => {
  assert.throws(() => parseArgs(['--repo']), /--repo needs a value/);
});

test('throws error when option value starts with double dash', () => {
  assert.throws(() => parseArgs(['--repo', '--fingerprint']), /--repo needs a value/);
});

test('parses multiple options and positional args together', () => {
  const result = parseArgs(['--repo', '/repo', 'pos1', '--attempts', '2', 'pos2']);
  assert.equal(result.repo, '/repo');
  assert.equal(result.attempts, 2);
  assert.deepEqual(result._, ['pos1', 'pos2']);
});
