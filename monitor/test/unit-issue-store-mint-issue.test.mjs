// Mints a new issue or returns the id already held for its source key (monitor/issue-store.mjs mintIssue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mintIssue } from '../issue-store.mjs';

const AT = '2024-01-01T00:00:00.000Z';
const NO_CLASS = "issue-key: no class declared for scanner category 'undefined'. "
  + 'Add it to CLASS_FOR_CATEGORY \u2014 a guessed class files the finding into a count nobody can act on.';
const REJECTED = { name: 'Error', message: NO_CLASS };

const WORDS = ('task manual finding security secret secrets vulnerability vuln sast sca dependency dependencies deps '
  + 'supply-chain license licence compliance policy quality lint style test tests coverage docs doc documentation '
  + 'performance perf complexity duplication hygiene config configuration ci build infra iac container architecture '
  + 'bug bugs correctness reliability maintainability privacy debt chore ops general other misc').split(' ');
const SOURCE_KINDS = ['manual', 'scanner', 'scan', 'sarif', 'finding', 'queue', 'tool'];
const PAIRS = SOURCE_KINDS.flatMap((kind) => WORDS.map((word) => [kind, word]));

const store = (over = {}) => ({ byKey: {}, issues: {}, events: [], nextOrdinal: 1, organisation: null, ...over });

const shape = (sourceKind, word, key) => ({
  area: word,
  title: 't',
  kind: word,
  category: word,
  source: { kind: sourceKind, key, tool: word, rule: word, category: word },
});

const classified = (key) => {
  const errors = new Set();
  for (const [kind, word] of PAIRS) {
    try {
      mintIssue(store(), shape(kind, word, key), AT);
      return shape(kind, word, key);
    } catch (e) {
      errors.add(e.message);
    }
  }
  throw new Error([...errors].join(' | '));
};

test('a mapped source key returns the stored id with existed true and leaves the store alone', () => {
  const doc = store({ byKey: { 'src-1': 'ISS-X-42' }, nextOrdinal: 7 });
  const r = mintIssue(doc, { source: { key: 'src-1' }, area: 'a', title: 't' }, AT);
  assert.deepEqual(r, { id: 'ISS-X-42', existed: true });
  assert.deepEqual(doc, store({ byKey: { 'src-1': 'ISS-X-42' }, nextOrdinal: 7 }));
});

test('a fresh source key whose fields name no category throws before touching the store', () => {
  const doc = store({ byKey: { other: 'ISS-X-1' }, nextOrdinal: 3 });
  assert.throws(() => mintIssue(doc, { source: { key: 'fresh' }, area: 'a', title: 't' }, AT), REJECTED);
  assert.deepEqual(doc, store({ byKey: { other: 'ISS-X-1' }, nextOrdinal: 3 }));
});

test('an empty source key skips the byKey lookup even when byKey holds an empty entry', () => {
  const doc = store({ byKey: { '': 'ISS-X-1' } });
  assert.throws(() => mintIssue(doc, { source: { key: '' }, area: 'a', title: 't' }, AT), REJECTED);
});

test('fields with no source take the mint path and are rejected without a category', () => {
  const doc = store({ nextOrdinal: 9 });
  assert.throws(() => mintIssue(doc, { area: 'a', title: 't' }, AT), REJECTED);
  assert.equal(doc.nextOrdinal, 9);
});

test('a fresh source key mints an issue, returns existed false and records the id in byKey', () => {
  const doc = store({ nextOrdinal: 5 });
  const r = mintIssue(doc, classified('fresh'), AT);
  const [id] = Object.keys(doc.issues);
  assert.deepEqual(r, { id, existed: false });
  assert.deepEqual(doc.byKey, { fresh: id });
});

test('minting advances nextOrdinal by exactly one and appends one issue-opened event', () => {
  const doc = store({ nextOrdinal: 5 });
  const fields = classified('fresh');
  const { id } = mintIssue(doc, fields, AT);
  assert.equal(doc.nextOrdinal, 6);
  assert.equal(doc.events.length, 1);
  assert.deepEqual({ ...doc.events[0], hash: null }, {
    type: 'issue-opened',
    issueId: id,
    at: AT,
    data: { area: fields.area, severity: 'unknown', sourceKey: 'fresh', title: 't' },
    prevHash: null,
    hash: null,
  });
});

test('the minted record starts open and carries the mint time and normalised severity', () => {
  const doc = store();
  const fields = classified('fresh');
  const { id } = mintIssue(doc, fields, AT);
  const rec = doc.issues[id];
  assert.deepEqual(
    { id: rec.id, title: rec.title, severity: rec.severity, state: rec.state, createdAt: rec.createdAt, updatedAt: rec.updatedAt },
    { id, title: 't', severity: 'unknown', state: 'open', createdAt: AT, updatedAt: AT },
  );
  assert.deepEqual(rec.source, fields.source);
});

test('minting the same source key twice returns the first id and adds nothing', () => {
  const doc = store({ nextOrdinal: 5 });
  const fields = classified('fresh');
  const first = mintIssue(doc, fields, AT);
  const second = mintIssue(doc, fields, '2025-01-01T00:00:00.000Z');
  assert.deepEqual(second, { id: first.id, existed: true });
  assert.equal(doc.nextOrdinal, 6);
  assert.equal(doc.events.length, 1);
});

test('a null source key mints a fresh issue every time and never writes byKey', () => {
  const doc = store();
  const fields = classified(null);
  const first = mintIssue(doc, fields, AT);
  const second = mintIssue(doc, fields, AT);
  assert.deepEqual(Object.keys(doc.issues), [first.id, second.id]);
  assert.equal(first.existed, false);
  assert.equal(second.existed, false);
  assert.deepEqual(doc.byKey, {});
  assert.equal(doc.nextOrdinal, 3);
});

test('a declared organisation reaches the id and an empty one falls back to the default', () => {
  const idFor = (organisation) => mintIssue(store({ organisation }), classified('fresh'), AT).id;
  assert.notEqual(idFor('ACME'), idFor('ZETA'));
  assert.equal(idFor(''), idFor(null));
});
