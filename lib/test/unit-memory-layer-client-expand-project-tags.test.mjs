// Expands project tags into all known namespaces (lib/memory-layer-client.mjs expandProjectTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandProjectTags } from '../memory-layer-client.mjs';

test('expands a known namespace tag into all three namespaces', () => {
  const r = expandProjectTags(['memory-layer-project:alpha']);
  assert.deepEqual(r, ["memory-layer-project:alpha", "internal-c-project:alpha", "veld-project:alpha"]);
});

test('passes through an unknown namespace tag unchanged', () => {
  const r = expandProjectTags(['unknown:beta']);
  assert.deepEqual(r, ["unknown:beta"]);
});

test('passes through a tag with no colon unchanged', () => {
  const r = expandProjectTags(['plain']);
  assert.deepEqual(r, ["plain"]);
});

test('treats a leading colon as no namespace and passes through', () => {
  const r = expandProjectTags([':gamma']);
  assert.deepEqual(r, [":gamma"]);
});

test('expands a single-character namespace tag into all namespaces', () => {
  const r = expandProjectTags(['a:delta']);
  assert.deepEqual(r, ["a:delta"]);
});

test('expands a two-character namespace tag into all namespaces', () => {
  const r = expandProjectTags(['ab:epsilon']);
  assert.deepEqual(r, ["ab:epsilon"]);
});

test('returns an empty array for an empty input array', () => {
  const r = expandProjectTags([]);
  assert.deepEqual(r, []);
});

test('returns an empty array for a null input', () => {
  const r = expandProjectTags(null);
  assert.deepEqual(r, []);
});

test('deduplicates repeated identical tags', () => {
  const r = expandProjectTags(['memory-layer-project:zeta', 'memory-layer-project:zeta']);
  assert.deepEqual(r, ["memory-layer-project:zeta", "internal-c-project:zeta", "veld-project:zeta"]);
});

test('expands multiple known namespace tags and deduplicates', () => {
  const r = expandProjectTags(['memory-layer-project:eta', 'internal-c-project:eta']);
  assert.deepEqual(r, ["memory-layer-project:eta", "internal-c-project:eta", "veld-project:eta"]);
});
