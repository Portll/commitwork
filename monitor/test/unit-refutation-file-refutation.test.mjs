// Records an open refutation and its chained filing event on the doc (monitor/refutation.mjs fileRefutation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileRefutation } from '../refutation.mjs';

const GROUND_ERROR = { name: 'Error', message: 'a refutation requires a ground (a refutation without one is a complaint, not a contest)' };
const BY_ERROR = { name: 'Error', message: 'a refutation requires a named refuter \u2014 an anonymous contest cannot be weighed' };
const INDEPENDENCE_ERROR = { name: 'Error', message: 'independence must be one of self|internal|external \u2014 it is recorded, never inferred, because a self-refutation must not read as an external check' };
const base = { target: { kind: 'closure', id: 'c1' }, ground: 'g', by: 'alice', independence: 'self', at: 1 };
const makeDoc = () => ({ refutations: {}, events: [] });
const record = (overrides) => ({
  id: 'R1', target: 'closure:c1', ground: 'g', by: 'alice', independence: 'self',
  state: 'open', resolution: null, filedAt: 1, resolvedAt: null, ...overrides,
});

test('a valid filing returns the open record under the given id and stores it on the doc', () => {
  const doc = makeDoc();
  const r = fileRefutation(doc, { ...base, id: 'R1' });
  assert.deepEqual(r, record());
  assert.equal(doc.refutations.R1, r);
  assert.deepEqual(Object.keys(doc.refutations), ['R1']);
});

test('ground and refuter are trimmed and converted to strings in the record', () => {
  const trimmed = fileRefutation(makeDoc(), { ...base, ground: '  why  ', by: '\talice\n', id: 'R1' });
  assert.deepEqual(trimmed, record({ ground: 'why', by: 'alice' }));
  const numeric = fileRefutation(makeDoc(), { ...base, ground: 42, by: 7, id: 'R1' });
  assert.deepEqual(numeric, record({ ground: '42', by: '7' }));
});

test('internal and external independence are recorded as given for each target kind', () => {
  const cases = [['internal', 'classification'], ['external', 'band'], ['internal', 'detector']];
  for (const [independence, kind] of cases) {
    const r = fileRefutation(makeDoc(), { ...base, target: { kind, id: ' t1 ' }, independence, id: 'R1' });
    assert.deepEqual(r, record({ target: `${kind}:t1`, independence }));
  }
});

test('the filing event keeps the raw refuter and the next event chains to its hash', () => {
  const doc = makeDoc();
  fileRefutation(doc, { ...base, by: ' alice ', id: 'R1' });
  fileRefutation(doc, { ...base, at: 2, id: 'R2' });
  assert.equal(doc.events.length, 2);
  assert.deepEqual({ ...doc.events[0], hash: '' }, {
    type: 'refutation-filed', refutationId: 'R1', at: 1,
    data: { target: 'closure:c1', by: ' alice ', independence: 'self' },
    prevHash: null, hash: '',
  });
  assert.deepEqual({ ...doc.events[1], hash: '' }, {
    type: 'refutation-filed', refutationId: 'R2', at: 2,
    data: { target: 'closure:c1', by: 'alice', independence: 'self' },
    prevHash: doc.events[0].hash, hash: '',
  });
});

test('a missing, null or empty id is replaced by REF- and eight hex characters', () => {
  for (const extra of [{}, { id: null }, { id: '' }]) {
    const doc = makeDoc();
    const r = fileRefutation(doc, { ...base, ...extra });
    assert.equal(/^REF-[0-9a-f]{8}$/.test(r.id), true);
    assert.equal(r.id.length, 12);
    assert.deepEqual(r, record({ id: r.id }));
    assert.deepEqual(Object.keys(doc.refutations), [r.id]);
    assert.equal(doc.events[0].refutationId, r.id);
  }
});

test('a blank or missing ground is rejected and the doc stays untouched', () => {
  for (const ground of ['', '   ', '\n\t', null, undefined, 0]) {
    const doc = makeDoc();
    assert.throws(() => fileRefutation(doc, { ...base, ground }), GROUND_ERROR);
    assert.deepEqual(doc, makeDoc());
  }
  assert.throws(() => fileRefutation(makeDoc(), { ...base, ground: '', by: '' }), GROUND_ERROR);
});

test('a blank or missing refuter is rejected and the doc stays untouched', () => {
  for (const by of ['', '   ', '\n\t', null, undefined, 0]) {
    const doc = makeDoc();
    assert.throws(() => fileRefutation(doc, { ...base, by }), BY_ERROR);
    assert.deepEqual(doc, makeDoc());
  }
  assert.throws(() => fileRefutation(makeDoc(), { ...base, by: '', independence: 'nope' }), BY_ERROR);
});

test('an independence outside the allowed list is rejected and the doc stays untouched', () => {
  for (const independence of ['unknown', 'Self', ' self', '', null, undefined]) {
    const doc = makeDoc();
    assert.throws(() => fileRefutation(doc, { ...base, independence }), INDEPENDENCE_ERROR);
    assert.deepEqual(doc, makeDoc());
  }
});

test('a duplicate id is rejected and the first refutation is left as it was', () => {
  const doc = makeDoc();
  const first = fileRefutation(doc, { ...base, id: 'R1' });
  assert.throws(
    () => fileRefutation(doc, { ...base, ground: 'other', at: 2, id: 'R1' }),
    { name: 'Error', message: 'R1 already exists' },
  );
  assert.equal(doc.refutations.R1, first);
  assert.deepEqual(first, record());
  assert.equal(doc.events.length, 1);
});

test('an unknown target kind or a blank target id is rejected before the ground is checked', () => {
  assert.throws(
    () => fileRefutation(makeDoc(), { ...base, target: { kind: 'file', id: 'c1' }, ground: '' }),
    { name: 'Error', message: 'target kind must be one of closure|classification|band|detector' },
  );
  for (const id of ['', '   ', null, 0]) {
    assert.throws(
      () => fileRefutation(makeDoc(), { ...base, target: { kind: 'detector', id }, ground: '' }),
      { name: 'Error', message: 'a detector refutation needs a target id' },
    );
  }
});
