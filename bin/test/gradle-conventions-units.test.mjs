// bin/test/gradle-conventions-units.test.mjs — case tests for conventionFiles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { conventionFiles } from '../lib/gradle-conventions.mjs';

test('returns default when env is empty', () => {
  assert.deepEqual(conventionFiles({}), ['verification-conventions.gradle']);
});

test('returns default when env is undefined', () => {
  assert.deepEqual(conventionFiles(), ['verification-conventions.gradle']);
});

test('parses single file from env', () => {
  assert.deepEqual(conventionFiles({ CW_GRADLE_CONVENTION_FILES: 'a.gradle' }), ['a.gradle']);
});

test('parses multiple files and trims whitespace', () => {
  assert.deepEqual(
    conventionFiles({ CW_GRADLE_CONVENTION_FILES: 'a.gradle, b.gradle ,c.gradle' }),
    ['a.gradle', 'b.gradle', 'c.gradle']
  );
});

test('filters out empty entries from commas', () => {
  assert.deepEqual(
    conventionFiles({ CW_GRADLE_CONVENTION_FILES: 'a.gradle,,b.gradle' }),
    ['a.gradle', 'b.gradle']
  );
});

test('returns default when env value is only commas and spaces', () => {
  assert.deepEqual(
    conventionFiles({ CW_GRADLE_CONVENTION_FILES: ' , , ' }),
    ['verification-conventions.gradle']
  );
});

test('returns default when env value is empty string', () => {
  assert.deepEqual(
    conventionFiles({ CW_GRADLE_CONVENTION_FILES: '' }),
    ['verification-conventions.gradle']
  );
});
