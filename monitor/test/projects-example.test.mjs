// pins: projects.example.json validates and names no real client - projects.json is required and unshipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from '../registry.mjs';
import { loadScope } from '../../bin/lib/release-names-head-scan.mjs';
import { findNames, locate } from '../../bin/lib/release-scope.mjs';

// Real client names come from the private maps, through the release gate's scope and matcher; a
// public checkout checks the generic tokens only. Listing them here would publish what the test guards.
const PRIVATE_SCOPE = loadScope();

const EXAMPLE = fileURLToPath(new URL('../projects.example.json', import.meta.url));

test('the example registry validates against the real loader', () => {
  const reg = loadRegistry({ path: EXAMPLE, quiet: true });
  assert.ok((reg.areas || []).length >= 1);
  assert.ok((reg.areas || []).some((a) => a.primary), 'needs a primary area or area resolution has no fallback');
});

test('the example registry names no real client, repo or operator', () => {
  // must be hand-written; generating it from the live registry ships the fleet it stands in for.
  const raw = readFileSync(EXAMPLE, 'utf8');
  const leaked = ['portll'].filter((t) => raw.toLowerCase().includes(t));
  if (PRIVATE_SCOPE) leaked.push(...locate(raw, findNames(raw, PRIVATE_SCOPE)).map((h) => `line ${h.line} (${h.source})`));
  assert.deepEqual(leaked, []);
});
