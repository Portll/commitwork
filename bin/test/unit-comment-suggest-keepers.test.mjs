// Extracts causal sentences and their antecedents from prose blocks (bin/comment-suggest.mjs keepers).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keepers } from '../comment-suggest.mjs';

test('returns facts with facts flag true when block has at least two fact lines', () => {
  const block = ['fact: first claim', 'fact: second claim'];
  const r = keepers(block);
  assert.deepEqual(r, { sentences: ['first claim', 'second claim'], keptAt: [0, 1], kept: ['first claim', 'second claim'], dropped: [], facts: true });
});

test('returns facts with facts flag true when block has exactly two fact lines', () => {
  const block = ['fact: a', 'fact: b'];
  const r = keepers(block);
  assert.equal(r.facts, true);
  assert.deepEqual(r.sentences, ['a', 'b']);
});

test('returns facts with facts flag true when block has more than two fact lines', () => {
  const block = ['fact: a', 'fact: b', 'fact: c'];
  const r = keepers(block);
  assert.equal(r.facts, true);
  assert.deepEqual(r.sentences, ['a', 'b', 'c']);
});

test('splits prose at period before uppercase letter', () => {
  const block = ['Alpha. Beta.'];
  const r = keepers(block);
  assert.deepEqual(r.sentences, ['Alpha.', 'Beta.']);
});

test('splits prose at period before lowercase camelCase identifier', () => {
  const block = ['Alpha. betaGamma is here.'];
  const r = keepers(block);
  assert.deepEqual(r.sentences, ['Alpha.', 'betaGamma is here.']);
});

test('does not split at period before e.g abbreviation', () => {
  const block = ['Alpha. e.g. Beta.'];
  const r = keepers(block);
  assert.deepEqual(r.sentences, ["Alpha. e.g.", "Beta."]);
});

test('keeps causal sentence with pronoun and its antecedent', () => {
  const block = ['Alpha. It fails because of drift.'];
  const r = keepers(block);
  assert.deepEqual(r.keptAt, [0, 1]);
  assert.deepEqual(r.kept, ['Alpha.', 'It fails because of drift.']);
  assert.deepEqual(r.dropped, []);
});

test('keeps causal sentence without pronoun only', () => {
  const block = ['Alpha. Beta fails because of drift.'];
  const r = keepers(block);
  assert.deepEqual(r.keptAt, [1]);
  assert.deepEqual(r.kept, ['Beta fails because of drift.']);
  assert.deepEqual(r.dropped, ['Alpha.']);
});

test('keeps first causal sentence without antecedent when index is zero', () => {
  const block = ['It fails because of drift.'];
  const r = keepers(block);
  assert.deepEqual(r.keptAt, [0]);
  assert.deepEqual(r.kept, ['It fails because of drift.']);
  assert.deepEqual(r.dropped, []);
});

test('keeps second causal sentence with pronoun and its antecedent at index one', () => {
  const block = ['Alpha. It fails because of drift.'];
  const r = keepers(block);
  assert.deepEqual(r.keptAt, [0, 1]);
  assert.deepEqual(r.kept, ['Alpha.', 'It fails because of drift.']);
  assert.deepEqual(r.dropped, []);
});
