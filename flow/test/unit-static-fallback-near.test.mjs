// Detects fallback markers near a masked position (flow/static.mjs fallbackNear).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackNear } from '../static.mjs';

test('returns null when no fallback marker is present', () => {
  const s = 'a'.repeat(400);
  assert.deepEqual(fallbackNear(s, 200), null);
});

test('returns suspected true with catch marker when found after position', () => {
  const s = 'x'.repeat(100) + ' } catch' + 'y'.repeat(100);
  assert.deepEqual(fallbackNear(s, 100), { suspected: true, marker: "} catch" });
});

test('returns suspected true with try marker when try is before position', () => {
  const s = 'try { ' + 'x'.repeat(100) + 'y'.repeat(100);
  assert.deepEqual(fallbackNear(s, 6), { suspected: true, marker: "try" });
});

test('returns null when before slice is empty due to at being zero', () => {
  const s = 'try { ' + 'x'.repeat(100);
  assert.deepEqual(fallbackNear(s, 0), null);
});

test('returns suspected true with null marker when colon null is after position', () => {
  const s = 'x'.repeat(100) + ' : null' + 'y'.repeat(100);
  assert.deepEqual(fallbackNear(s, 100), { suspected: true, marker: ": null" });
});

test('returns suspected true with pipe marker when pipe bracket is after position', () => {
  const s = 'x'.repeat(100) + ' || [' + 'y'.repeat(100);
  assert.deepEqual(fallbackNear(s, 100), { suspected: true, marker: "|| [" });
});

test('returns suspected true with question question marker when found after position', () => {
  const s = 'x'.repeat(100) + ' ??' + 'y'.repeat(100);
  assert.deepEqual(fallbackNear(s, 100), { suspected: true, marker: "??" });
});

test('returns null when no marker in window and no try before', () => {
  const s = 'a'.repeat(100) + 'b'.repeat(100) + 'c'.repeat(100);
  assert.deepEqual(fallbackNear(s, 100), null);
});
