// Computes the WCAG contrast ratio between two colours, compositing alpha over the ground (lib/md-view.mjs contrastRatio).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio } from '../md-view.mjs';

test('returns null when the foreground colour cannot be parsed', () => {
  const r = contrastRatio('not-a-colour', '#ffffff');
  assert.equal(r, null);
});

test('returns null when the background colour cannot be parsed', () => {
  const r = contrastRatio('#ffffff', 'not-a-colour');
  assert.equal(r, null);
});

test('returns null when both colours cannot be parsed', () => {
  const r = contrastRatio('nope', 'also-nope');
  assert.equal(r, null);
});

test('returns the ratio for opaque black on white', () => {
  const r = contrastRatio('#000000', '#ffffff');
  assert.equal(r, 21);
});

test('returns the ratio for opaque white on black', () => {
  const r = contrastRatio('#ffffff', '#000000');
  assert.equal(r, 21);
});

test('returns the ratio for opaque red on white', () => {
  const r = contrastRatio('#ff0000', '#ffffff');
  assert.equal(r, 3.9984767707539985);
});

test('returns the ratio for opaque green on white', () => {
  const r = contrastRatio('#00ff00', '#ffffff');
  assert.equal(r, 1.3721902770517513);
});

test('returns the ratio for opaque blue on white', () => {
  const r = contrastRatio('#0000ff', '#ffffff');
  assert.equal(r, 8.592471358428805);
});

test('returns the ratio for a semi-transparent red on white', () => {
  const r = contrastRatio('rgba(255, 0, 0, 0.5)', '#ffffff');
  assert.equal(r, 2.435426442176711);
});

test('returns the ratio for a semi-transparent green on white', () => {
  const r = contrastRatio('rgba(0, 255, 0, 0.5)', '#ffffff');
  assert.equal(r, 1.2709419200547323);
});
