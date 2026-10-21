// cra/test/attest-units.test.mjs — case tests for splitAttestLog.
import test from 'node:test';
import assert from 'node:assert/strict';
import { splitAttestLog } from '../attest.mjs';

test('empty string', () => {
  const r = splitAttestLog('');
  assert.deepEqual(r, { lines: [], torn: null });
});

test('single line without trailing newline', () => {
  const r = splitAttestLog('abc');
  assert.deepEqual(r, { lines: [], torn: { bytes: 3 } });
});

test('single line with trailing newline', () => {
  const r = splitAttestLog('abc\n');
  assert.deepEqual(r, { lines: ['abc'], torn: null });
});

test('multiple lines with trailing newline', () => {
  const r = splitAttestLog('a\nb\nc\n');
  assert.deepEqual(r, { lines: ['a', 'b', 'c'], torn: null });
});

test('multiple lines without trailing newline', () => {
  const r = splitAttestLog('a\nb\nc');
  assert.deepEqual(r, { lines: ['a', 'b'], torn: { bytes: 1 } });
});

test('blank lines are filtered out', () => {
  const r = splitAttestLog('a\n\nb\n');
  assert.deepEqual(r, { lines: ['a', 'b'], torn: null });
});

test('torn tail with whitespace is null', () => {
  const r = splitAttestLog('a\n  \n');
  assert.deepEqual(r, { lines: ['a'], torn: null });
});

test('non-string input is coerced via String()', () => {
  const r = splitAttestLog(123);
  assert.deepEqual(r, { lines: [], torn: { bytes: 3 } });
});
