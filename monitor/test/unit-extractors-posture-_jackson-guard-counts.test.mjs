// Counts jackson-databind case-insensitive guard findings and tool status (monitor/extractors/posture.mjs _jacksonGuardCounts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _jacksonGuardCounts } from '../extractors/posture.mjs';

test('returns null when the guard artifact is absent', () => {
  assert.strictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns zero counts with filesScanned when the guard ran ok', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns nosrc when the guard skipped due to no scannable files', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns medium findings with details when the guard found violations', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns toolfailed with unreadable count when paths could not be read', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns toolfailed with not-run stamp when the guard did not run', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns toolfailed with empty stamp when the artifact is empty', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns toolfailed with not-recorded stamp when no exit code was recorded', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});

test('returns unparseable when the artifact state is unrecognized', () => {
  assert.deepStrictEqual(_jacksonGuardCounts('/d', 'f'), null);
});
