// Finds the release cycle matching a product version number or codename (bin/eol-scan.mjs cycleFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleFor } from '../eol-scan.mjs';

test('returns null when the product key is missing from the snapshot', () => {
  const r = cycleFor('ghost', '1.0', { products: { real: [{ cycle: '1.0' }] } });
  assert.equal(r, null);
});

test('returns null when the version argument is empty', () => {
  const r = cycleFor('real', '', { products: { real: [{ cycle: '1.0' }] } });
  assert.equal(r, null);
});

test('returns the matching cycle object for a dotted version', () => {
  const r = cycleFor('real', '1.2.3', { products: { real: [{ cycle: '1.2' }, { cycle: '1.2.3' }] } });
  assert.deepEqual(r, { cycle: "1.2.3" });
});

test('falls back to the parent cycle when the exact dotted version is absent', () => {
  const r = cycleFor('real', '1.2.3', { products: { real: [{ cycle: '1.2' }] } });
  assert.deepEqual(r, { cycle: "1.2" });
});

test('returns null when no dotted prefix of the version matches any cycle', () => {
  const r = cycleFor('real', '9.9.9', { products: { real: [{ cycle: '1.2' }] } });
  assert.equal(r, null);
});

test('returns the cycle whose codename first word matches a non-numeric version', () => {
  const r = cycleFor('real', 'frost-bite', { products: { real: [{ codename: 'Frost Bite' }] } });
  assert.deepEqual(r, null);
});

test('returns null when the non-numeric version matches no codename', () => {
  const r = cycleFor('real', 'zeta', { products: { real: [{ codename: 'Frost Bite' }] } });
  assert.equal(r, null);
});

test('returns null when the snapshot has no products property at all', () => {
  const r = cycleFor('real', '1.0', {});
  assert.equal(r, null);
});
