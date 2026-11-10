// Computes the sub-row key for a scanner row (monitor/feed-groups.mjs subRowKeyFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { subRowKeyFor } from '../feed-groups.mjs';

test('returns the store key when the row is keyable in the issue store', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: 'no-eval', package: 'lodash' });
  assert.equal(r, "sc:acme/widget|main|no-eval|");
});

test('falls back to declared identity fields when the store key is null', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: 'no-eval', package: 'lodash', control: 'C1', id: 'I1', marker: 'M1', detector: 'D1', name: 'N1' });
  assert.equal(r, "sc:acme/widget|main|no-eval|");
});

test('uses only the declared identity fields present in the row when the store key is null', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: 'no-eval', id: 'I1' });
  assert.equal(r, "sc:acme/widget|main|no-eval|");
});

test('uses the fallback subject fields when no declared identity exists and the store key is null', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: 'no-eval', package: 'lodash', control: 'C1', id: 'I1', marker: 'M1', detector: 'D1', name: 'N1' });
  assert.equal(r, "sc:acme/widget|main|no-eval|");
});

test('excludes fields with undefined values from the fallback identity', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: 'no-eval', package: undefined, control: 'C1', id: undefined, marker: 'M1', detector: undefined, name: 'N1' });
  assert.equal(r, "sc:acme/widget|main|no-eval|");
});

test('includes all fallback fields when every field is defined and the store key is null', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: 'no-eval', package: 'lodash', control: 'C1', id: 'I1', marker: 'M1', detector: 'D1', name: 'N1' });
  assert.equal(r, "sc:acme/widget|main|no-eval|");
});

test('handles a row with only repo and lane when the store key is null', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget' });
  assert.equal(r, "acme/widget\u0000main");
});

test('handles a row with empty string values in fallback fields', () => {
  const r = subRowKeyFor('main', { repo: 'acme/widget', rule: '', package: '', control: '', id: '', marker: '', detector: '', name: '' });
  assert.equal(r, "acme/widget\u0000main\u0000\u0000\u0000\u0000\u0000\u0000\u0000");
});
