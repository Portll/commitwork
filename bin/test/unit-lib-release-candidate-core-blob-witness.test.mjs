// Compares source and candidate trees to find missing, unexpected, mode-changed, untransformed, or altered blobs (bin/lib/release-candidate-core.mjs blobWitness).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobWitness } from '../lib/release-candidate-core.mjs';

test('returns empty array when source and candidate match exactly', () => {
  const source = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const candidate = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const transformed = [];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), []);
});

test('reports missing file when candidate lacks a source entry', () => {
  const source = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const candidate = [];
  const transformed = [];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), ["missing a"]);
});

test('reports unexpected file when candidate has extra entry', () => {
  const source = [];
  const candidate = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const transformed = [];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), ["unexpected a"]);
});

test('reports mode change when modes differ', () => {
  const source = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const candidate = [{ path: 'a', mode: '100755', blob: 'b1' }];
  const transformed = [];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), ["mode a 100644\u2192100755"]);
});

test('reports untransformed when transformed file has same blob', () => {
  const source = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const candidate = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const transformed = ['a'];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), ["untransformed a"]);
});

test('reports altered when non-transformed file has different blob', () => {
  const source = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const candidate = [{ path: 'a', mode: '100644', blob: 'b2' }];
  const transformed = [];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), ["altered a"]);
});

test('excludes submodule entries from source filtering', () => {
  const source = [{ path: 'sub', mode: '160000', blob: 'sha1' }];
  const candidate = [];
  const transformed = [];
  const excluded = [];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), []);
});

test('excludes paths listed in excluded parameter', () => {
  const source = [{ path: 'a', mode: '100644', blob: 'b1' }];
  const candidate = [];
  const transformed = [];
  const excluded = ['a'];
  assert.deepEqual(blobWitness(source, candidate, transformed, excluded), []);
});
