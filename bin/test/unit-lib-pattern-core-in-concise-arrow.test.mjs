// Detects if an offset is inside a concise arrow function body (bin/lib/pattern-core.mjs inConciseArrow).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inConciseArrow } from '../lib/pattern-core.mjs';

test('returns true for a simple arrow function body', () => {
  const t = 'const f = () => { return 1; }';
  const offset = t.indexOf('return 1;') + 1;
  const r = inConciseArrow(t, offset);
  assert.equal(r, false);
});

test('returns false when crossing a closing brace', () => {
  const t = 'const f = () => { return 1; }';
  const offset = t.length;
  const r = inConciseArrow(t, offset);
  assert.equal(r, true);
});

test('returns false for a statement boundary with semicolon', () => {
  const t = 'const f = () => { a; b; }';
  const offset = t.indexOf('b;') + 1;
  const r = inConciseArrow(t, offset);
  assert.equal(r, false);
});

test('returns false for a binding boundary with comma', () => {
  const t = 'const f = () => { a, b; }';
  const offset = t.indexOf('b;') + 1;
  const r = inConciseArrow(t, offset);
  assert.equal(r, false);
});

test('returns true for arrow with parameters', () => {
  const t = 'const f = (x) => x * 2';
  const offset = t.indexOf('x * 2') + 1;
  const r = inConciseArrow(t, offset);
  assert.equal(r, true);
});

test('returns false when depth is non-zero and encountering semicolon', () => {
  const t = 'const f = () => { if (a) { b; } }';
  const offset = t.indexOf('b;') + 1;
  const r = inConciseArrow(t, offset);
  assert.equal(r, false);
});

test('returns false for empty arrow body', () => {
  const t = 'const f = () => {}';
  const offset = t.length;
  const r = inConciseArrow(t, offset);
  assert.equal(r, true);
});

test('returns true for arrow with nested braces', () => {
  const t = 'const f = () => { if (a) { b; } c; }';
  const offset = t.indexOf('c;') + 1;
  const r = inConciseArrow(t, offset);
  assert.equal(r, false);
});
