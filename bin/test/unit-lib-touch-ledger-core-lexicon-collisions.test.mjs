// Groups lexicon entries whose scope and means are identical (bin/lib/touch-ledger-core.mjs lexiconCollisions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lexiconCollisions } from '../lib/touch-ledger-core.mjs';

test('returns empty array when no two entries share a scope and means pair', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's1', means: 'm2' },
    c: { scope: 's2', means: 'm1' },
  };
  assert.deepEqual(lexiconCollisions(lex), []);
});

test('returns one group when exactly two entries share a scope and means pair', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's1', means: 'm1' },
    c: { scope: 's2', means: 'm2' },
  };
  assert.deepEqual(lexiconCollisions(lex), [["a", "b"]]);
});

test('returns one group when three entries share a scope and means pair', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's1', means: 'm1' },
    c: { scope: 's1', means: 'm1' },
    d: { scope: 's2', means: 'm2' },
  };
  assert.deepEqual(lexiconCollisions(lex), [["a", "b", "c"]]);
});

test('returns multiple groups when multiple pairs share scope and means', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's1', means: 'm1' },
    c: { scope: 's2', means: 'm2' },
    d: { scope: 's2', means: 'm2' },
    e: { scope: 's3', means: 'm3' },
  };
  assert.deepEqual(lexiconCollisions(lex), [["a", "b"], ["c", "d"]]);
});

test('returns empty array for a single entry lexicon', () => {
  const lex = { a: { scope: 's1', means: 'm1' } };
  assert.deepEqual(lexiconCollisions(lex), []);
});

test('returns empty array for an empty lexicon object', () => {
  assert.deepEqual(lexiconCollisions({}), []);
});

test('returns empty array when all entries have distinct scope and means combinations', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's1', means: 'm2' },
    c: { scope: 's2', means: 'm1' },
    d: { scope: 's2', means: 'm2' },
  };
  assert.deepEqual(lexiconCollisions(lex), []);
});

test('returns one group when two entries share scope but differ in means', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's1', means: 'm2' },
  };
  assert.deepEqual(lexiconCollisions(lex), []);
});

test('returns one group when two entries share means but differ in scope', () => {
  const lex = {
    a: { scope: 's1', means: 'm1' },
    b: { scope: 's2', means: 'm1' },
  };
  assert.deepEqual(lexiconCollisions(lex), []);
});
