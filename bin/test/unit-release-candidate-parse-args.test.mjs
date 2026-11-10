// Parses release-candidate CLI flags into an options object or an error (bin/release-candidate.mjs parseArgs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { parseArgs } from '../release-candidate.mjs';

const defaults = { project: 'commitwork', ref: 'HEAD', out: null, date: null, message: null, skipTests: false, testTimeoutMin: null, json: false, journalIt: true };

test('An empty argv returns the default options', () => {
  assert.deepEqual(parseArgs([]), defaults);
});

test('Every valued and boolean flag is applied to the options', () => {
  const r = parseArgs(['--project', 'myproj', '--ref', 'v1.0', '--out', 'dist', '--date', '2024-01-01', '--message', 'Release', '--test-timeout', '5', '--skip-tests', '--json', '--no-journal']);
  assert.deepEqual(r, { project: 'myproj', ref: 'v1.0', out: resolve('dist'), date: '2024-01-01', message: 'Release', skipTests: true, testTimeoutMin: 5, json: true, journalIt: false });
});

test('A flag whose value is missing, empty or another flag returns a needs-a-value error', () => {
  assert.deepEqual(parseArgs(['--project']), { error: '--project needs a value' });
  assert.deepEqual(parseArgs(['--ref', '']), { error: '--ref needs a value' });
  assert.deepEqual(parseArgs(['--ref', '--json']), { error: '--ref needs a value' });
});

test('An unknown flag returns an unknown flag error even after a valid flag', () => {
  assert.deepEqual(parseArgs(['--bogus']), { error: 'unknown flag: --bogus' });
  assert.deepEqual(parseArgs(['--json', '--bogus']), { error: 'unknown flag: --bogus' });
});

test('The json flag alone only turns json on', () => {
  assert.deepEqual(parseArgs(['--json']), { ...defaults, json: true });
});

test('The no-journal flag alone only turns journaling off', () => {
  assert.deepEqual(parseArgs(['--no-journal']), { ...defaults, journalIt: false });
});

test('The skip-tests and message flags alone only set their own fields', () => {
  assert.deepEqual(parseArgs(['--skip-tests']), { ...defaults, skipTests: true });
  assert.deepEqual(parseArgs(['--message', 'hi']), { ...defaults, message: 'hi' });
});

test('A test timeout must be strictly greater than zero minutes', () => {
  const err = { error: '--test-timeout must be a positive number of minutes' };
  assert.deepEqual(parseArgs(['--test-timeout', '0']), err);
  assert.deepEqual(parseArgs(['--test-timeout', '-1']), err);
  assert.deepEqual(parseArgs(['--test-timeout', 'abc']), err);
  assert.deepEqual(parseArgs(['--test-timeout', '1']), { ...defaults, testTimeoutMin: 1 });
});

test('Both the long and short help flags set help to true', () => {
  assert.deepEqual(parseArgs(['--help']), { ...defaults, help: true });
  assert.deepEqual(parseArgs(['-h']), { ...defaults, help: true });
});
