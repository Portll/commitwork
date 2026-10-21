// monitor/test/issue-store-units.test.mjs — case tests for evidenceText, reindexByKey.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evidenceText, reindexByKey } from '../issue-store.mjs';

test('returns empty string for null', () => {
  assert.equal(evidenceText(null), '');
});

test('returns empty string for undefined', () => {
  assert.equal(evidenceText(undefined), '');
});

test('trims a string', () => {
  assert.equal(evidenceText('  hello  '), 'hello');
});

test('returns empty string for empty string', () => {
  assert.equal(evidenceText('   '), '');
});

test('stringifies a number', () => {
  assert.equal(evidenceText(42), '42');
});

test('stringifies a boolean', () => {
  assert.equal(evidenceText(true), 'true');
});

test('serializes a plain object', () => {
  assert.equal(evidenceText({ a: 1 }), '{"a":1}');
});

test('returns empty string for empty object', () => {
  assert.equal(evidenceText({}), '');
});

test('returns empty string for empty array', () => {
  assert.equal(evidenceText([]), '');
});

test('returns empty string for circular reference', () => {
  const o = {};
  o.self = o;
  assert.equal(evidenceText(o), '');
});

test('empty issues and byKey returns zero counts', () => {
  const doc = { issues: {}, byKey: {} };
  const res = reindexByKey(doc);
  assert.deepEqual(res, { rebound: [], dropped: [], unchanged: 0 });
  assert.deepEqual(doc.byKey, {});
});

test('single issue with source.key rebinds byKey', () => {
  const doc = {
    issues: { a1: { id: 'a1', state: 'open', source: { key: 'k1' }, createdAt: '2024-01-01' } },
    byKey: {},
  };
  const res = reindexByKey(doc);
  assert.deepEqual(res, { rebound: [{ key: 'k1', from: null, to: 'a1' }], dropped: [], unchanged: 0 });
  assert.deepEqual(doc.byKey, { k1: 'a1' });
});

test('issue without source.key is skipped', () => {
  const doc = {
    issues: { a1: { id: 'a1', state: 'open', createdAt: '2024-01-01' } },
    byKey: { k1: 'a1' },
  };
  const res = reindexByKey(doc);
  assert.deepEqual(res, { rebound: [], dropped: [{ key: 'k1', was: 'a1' }], unchanged: 0 });
  assert.deepEqual(doc.byKey, {});
});

test('duplicate keys: open wins over closed', () => {
  const doc = {
    issues: {
      a1: { id: 'a1', state: 'closed', source: { key: 'k1' }, createdAt: '2024-01-01' },
      a2: { id: 'a2', state: 'open', source: { key: 'k1' }, createdAt: '2024-01-02' },
    },
    byKey: { k1: 'a1' },
  };
  const res = reindexByKey(doc);
  assert.deepEqual(res, { rebound: [{ key: 'k1', from: 'a1', to: 'a2' }], dropped: [], unchanged: 0 });
  assert.deepEqual(doc.byKey, { k1: 'a2' });
});

test('duplicate keys same state: earlier createdAt wins', () => {
  const doc = {
    issues: {
      a1: { id: 'a1', state: 'open', source: { key: 'k1' }, createdAt: '2024-02-01' },
      a2: { id: 'a2', state: 'open', source: { key: 'k1' }, createdAt: '2024-01-01' },
    },
    byKey: { k1: 'a1' },
  };
  const res = reindexByKey(doc);
  assert.deepEqual(res, { rebound: [{ key: 'k1', from: 'a1', to: 'a2' }], dropped: [], unchanged: 0 });
  assert.deepEqual(doc.byKey, { k1: 'a2' });
});

test('dryRun does not mutate doc.byKey', () => {
  const doc = {
    issues: { a1: { id: 'a1', state: 'open', source: { key: 'k1' }, createdAt: '2024-01-01' } },
    byKey: { k1: 'old' },
  };
  const res = reindexByKey(doc, { dryRun: true });
  assert.deepEqual(res, { rebound: [{ key: 'k1', from: 'old', to: 'a1' }], dropped: [], unchanged: 0 });
  assert.deepEqual(doc.byKey, { k1: 'old' });
});

test('unchanged counts keys where byKey already matches', () => {
  const doc = {
    issues: { a1: { id: 'a1', state: 'open', source: { key: 'k1' }, createdAt: '2024-01-01' } },
    byKey: { k1: 'a1' },
  };
  const res = reindexByKey(doc);
  assert.deepEqual(res, { rebound: [], dropped: [], unchanged: 1 });
});
