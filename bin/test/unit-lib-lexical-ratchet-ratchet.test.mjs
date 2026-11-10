// Computes added, stale, and ok by comparing offenders against a baseline (bin/lib/lexical-ratchet.mjs ratchet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratchet } from '../lib/lexical-ratchet.mjs';

test('returns ok true when offenders and baseline are identical', () => {
  const offenders = new Set(['a', 'b']);
  const baseline = new Set(['a', 'b']);
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: [], stale: [], ok: true });
});

test('returns ok false when offenders has items not in baseline', () => {
  const offenders = new Set(['a', 'b', 'c']);
  const baseline = new Set(['a', 'b']);
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: ["c"], stale: [], ok: false });
});

test('returns ok false when baseline has items not in offenders', () => {
  const offenders = new Set(['a']);
  const baseline = new Set(['a', 'b', 'c']);
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: [], stale: ["b", "c"], ok: false });
});

test('returns ok false when offenders and baseline are disjoint', () => {
  const offenders = new Set(['x', 'y']);
  const baseline = new Set(['p', 'q']);
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: ["x", "y"], stale: ["p", "q"], ok: false });
});

test('returns ok true when both offenders and baseline are empty', () => {
  const offenders = new Set();
  const baseline = new Set();
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: [], stale: [], ok: true });
});

test('returns ok false when offenders is empty but baseline is not', () => {
  const offenders = new Set();
  const baseline = new Set(['a', 'b']);
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: [], stale: ["a", "b"], ok: false });
});

test('returns ok false when baseline is empty but offenders is not', () => {
  const offenders = new Set(['a', 'b']);
  const baseline = new Set();
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: ["a", "b"], stale: [], ok: false });
});

test('returns ok false when offenders has one extra item and baseline has one missing item', () => {
  const offenders = new Set(['a', 'b', 'c']);
  const baseline = new Set(['a', 'd']);
  const r = ratchet(offenders, baseline);
  assert.deepEqual(r, { added: ["b", "c"], stale: ["d"], ok: false });
});
