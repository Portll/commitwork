// Folds leet and Cyrillic/Greek lookalikes into ASCII (monitor/lookalike.mjs foldConfusables).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { foldConfusables } from '../lookalike.mjs';

test('maps leet digits to letters', () => {
  assert.equal(foldConfusables('01534'), "oisea");
});

test('maps rn to m and vv to w', () => {
  assert.equal(foldConfusables('rnvv'), "mw");
});

test('maps cl to d', () => {
  assert.equal(foldConfusables('cl'), "ci");
});

test('maps Cyrillic lookalikes to Latin', () => {
  assert.equal(foldConfusables('\u0430\u0435\u043e\u0440\u0441\u0445'), "aeopcx");
});

test('maps Greek omicron to o', () => {
  assert.equal(foldConfusables('\u03bf'), "o");
});

test('lowercases before folding', () => {
  assert.equal(foldConfusables('RN'), "m");
});

test('handles empty string', () => {
  assert.equal(foldConfusables(''), "");
});

test('handles non-string input', () => {
  assert.equal(foldConfusables(12345), "i2eas");
});

test('handles repeated lookalikes', () => {
  assert.equal(foldConfusables('0'.repeat(10)), "oooooooooo");
});

test('handles mixed lookalikes', () => {
  assert.equal(foldConfusables('a1b2c3d4e5'), "aib2cedaes");
});
