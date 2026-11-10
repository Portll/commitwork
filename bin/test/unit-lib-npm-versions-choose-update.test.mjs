// Highest-version update among the allowed types, or null (bin/lib/npm-versions.mjs chooseUpdate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseUpdate } from '../lib/npm-versions.mjs';

test('returns null when no update type is allowed', () => {
  const row = { updates: [{ type: 'minor', version: '2.0.0' }] };
  const r = chooseUpdate(row, ['patch']);
  assert.equal(r, null);
});

test('returns null when the updates array is empty', () => {
  const row = { updates: [] };
  const r = chooseUpdate(row, ['patch']);
  assert.equal(r, null);
});

test('returns the only allowed update when its type matches', () => {
  const row = { updates: [{ type: 'patch', version: '1.2.3' }] };
  const r = chooseUpdate(row, ['patch']);
  assert.equal(r, row.updates[0]);
  assert.deepEqual(r, { type: 'patch', version: '1.2.3' });
});

test('returns the later update when it is exactly one patch higher', () => {
  const row = { updates: [{ type: 'patch', version: '1.2.3' }, { type: 'patch', version: '1.2.4' }] };
  const r = chooseUpdate(row, ['patch']);
  assert.equal(r, row.updates[1]);
  assert.deepEqual(r, { type: 'patch', version: '1.2.4' });
});

test('keeps the first update when two allowed updates have equal versions', () => {
  const row = { updates: [{ type: 'minor', version: '1.2.3' }, { type: 'patch', version: '1.2.3' }] };
  const r = chooseUpdate(row, ['minor', 'patch']);
  assert.equal(r, row.updates[0]);
  assert.deepEqual(r, { type: 'minor', version: '1.2.3' });
});

test('keeps the first update when it is one patch higher than the second', () => {
  const row = { updates: [{ type: 'patch', version: '1.2.4' }, { type: 'patch', version: '1.2.3' }] };
  const r = chooseUpdate(row, ['patch']);
  assert.equal(r, row.updates[0]);
  assert.deepEqual(r, { type: 'patch', version: '1.2.4' });
});

test('returns the higher major version among allowed updates', () => {
  const row = { updates: [{ type: 'minor', version: '1.9.0' }, { type: 'major', version: '2.0.0' }] };
  const r = chooseUpdate(row, ['minor', 'major']);
  assert.deepEqual(r, { type: 'major', version: '2.0.0' });
});

test('ignores a higher version whose type is not allowed', () => {
  const row = { updates: [{ type: 'major', version: '2.0.0' }, { type: 'patch', version: '1.2.4' }] };
  const r = chooseUpdate(row, ['patch']);
  assert.deepEqual(r, { type: 'patch', version: '1.2.4' });
});

test('returns the highest version among three allowed updates', () => {
  const row = {
    updates: [
      { type: 'patch', version: '1.2.3' },
      { type: 'patch', version: '1.2.5' },
      { type: 'patch', version: '1.2.4' },
    ],
  };
  const r = chooseUpdate(row, ['patch']);
  assert.equal(r, row.updates[1]);
  assert.deepEqual(r, { type: 'patch', version: '1.2.5' });
});

test('throws a TypeError when the row has no updates array', () => {
  assert.throws(() => chooseUpdate({}, ['patch']), {
    name: 'TypeError',
    message: "Cannot read properties of undefined (reading 'filter')",
  });
});
