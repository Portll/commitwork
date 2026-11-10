// Whether a PR opens as draft (monitor/draft-pr-gates.mjs opensAsDraft).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opensAsDraft } from '../draft-pr-gates.mjs';

test('returns true when ready is not own-only', () => {
  const r = opensAsDraft({ ready: 'all', target: 'own', asks: [] });
  assert.equal(r, true);
});

test('returns true when target is not own', () => {
  const r = opensAsDraft({ ready: 'own-only', target: 'other', asks: [] });
  assert.equal(r, true);
});

test('returns true when asks is non-empty', () => {
  const r = opensAsDraft({ ready: 'own-only', target: 'own', asks: ['x'] });
  assert.equal(r, true);
});

test('returns false when ready is own-only, target is own, and asks is empty', () => {
  const r = opensAsDraft({ ready: 'own-only', target: 'own', asks: [] });
  assert.equal(r, false);
});

test('returns true when ready is own-only and target is own but asks has one item', () => {
  const r = opensAsDraft({ ready: 'own-only', target: 'own', asks: ['a'] });
  assert.equal(r, true);
});

test('returns true when ready is all and target is own with empty asks', () => {
  const r = opensAsDraft({ ready: 'all', target: 'own', asks: [] });
  assert.equal(r, true);
});

test('returns true when ready is own-only and target is other with empty asks', () => {
  const r = opensAsDraft({ ready: 'own-only', target: 'other', asks: [] });
  assert.equal(r, true);
});

test('returns false when all three conditions match exactly', () => {
  const r = opensAsDraft({ ready: 'own-only', target: 'own', asks: [] });
  assert.equal(r, false);
});
