// Extracts test counts and failing test names from suite output (bin/gate-tests-core.mjs parseSuiteOutput).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSuiteOutput } from '../gate-tests-core.mjs';

test('returns null counts and empty names for empty input', () => {
  const r = parseSuiteOutput('');
  assert.deepEqual(r, { tests: null, fail: null, pass: null, names: [] });
});

test('returns null counts and empty names for null input', () => {
  const r = parseSuiteOutput(null);
  assert.deepEqual(r, { tests: null, fail: null, pass: null, names: [] });
});

test('returns null counts and empty names for undefined input', () => {
  const r = parseSuiteOutput(undefined);
  assert.deepEqual(r, { tests: null, fail: null, pass: null, names: [] });
});

test('parses counts and names from typical suite output', () => {
  const out = [
    '\u2139 tests 5',
    '\u2139 fail 2',
    '\u2139 pass 3',
    '\u2716 test one (10ms)',
    '\u2716 test two (20ms)',
  ].join('\n');
  const r = parseSuiteOutput(out);
  assert.deepEqual(r, { tests: 5, fail: 2, pass: 3, names: ["test one", "test two"] });
});

test('deduplicates repeated failing test names', () => {
  const out = [
    '\u2139 tests 3',
    '\u2139 fail 1',
    '\u2139 pass 2',
    '\u2716 same test (5ms)',
    '\u2716 same test (6ms)',
  ].join('\n');
  const r = parseSuiteOutput(out);
  assert.deepEqual(r, { tests: 3, fail: 1, pass: 2, names: ["same test"] });
});

test('returns null for missing count lines', () => {
  const out = '\u2139 tests 1\n\u2139 pass 1';
  const r = parseSuiteOutput(out);
  assert.deepEqual(r, { tests: 1, fail: null, pass: 1, names: [] });
});

test('handles non-string input by coercing to string', () => {
  const r = parseSuiteOutput(123);
  assert.deepEqual(r, { tests: null, fail: null, pass: null, names: [] });
});

test('parses output with only failing test lines and no counts', () => {
  const out = '\u2716 alpha (1ms)\n\u2716 beta (2ms)';
  const r = parseSuiteOutput(out);
  assert.deepEqual(r, { tests: null, fail: null, pass: null, names: ["alpha", "beta"] });
});
