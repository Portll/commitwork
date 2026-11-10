// identityProblems computes identity invariant violations in an issue store document (monitor/issue-store.mjs identityProblems).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityProblems } from '../issue-store.mjs';

test('returns empty array for empty issues object', () => {
  const doc = { issues: {}, byKey: {} };
  assert.deepEqual(identityProblems(doc), []);
});

test('returns empty array when issues is undefined', () => {
  const doc = { byKey: {} };
  assert.deepEqual(identityProblems(doc), []);
});

test('returns empty array for single open issue correctly indexed', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'k1' } } },
    byKey: { k1: 'i1' }
  };
  assert.deepEqual(identityProblems(doc), []);
});

test('reports when two open issues claim same sourceKey', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'open', source: { key: 'k1' } },
      i2: { id: 'i2', state: 'open', source: { key: 'k1' } }
    },
    byKey: { k1: 'i1' }
  };
  assert.deepEqual(identityProblems(doc), ["sourceKey 'k1' is claimed by 2 open issues: i1, i2"]);
});

test('reports when byKey points to issue that does not claim the key', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'open', source: { key: 'k1' } },
      i2: { id: 'i2', state: 'open', source: { key: 'k2' } }
    },
    byKey: { k1: 'i2' }
  };
  assert.deepEqual(identityProblems(doc), ["byKey['k1'] -> i2, which does not claim it", "i1: open issue is not indexed by its own sourceKey", "i2: open issue is not indexed by its own sourceKey"]);
});

test('reports when single open issue is not indexed by its own sourceKey', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'k1' } } },
    byKey: {}
  };
  assert.deepEqual(identityProblems(doc), ["i1: open issue is not indexed by its own sourceKey"]);
});

test('ignores closed issues in identity checks', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'closed', source: { key: 'k1' } },
      i2: { id: 'i2', state: 'open', source: { key: 'k1' } }
    },
    byKey: { k1: 'i2' }
  };
  assert.deepEqual(identityProblems(doc), []);
});

test('reports when byKey points to closed issue that does not claim key', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'open', source: { key: 'k1' } },
      i2: { id: 'i2', state: 'closed', source: { key: 'k2' } }
    },
    byKey: { k1: 'i2' }
  };
  assert.deepEqual(identityProblems(doc), ["i1: open issue is not indexed by its own sourceKey"]);
});
