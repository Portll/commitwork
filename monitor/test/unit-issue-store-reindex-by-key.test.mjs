// Rebuilt byKey index with its rebound, dropped and unchanged report (monitor/issue-store.mjs reindexByKey).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reindexByKey } from '../issue-store.mjs';

const issue = (id, key, state, createdAt) => ({ id, source: { key }, state, createdAt });

test('an open or stateless issue replaces an earlier closed issue on the same key even when the closed one is older', () => {
  const doc = {
    issues: {
      a: issue('1', 'K', 'closed', '2023-01-01'),
      b: issue('2', 'K', 'open', '2023-02-01'),
      c: issue('3', 'L', 'closed', '2023-01-01'),
      d: issue('4', 'L', undefined, '2023-02-01'),
    },
    byKey: {},
  };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [{ key: 'K', from: null, to: '2' }, { key: 'L', from: null, to: '4' }],
    dropped: [],
    unchanged: 0,
  });
  assert.deepEqual(doc.byKey, { K: '2', L: '4' });
});

test('a closed issue does not replace an earlier open issue on the same key even when the closed one is older', () => {
  const doc = {
    issues: {
      a: issue('1', 'K', 'open', '2023-02-01'),
      b: issue('2', 'K', 'closed', '2023-01-01'),
    },
    byKey: {},
  };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [{ key: 'K', from: null, to: '1' }],
    dropped: [],
    unchanged: 0,
  });
  assert.deepEqual(doc.byKey, { K: '1' });
});

test('among open issues the lowest createdAt compared as text wins in either order', () => {
  const doc = {
    issues: {
      a: issue('1', 'K', 'open', '2023-02-01'),
      b: issue('2', 'K', 'open', '2023-01-31'),
      c: issue('3', 'L', 'open', '2023-01-01'),
      d: issue('4', 'L', 'open', '2023-01-02'),
      e: issue('5', 'M', 'open', 9),
      f: issue('6', 'M', 'open', 10),
    },
    byKey: {},
  };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [
      { key: 'K', from: null, to: '2' },
      { key: 'L', from: null, to: '3' },
      { key: 'M', from: null, to: '6' },
    ],
    dropped: [],
    unchanged: 0,
  });
  assert.deepEqual(doc.byKey, { K: '2', L: '3', M: '6' });
});

test('among closed issues the older one wins in either order', () => {
  const doc = {
    issues: {
      a: issue('1', 'K', 'closed', '2023-02-01'),
      b: issue('2', 'K', 'closed', '2023-01-31'),
      c: issue('3', 'L', 'closed', '2023-01-01'),
      d: issue('4', 'L', 'closed', '2023-01-02'),
    },
    byKey: {},
  };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [{ key: 'K', from: null, to: '2' }, { key: 'L', from: null, to: '3' }],
    dropped: [],
    unchanged: 0,
  });
  assert.deepEqual(doc.byKey, { K: '2', L: '3' });
});

test('issues in the same state with equal createdAt keep the first one seen', () => {
  const doc = {
    issues: {
      a: issue('1', 'K', 'open', '2023-01-01'),
      b: issue('2', 'K', 'open', '2023-01-01'),
      c: issue('3', 'L', 'closed', '2023-01-01'),
      d: issue('4', 'L', 'closed', '2023-01-01'),
    },
    byKey: {},
  };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [{ key: 'K', from: null, to: '1' }, { key: 'L', from: null, to: '3' }],
    dropped: [],
    unchanged: 0,
  });
  assert.deepEqual(doc.byKey, { K: '1', L: '3' });
});

test('issues with no source, no key or an empty key are skipped and a matching entry counts as unchanged', () => {
  const doc = {
    issues: {
      a: { id: '1', state: 'open', createdAt: '2023-01-01' },
      b: { id: '2', source: {}, state: 'open', createdAt: '2023-01-01' },
      c: issue('3', '', 'open', '2023-01-01'),
      d: issue('4', 'K', 'open', '2023-01-01'),
    },
    byKey: { K: '4' },
  };
  assert.deepEqual(reindexByKey(doc), { rebound: [], dropped: [], unchanged: 1 });
  assert.deepEqual(doc.byKey, { K: '4' });
});

test('a default run reports changed, new, stale and unchanged keys and writes the new byKey', () => {
  const doc = {
    issues: {
      a: issue('1', 'K1', 'open', '2023-01-01'),
      b: issue('2', 'K2', 'open', '2023-01-01'),
      c: issue('3', 'K3', 'closed', '2023-01-01'),
    },
    byKey: { K1: '1', K2: '9', stale: '7' },
  };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [{ key: 'K2', from: '9', to: '2' }, { key: 'K3', from: null, to: '3' }],
    dropped: [{ key: 'stale', was: '7' }],
    unchanged: 1,
  });
  assert.deepEqual(doc.byKey, { K1: '1', K2: '2', K3: '3' });
});

test('dryRun true reports the same changes without writing byKey and dryRun false writes it', () => {
  const doc = {
    issues: { a: issue('1', 'K', 'open', '2023-01-01') },
    byKey: { K: 'old', stale: '7' },
  };
  const expected = {
    rebound: [{ key: 'K', from: 'old', to: '1' }],
    dropped: [{ key: 'stale', was: '7' }],
    unchanged: 0,
  };
  assert.deepEqual(reindexByKey(doc, { dryRun: true }), expected);
  assert.deepEqual(doc.byKey, { K: 'old', stale: '7' });
  assert.deepEqual(reindexByKey(doc, { dryRun: false }), expected);
  assert.deepEqual(doc.byKey, { K: '1' });
});

test('a doc without issues drops every byKey entry and an empty doc gets an empty byKey', () => {
  const doc = { byKey: { K: '1', L: '2' } };
  assert.deepEqual(reindexByKey(doc), {
    rebound: [],
    dropped: [{ key: 'K', was: '1' }, { key: 'L', was: '2' }],
    unchanged: 0,
  });
  assert.deepEqual(doc.byKey, {});
  const empty = {};
  assert.deepEqual(reindexByKey(empty), { rebound: [], dropped: [], unchanged: 0 });
  assert.deepEqual(empty, { byKey: {} });
});

test('a doc without byKey throws when an issue has a key', () => {
  const doc = { issues: { a: issue('1', 'K', 'open', '2023-01-01') } };
  assert.throws(() => reindexByKey(doc), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'K')",
  });
});
