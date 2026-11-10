// Maps package pairs between two graph snapshots to changed package names (bin/lib/introduced-verdict.mjs lookupSet).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookupSet } from '../lib/introduced-verdict.mjs';

test('returns empty arrays when before graph has an error', () => {
  const before = { error: 'boom', packages: new Map() };
  const after = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [], after: [] });
});

test('returns empty arrays when after graph has an error', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const after = { error: 'boom', packages: new Map() };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [], after: [] });
});

test('includes dev packages by default when exposure moves', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const after = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'dev' }]]) };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [{ name: "a", version: "1", registry: "r" }], after: [{ name: "a", version: "1", registry: "r" }] });
});

test('excludes dev packages when includeDev is false', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const after = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'dev' }]]) };
  const r = lookupSet(before, after, { includeDev: false });
  assert.deepEqual(r, { before: [{ name: "a", version: "1", registry: "r" }], after: [] });
});

test('marks pair as moved when registry changes', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r1', exposure: 'prod' }]]) };
  const after = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r2', exposure: 'prod' }]]) };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [{ name: "a", version: "1", registry: "r1" }], after: [{ name: "a", version: "1", registry: "r2" }] });
});

test('marks pair as moved when exposure changes', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const after = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'dev' }]]) };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [{ name: "a", version: "1", registry: "r" }], after: [{ name: "a", version: "1", registry: "r" }] });
});

test('marks pair as moved when key is new in after', () => {
  const before = { packages: new Map() };
  const after = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [], after: [{ name: "a", version: "1", registry: "r" }] });
});

test('marks pair as moved when key is removed from after', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const after = { packages: new Map() };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [{ name: "a", version: "1", registry: "r" }], after: [] });
});

test('does not mark pair as moved when registry and exposure are unchanged', () => {
  const before = { packages: new Map([['a@1', { name: 'a', version: '1', registry: 'r', exposure: 'prod' }]]) };
  const after = { packages: new Map([['a@1', { name: 'a', version: '2', registry: 'r', exposure: 'prod' }]]) };
  const r = lookupSet(before, after);
  assert.deepEqual(r, { before: [], after: [] });
});
