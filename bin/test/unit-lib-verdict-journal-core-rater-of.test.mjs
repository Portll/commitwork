// The rater identity for a verdict record, with a suffix for model-default sampling (bin/lib/verdict-journal-core.mjs raterOf).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { raterOf } from '../lib/verdict-journal-core.mjs';

test('returns the method when present and sampling is not model-default', () => {
  const r = raterOf({ method: 'm1', sampling: 'pinned' });
  assert.equal(r, "m1");
});

test('returns the method with a suffix when sampling is model-default', () => {
  const r = raterOf({ method: 'm1', sampling: 'model-default' });
  assert.equal(r, "m1 [model-default sampling]");
});

test('returns the adjudicatedBy when method is absent and sampling is not model-default', () => {
  const r = raterOf({ adjudicatedBy: 'a1', sampling: 'pinned' });
  assert.equal(r, "a1");
});

test('returns the adjudicatedBy with a suffix when sampling is model-default', () => {
  const r = raterOf({ adjudicatedBy: 'a1', sampling: 'model-default' });
  assert.equal(r, "a1 [model-default sampling]");
});

test('returns the canary when method and adjudicatedBy are absent and sampling is not model-default', () => {
  const r = raterOf({ canary: 'c1', sampling: 'pinned' });
  assert.equal(r, "c1");
});

test('returns the canary with a suffix when sampling is model-default', () => {
  const r = raterOf({ canary: 'c1', sampling: 'model-default' });
  assert.equal(r, "c1 [model-default sampling]");
});

test('returns null when no rater fields are present', () => {
  const r = raterOf({ sampling: 'pinned' });
  assert.equal(r, null);
});

test('returns null when the record is empty', () => {
  const r = raterOf({});
  assert.equal(r, null);
});
