// Computes a Wilson confidence interval for a binomial proportion (bin/adjudication-sampler.mjs rate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate } from '../adjudication-sampler.mjs';

test('returns null value and impossible true when k exceeds n', () => {
  const r = rate(5, 3, 'basis', null);
  assert.equal(r.value, null);
  assert.equal(r.k, 5);
  assert.equal(r.n, 3);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, true);
  assert.equal(r.basis, 'basis');
  assert.equal(r.composition, null);
});

test('returns null value and impossible false when n is zero', () => {
  const r = rate(0, 0, 'b', null);
  assert.equal(r.value, null);
  assert.equal(r.k, 0);
  assert.equal(r.n, 0);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, false);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('returns null value and impossible false when n is negative', () => {
  const r = rate(0, -1, 'b', null);
  assert.equal(r.value, null);
  assert.equal(r.k, 0);
  assert.equal(r.n, -1);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, false);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('returns null value and impossible true when k is negative', () => {
  const r = rate(-1, 10, 'b', null);
  assert.equal(r.value, null);
  assert.equal(r.k, -1);
  assert.equal(r.n, 10);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, true);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('returns null value and impossible false when k is not an integer', () => {
  const r = rate(1.5, 10, 'b', null);
  assert.equal(r.value, null);
  assert.equal(r.k, null);
  assert.equal(r.n, 10);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, true);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('returns null value and impossible false when n is not an integer', () => {
  const r = rate(1, 10.5, 'b', null);
  assert.equal(r.value, null);
  assert.equal(r.k, 1);
  assert.equal(r.n, null);
  assert.equal(r.observable, false);
  assert.equal(r.ci95, null);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, true);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('computes rate with k=0 and n=10 with uninformative false', () => {
  const r = rate(0, 10, 'b', null);
  assert.equal(r.value, 0);
  assert.equal(r.k, 0);
  assert.equal(r.n, 10);
  assert.equal(r.observable, true);
  assert.ok(Array.isArray(r.ci95));
  assert.equal(r.ci95[0], 0);
  assert.ok(r.ci95[1] > 0);
  assert.ok(r.ci95[1] < 1);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, false);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('computes rate with k=n and n=10 with uninformative false', () => {
  const r = rate(10, 10, 'b', null);
  assert.equal(r.value, 1);
  assert.equal(r.k, 10);
  assert.equal(r.n, 10);
  assert.equal(r.observable, true);
  assert.ok(Array.isArray(r.ci95));
  assert.ok(r.ci95[0] > 0);
  assert.ok(r.ci95[0] < 1);
  assert.equal(r.ci95[1], 1);
  assert.equal(r.uninformative, false);
  assert.equal(r.impossible, false);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('computes rate with k=1 and n=1 with uninformative true', () => {
  const r = rate(1, 1, 'b', null);
  assert.equal(r.value, 1);
  assert.equal(r.k, 1);
  assert.equal(r.n, 1);
  assert.equal(r.observable, true);
  assert.ok(Array.isArray(r.ci95));
  assert.equal(r.ci95[0], 0.20654329147389294);
  assert.equal(r.ci95[1], 1);
  assert.equal(r.uninformative, true);
  assert.equal(r.impossible, false);
  assert.equal(r.basis, 'b');
  assert.equal(r.composition, null);
});

test('passes through composition when provided', () => {
  const comp = { total: 5, counts: { clean: 5 }, shares: { clean: 1 }, dominant: { stratum: 'clean', count: 5, share: 1 }, label: 'clean 5/5' };
  const r = rate(5, 5, 'b', comp);
  assert.equal(r.composition, comp);
  assert.equal(r.value, 1);
  assert.equal(r.observable, true);
});
