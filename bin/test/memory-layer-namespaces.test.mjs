// bin/test/memory-layer-namespaces.test.mjs — the project tag was renamed twice and the store was
// never migrated, so a scoped READ must cover every prefix the tag was ever written under while a
// WRITE uses only the current one. Measured 2026-09-09 (live store, project `commitwork`):
// veld-project ≥1000, internal-c-project 325, memory-layer-project 439.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROJECT_TAG_NAMESPACES, expandProjectTags, scopeTags, recallByTags,
} from '../../lib/memory-layer-client.mjs';

const KEY = 'test-key-not-a-real-credential';
const ENV = { VELD_API_URL: 'http://memory-layer.test', VELD_USER_ID: 'portll', CW_VELD_PROJECT: 'commitwork' };

test('N1 the current namespace is first and the historical ones are still listed', () => {
  assert.equal(PROJECT_TAG_NAMESPACES[0], 'memory-layer-project');
  assert.ok(PROJECT_TAG_NAMESPACES.includes('internal-c-project'));
  assert.ok(PROJECT_TAG_NAMESPACES.includes('veld-project'));
});

test('N2 a write carries ONLY the current namespace', () => {
  const tags = scopeTags(['x'], { scope: 'test', env: ENV });
  const projectTags = tags.filter((t) => PROJECT_TAG_NAMESPACES.some((ns) => t.startsWith(`${ns}:`)));
  assert.deepEqual(projectTags, ['memory-layer-project:commitwork']);
});

test('N3 a read expands a project tag to every namespace and passes other tags through', () => {
  const out = expandProjectTags(['veld-project:commitwork', 'scope:commitwork-sweep']);
  for (const ns of PROJECT_TAG_NAMESPACES) assert.ok(out.includes(`${ns}:commitwork`), `${ns} missing`);
  assert.ok(out.includes('scope:commitwork-sweep'));
  assert.equal(out.length, PROJECT_TAG_NAMESPACES.length + 1);
});

test('N3b expansion is idempotent — an already-expanded list does not grow', () => {
  const once = expandProjectTags(['memory-layer-project:commitwork']);
  const twice = expandProjectTags(once);
  assert.deepEqual(twice, once);
});

test('N3c a tag with no namespace, or a colon inside its value, is not mistaken for a project tag', () => {
  assert.deepEqual(expandProjectTags(['plain', 'session:abc:def']), ['plain', 'session:abc:def']);
});

test('N4 recallByTags SENDS the expanded set — the server unions tag matches, so one call covers all', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ memories: [] }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const r = await recallByTags(['memory-layer-project:commitwork'], { env: ENV, key: KEY, fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(new Set(sent.tags), new Set(PROJECT_TAG_NAMESPACES.map((ns) => `${ns}:commitwork`)));
});
