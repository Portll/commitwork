// Appends a point to a newline-delimited JSON history, deduping by timestamp and capping length. (monitor/unknown-rate.mjs appendHistory).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendHistory } from '../unknown-rate.mjs';

test('returns a single newline when text is null and point is provided', () => {
  const r = appendHistory(null, { at: 1 });
  assert.equal(r, "{\"at\":1}\n");
});

test('returns a single newline when text is an empty string and point is provided', () => {
  const r = appendHistory('', { at: 1 });
  assert.equal(r, "{\"at\":1}\n");
});

test('throws with line number 1 when the first line is invalid JSON', () => {
  assert.throws(() => appendHistory('not-json\n{"at":2}', { at: 3 }), { name: "Error", message: "unknown-rate history line 1 does not parse: Unexpected token 'o', \"not-json\" is not valid JSON" });
});

test('throws with line number 2 when the second line is invalid JSON', () => {
  assert.throws(() => appendHistory('{"at":1}\nnot-json', { at: 3 }), { name: "Error", message: "unknown-rate history line 2 does not parse: Unexpected token 'o', \"not-json\" is not valid JSON" });
});

test('does not duplicate when the last line has the same timestamp as the point', () => {
  const r = appendHistory('{"at":1}', { at: 1 });
  assert.equal(r, "{\"at\":1}\n");
});

test('appends a new line when the last line has a different timestamp', () => {
  const r = appendHistory('{"at":1}', { at: 2 });
  assert.equal(r, "{\"at\":1}\n{\"at\":2}\n");
});

test('caps the history to the last 2 lines when cap is 2 and there are 3 lines', () => {
  const r = appendHistory('{"at":1}\n{"at":2}\n{"at":3}', { at: 4 }, 2);
  assert.equal(r, "{\"at\":3}\n{\"at\":4}\n");
});

test('returns a single newline when text is undefined and point is provided', () => {
  const r = appendHistory(undefined, { at: 1 });
  assert.equal(r, "{\"at\":1}\n");
});
