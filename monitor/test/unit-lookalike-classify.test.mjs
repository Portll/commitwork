// Lookalike matches of a candidate against declared names (monitor/lookalike.mjs classify).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../lookalike.mjs';

test('a reference that is not a Set throws', () => {
  assert.throws(() => classify('foo', ['foo']), {
    name: 'Error',
    message: 'lookalike: `legit` must be a Set of DECLARED names, not an inferred one',
  });
});

test('an empty reference set does not produce a match list', () => {
  assert.equal(Array.isArray(classify('foo', new Set())), false);
});

test('a declared candidate has no matches even beside a similar declared name', () => {
  assert.deepEqual(classify('foo', new Set(['foo', 'f0o'])), []);
});

test('a name equal after folding confusable characters and case is a homoglyph', () => {
  assert.deepEqual(classify('f0o', new Set(['foo'])), [
    { candidate: 'f0o', legitimate: 'foo', class: 'homoglyph', distance: 1 },
  ]);
  assert.deepEqual(classify('FOO', new Set(['foo'])), [
    { candidate: 'FOO', legitimate: 'foo', class: 'homoglyph', distance: 0 },
  ]);
});

test('a name equal after removing separators is a separator match', () => {
  assert.deepEqual(classify('foo-bar', new Set(['foobar'])), [
    { candidate: 'foo-bar', legitimate: 'foobar', class: 'separator', distance: 1 },
  ]);
});

test('a scoped name against its dashed form is scope confusion', () => {
  assert.deepEqual(classify('@foo/bar', new Set(['foo-bar'])), [
    { candidate: '@foo/bar', legitimate: 'foo-bar', class: 'scope-confusion', distance: 2 },
  ]);
});

test('the typo limit is one edit up to ten characters and two edits from eleven', () => {
  const eleven = 'x'.repeat(11);
  const twoEdits = 'x'.repeat(9) + 'yy';
  assert.deepEqual(classify('fooo', new Set(['foo'])), [
    { candidate: 'fooo', legitimate: 'foo', class: 'typo', distance: 1 },
  ]);
  assert.deepEqual(classify('abcd', new Set(['abxy'])), []);
  assert.deepEqual(classify('zzz', new Set(['abc'])), []);
  assert.deepEqual(classify('x'.repeat(10), new Set(['x'.repeat(8) + 'yy'])), []);
  assert.deepEqual(classify(eleven, new Set([twoEdits])), [
    { candidate: eleven, legitimate: twoEdits, class: 'typo', distance: 2 },
  ]);
  assert.deepEqual(classify(eleven, new Set(['x'.repeat(8) + 'yyy'])), []);
  assert.deepEqual(classify(eleven, new Set(['x'.repeat(9)])), []);
});

test('an entry at edit distance zero that no fold matches is not a typo', () => {
  const entry = { toString: () => 'zzz', toLowerCase: () => 'foo' };
  assert.deepEqual(classify('foo', new Set([entry])), []);
});

test('matches come back nearest first with equal distances in name order', () => {
  assert.deepEqual(classify('f00b', new Set(['foob', 'g00b'])), [
    { candidate: 'f00b', legitimate: 'g00b', class: 'typo', distance: 1 },
    { candidate: 'f00b', legitimate: 'foob', class: 'homoglyph', distance: 2 },
  ]);
  assert.deepEqual(classify('fooo', new Set(['foob', 'foo'])), [
    { candidate: 'fooo', legitimate: 'foo', class: 'typo', distance: 1 },
    { candidate: 'fooo', legitimate: 'foob', class: 'typo', distance: 1 },
  ]);
});

test('two declared entries with the same text stay in declaration order', () => {
  const first = new String('foo');
  const second = new String('foo');
  const r = classify('f0o', new Set([first, second]));
  assert.equal(r[0].legitimate, first);
  assert.equal(r[1].legitimate, second);
});
