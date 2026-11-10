// Splits raw attest log text into non-empty lines and flags a torn tail (cra/attest.mjs splitAttestLog).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitAttestLog } from '../attest.mjs';

test('returns empty lines and null torn for empty string', () => {
  const result = splitAttestLog('');
  assert.deepEqual(result, { lines: [], torn: null });
});

test('returns empty lines and torn object when input is a single non-empty line without newline', () => {
  const result = splitAttestLog('{"a":1}');
  assert.deepEqual(result, { lines: [], torn: { bytes: 7 } });
});

test('returns lines and null torn when input ends with newline', () => {
  const result = splitAttestLog('{"a":1}\n{"b":2}\n');
  assert.deepEqual(result, { lines: ['{"a":1}', '{"b":2}'], torn: null });
});

test('returns lines and torn object when input does not end with newline', () => {
  const result = splitAttestLog('{"a":1}\n{"b":2');
  assert.deepEqual(result, { lines: ['{"a":1}'], torn: { bytes: 6 } });
});

test('filters out blank lines from the lines array', () => {
  const result = splitAttestLog('{"a":1}\n\n{"b":2}\n');
  assert.deepEqual(result, { lines: ['{"a":1}', '{"b":2}'], torn: null });
});

test('torn is null when tail is only whitespace', () => {
  const result = splitAttestLog('{"a":1}\n   \n');
  assert.deepEqual(result, { lines: ['{"a":1}'], torn: null });
});

test('torn bytes count reflects untrimmed tail length', () => {
  const result = splitAttestLog('{"a":1}\n  {"b":2  ');
  assert.deepEqual(result, { lines: ['{"a":1}'], torn: { bytes: 10 } });
});

test('coerces non-string input to string before splitting', () => {
  const result = splitAttestLog(null);
  assert.deepEqual(result, { lines: [], torn: { bytes: 4 } });
});
