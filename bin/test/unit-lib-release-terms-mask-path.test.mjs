// Path with each rule term's regex matches replaced by *** (bin/lib/release-terms.mjs maskPath).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPath } from '../lib/release-terms.mjs';

test('a non-global term masks only its first match in the path', () => {
  const rules = [{ terms: [{ re: /key/ }] }];
  assert.equal(maskPath('key1 key2', { rules }), '***1 key2');
});

test('a global term masks every match in the path', () => {
  const rules = [{ terms: [{ re: /key/g }] }];
  assert.equal(maskPath('key1 key2 key3', { rules }), '***1 ***2 ***3');
});

test('terms from several rules are all applied', () => {
  const rules = [
    { terms: [{ re: /x/ }, { re: /y/ }] },
    { terms: [{ re: /z/ }] },
  ];
  assert.equal(maskPath('x y z', { rules }), '*** *** ***');
});

test('later terms run on the output of earlier terms', () => {
  const rules = [{ terms: [{ re: /ab/ }] }, { terms: [{ re: /\*a/ }] }];
  assert.equal(maskPath('abab', { rules }), '*****b');
});

test('a path with no matching term is returned unchanged', () => {
  const rules = [{ terms: [{ re: /nomatch/ }] }];
  assert.equal(maskPath('clean-path', { rules }), 'clean-path');
});

test('empty rules and rules with no terms leave the path unchanged', () => {
  assert.equal(maskPath('some-path', { rules: [] }), 'some-path');
  assert.equal(maskPath('some-path', { rules: [{ terms: [] }] }), 'some-path');
});

test('a sticky term matches at the start of the path', () => {
  const rules = [{ terms: [{ re: /a/y }] }];
  assert.equal(maskPath('ab', { rules }), '***b');
});

test('a sticky term does not match after the first character', () => {
  const rules = [{ terms: [{ re: /b/y }] }];
  assert.equal(maskPath('ab', { rules }), 'ab');
});

test('a sticky term with a stale lastIndex is reset to the start', () => {
  const re = /s/y;
  re.lastIndex = 2;
  const rules = [{ terms: [{ re }] }];
  assert.equal(maskPath('sis', { rules }), '***is');
});
