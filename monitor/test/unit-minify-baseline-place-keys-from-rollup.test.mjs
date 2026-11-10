// Extracts sorted minifiedCode place keys per repo from a rollup document (monitor/minify-baseline.mjs placeKeysFromRollup).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeKeysFromRollup } from '../minify-baseline.mjs';

test('returns empty object when rollup is null', () => {
  const r = placeKeysFromRollup(null);
  assert.deepEqual(r, {});
});

test('returns empty object when rollup has no scannerFindings', () => {
  const r = placeKeysFromRollup({});
  assert.deepEqual(r, {});
});

test('returns empty object when scannerFindings lacks minifiedCode category', () => {
  const r = placeKeysFromRollup({ scannerFindings: { other: [] } });
  assert.deepEqual(r, {});
});

test('returns empty object when minifiedCode findings array is empty', () => {
  const r = placeKeysFromRollup({ scannerFindings: { minifiedCode: [] } });
  assert.deepEqual(r, {});
});

test('skips rows missing repo, rule, or file fields', () => {
  const r = placeKeysFromRollup({
    scannerFindings: {
      minifiedCode: [
        { rule: 'r1', file: 'f1' },
        { repo: 'a', file: 'f1' },
        { repo: 'a', rule: 'r1' },
        null,
        { repo: 'a', rule: 'r1', file: 'f1' }
      ]
    }
  });
  assert.deepEqual(r, { a: ["sc:a|minifiedCode|r1|f1"] });
});

test('deduplicates identical place keys within the same repo', () => {
  const r = placeKeysFromRollup({
    scannerFindings: {
      minifiedCode: [
        { repo: 'a', rule: 'r1', file: 'f1' },
        { repo: 'a', rule: 'r1', file: 'f1' },
        { repo: 'a', rule: 'r1', file: 'f1' }
      ]
    }
  });
  assert.deepEqual(r, { a: ["sc:a|minifiedCode|r1|f1"] });
});

test('sorts place keys alphabetically within each repo', () => {
  const r = placeKeysFromRollup({
    scannerFindings: {
      minifiedCode: [
        { repo: 'a', rule: 'z', file: 'f' },
        { repo: 'a', rule: 'a', file: 'f' },
        { repo: 'a', rule: 'm', file: 'f' }
      ]
    }
  });
  assert.deepEqual(r, { a: ["sc:a|minifiedCode|a|f", "sc:a|minifiedCode|m|f", "sc:a|minifiedCode|z|f"] });
});

test('groups findings by repo with separate key arrays', () => {
  const r = placeKeysFromRollup({
    scannerFindings: {
      minifiedCode: [
        { repo: 'b', rule: 'r1', file: 'f1' },
        { repo: 'a', rule: 'r1', file: 'f1' },
        { repo: 'b', rule: 'r2', file: 'f2' }
      ]
    }
  });
  assert.deepEqual(r, { b: ["sc:b|minifiedCode|r1|f1", "sc:b|minifiedCode|r2|f2"], a: ["sc:a|minifiedCode|r1|f1"] });
});
