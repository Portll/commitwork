// Ranks palette entries against a query and returns the top matches with scores. (admin/lib/palette-index.mjs searchPalette).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPalette } from '../lib/palette-index.mjs';

const mk = (id, label, kind, hint = '', keywords = []) => ({ id, label, kind, hint, keywords });

test('returns sorted entries when query is empty', () => {
  const entries = [
    mk('b', 'Beta', 'check'),
    mk('a', 'Alpha', 'view'),
    mk('c', 'Gamma', 'project'),
  ];
  const out = searchPalette(entries, '');
  assert.deepEqual(out, [
    { id: 'a', label: 'Alpha', kind: 'view', hint: '', keywords: [] },
    { id: 'b', label: 'Beta', kind: 'check', hint: '', keywords: [] },
    { id: 'c', label: 'Gamma', kind: 'project', hint: '', keywords: [] },
  ]);
});

test('returns empty array when no entry matches the query', () => {
  const entries = [mk('a', 'Alpha', 'view')];
  assert.deepEqual(searchPalette(entries, 'zzz'), []);
});

test('scores exact label match at 100', () => {
  const entries = [mk('a', 'Alpha', 'view')];
  const out = searchPalette(entries, 'alpha');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 100);
});

test('scores prefix label match at 80', () => {
  const entries = [mk('a', 'Alpha', 'view')];
  const out = searchPalette(entries, 'alp');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 80);
});

test('scores word-start match at 60', () => {
  const entries = [mk('a', 'Alpha Beta', 'view')];
  const out = searchPalette(entries, 'beta');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 60);
});

test('scores exact keyword match at 50', () => {
  const entries = [mk('a', 'Alpha', 'view', '', ['deploy'])];
  const out = searchPalette(entries, 'deploy');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 50);
});

test('scores keyword prefix match at 40', () => {
  const entries = [mk('a', 'Alpha', 'view', '', ['deploy'])];
  const out = searchPalette(entries, 'dep');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 40);
});

test('scores substring in label at 35', () => {
  const entries = [mk('a', 'Alpha', 'view')];
  const out = searchPalette(entries, 'pha');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 35);
});

test('scores subsequence match at 20 for query length 3 or more', () => {
  const entries = [mk('a', 'Alpha', 'view')];
  const out = searchPalette(entries, 'alp');
  assert.equal(out.length, 1);
  assert.equal(out[0].score, 80);
  const out2 = searchPalette(entries, 'ap');
  assert.equal(out2.length, 0);
});

test('respects limit option', () => {
  const entries = Array.from({ length: 5 }, (_, i) => mk('e' + i, 'Entry ' + i, 'view'));
  const out = searchPalette(entries, 'entry', { limit: 3 });
  assert.equal(out.length, 3);
});
