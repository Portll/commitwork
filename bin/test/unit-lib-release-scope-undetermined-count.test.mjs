// Count undetermined scope forms present in text (bin/lib/release-scope.mjs undeterminedCount).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undeterminedCount } from '../lib/release-scope.mjs';

test('returns zero when no undetermined forms appear in the text', () => {
  const scope = { undetermined: [{ form: 'fix' }, { form: 'refactor' }] };
  const r = undeterminedCount('feat: add login', scope);
  assert.equal(r, 0);
});

test('returns one when a single undetermined form appears in the text', () => {
  const scope = { undetermined: [{ form: 'fix' }, { form: 'refactor' }] };
  const r = undeterminedCount('fix: bug in parser', scope);
  assert.equal(r, 1);
});

test('returns two when two undetermined forms appear in the text', () => {
  const scope = { undetermined: [{ form: 'fix' }, { form: 'refactor' }] };
  const r = undeterminedCount('fix and refactor the module', scope);
  assert.equal(r, 2);
});

test('matches undetermined forms case-insensitively', () => {
  const scope = { undetermined: [{ form: 'Fix' }, { form: 'Refactor' }] };
  const r = undeterminedCount('FIX: typo in refactor', scope);
  assert.equal(r, 2);
});

test('matches undetermined forms when the text is uppercase', () => {
  const scope = { undetermined: [{ form: 'fix' }] };
  const r = undeterminedCount('FIX: typo', scope);
  assert.equal(r, 1);
});

test('returns zero when the text is empty', () => {
  const scope = { undetermined: [{ form: 'fix' }] };
  const r = undeterminedCount('', scope);
  assert.equal(r, 0);
});

test('returns zero when the undetermined list is empty', () => {
  const scope = { undetermined: [] };
  const r = undeterminedCount('fix: bug', scope);
  assert.equal(r, 0);
});

test('counts each undetermined form at most once regardless of repetition', () => {
  const scope = { undetermined: [{ form: 'fix' }] };
  const r = undeterminedCount('fix fix fix', scope);
  assert.equal(r, 1);
});
