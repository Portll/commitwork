// Computes the safe base name for a release artefact (bin/release-build.mjs artefactBase).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artefactBase } from '../release-build.mjs';

test('returns name-version when both are provided', () => {
  const result = artefactBase({ name: 'my-pkg', version: '1.0.0' }, 'abcdef123456');
  assert.equal(result, 'my-pkg-1.0.0');
});

test('strips scope from scoped package names', () => {
  const result = artefactBase({ name: '@scope/my-pkg', version: '2.0.0' }, 'abcdef123456');
  assert.equal(result, 'my-pkg-2.0.0');
});

test('uses commit prefix when version is missing', () => {
  const result = artefactBase({ name: 'my-pkg' }, 'abcdef1234567890');
  assert.equal(result, 'my-pkg-abcdef123456');
});

test('uses source when name is missing', () => {
  const result = artefactBase({}, 'abcdef123456');
  assert.equal(result, 'source-abcdef123456');
});

test('uses source and commit prefix when pkg is null', () => {
  const result = artefactBase(null, 'abcdef123456');
  assert.equal(result, 'source-abcdef123456');
});

test('uses source and commit prefix when pkg is undefined', () => {
  const result = artefactBase(undefined, 'abcdef123456');
  assert.equal(result, 'source-abcdef123456');
});

test('throws when name contains invalid characters', () => {
  assert.throws(() => artefactBase({ name: 'bad/name', version: '1.0.0' }, 'abcdef123456'), /not a plain file name/);
});

test('throws when name starts with a dot', () => {
  assert.throws(() => artefactBase({ name: '.hidden', version: '1.0.0' }, 'abcdef123456'), /not a plain file name/);
});

test('throws when name starts with a dash', () => {
  assert.throws(() => artefactBase({ name: '-dash', version: '1.0.0' }, 'abcdef123456'), /not a plain file name/);
});

test('accepts names with dots and underscores', () => {
  const result = artefactBase({ name: 'my_pkg.test', version: '1.0.0' }, 'abcdef123456');
  assert.equal(result, 'my_pkg.test-1.0.0');
});
