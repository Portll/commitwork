// Computes the sorted, deduplicated tag list for a writer scope (lib/memory-layer-client.mjs scopeTags).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeTags } from '../memory-layer-client.mjs';

test('throws when scope is falsy', () => {
  assert.throws(() => scopeTags(['a'], { scope: '' }), {
    name: 'Error',
    message: 'scopeTags: a writer scope is required (e.g. "commitwork-sweep")',
  });
});

test('returns sorted deduplicated tags with default project', () => {
  const r = scopeTags(['zeta', 'alpha'], { scope: 'sweep' });
  assert.deepEqual(r, ["alpha", "memory-layer-project:commitwork", "scope:sweep", "zeta"]);
});

test('uses explicit project parameter over env default', () => {
  const r = scopeTags([], { scope: 'sweep', project: 'MyProject' });
  assert.deepEqual(r, ["memory-layer-project:myproject", "scope:sweep"]);
});

test('lowercases explicit project parameter', () => {
  const r = scopeTags([], { scope: 'sweep', project: 'ABC' });
  assert.deepEqual(r, ["memory-layer-project:abc", "scope:sweep"]);
});

test('deduplicates caller tags that match generated tags', () => {
  const r = scopeTags(['scope:sweep', 'memory-layer-project:commitwork'], { scope: 'sweep' });
  assert.deepEqual(r, ["memory-layer-project:commitwork", "scope:sweep"]);
});

test('handles empty caller tags array', () => {
  const r = scopeTags([], { scope: 'sweep' });
  assert.deepEqual(r, ["memory-layer-project:commitwork", "scope:sweep"]);
});

test('handles null caller tags via default parameter', () => {
  const r = scopeTags(null, { scope: 'sweep' });
  assert.deepEqual(r, ["memory-layer-project:commitwork", "scope:sweep"]);
});

test('respects env project when no explicit project given', () => {
  const r = scopeTags([], { scope: 'sweep', env: { CW_VELD_PROJECT: 'OtherRepo' } });
  assert.deepEqual(r, ["memory-layer-project:otherrepo", "scope:sweep"]);
});
