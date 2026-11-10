// Parses a transcript into JSON steps and counts unparseable lines (bin/lib/turn-recorder-core.mjs parseTranscript).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTranscript } from '../lib/turn-recorder-core.mjs';

test('returns empty steps and zero unparseable for empty string', () => {
  const r = parseTranscript('');
  assert.deepEqual(r, { steps: [], unparseable: 0 });
});

test('returns empty steps and zero unparseable for null input', () => {
  const r = parseTranscript(null);
  assert.deepEqual(r, { steps: [], unparseable: 0 });
});

test('returns empty steps and zero unparseable for whitespace-only line', () => {
  const r = parseTranscript('   ');
  assert.deepEqual(r, { steps: [], unparseable: 0 });
});

test('parses a single valid JSON object into steps', () => {
  const r = parseTranscript('{"a":1}');
  assert.deepEqual(r, { steps: [{ a: 1 }], unparseable: 0 });
});

test('counts one unparseable line for invalid JSON', () => {
  const r = parseTranscript('not json');
  assert.deepEqual(r, { steps: [], unparseable: 1 });
});

test('parses valid JSON array into steps', () => {
  const r = parseTranscript('[1,2]');
  assert.deepEqual(r, { steps: [[1, 2]], unparseable: 0 });
});

test('excludes valid JSON primitive from steps', () => {
  const r = parseTranscript('42');
  assert.deepEqual(r, { steps: [], unparseable: 0 });
});

test('excludes valid JSON null from steps', () => {
  const r = parseTranscript('null');
  assert.deepEqual(r, { steps: [], unparseable: 0 });
});

test('handles mixed valid and invalid lines', () => {
  const r = parseTranscript('{"x":1}\nbad\n{"y":2}');
  assert.deepEqual(r, { steps: [{ x: 1 }, { y: 2 }], unparseable: 1 });
});

test('counts multiple unparseable lines', () => {
  const r = parseTranscript('bad1\nbad2\nbad3');
  assert.deepEqual(r, { steps: [], unparseable: 3 });
});
