// Adds or replaces a launchlist item for a project (lib/launchlist.mjs addItem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addItem } from '../launchlist.mjs';

const spec = {
  sections: { 'a': true, 'b': true },
  severities: ['low', 'high'],
  owners: ['alice', 'bob'],
  sizes: ['s', 'm'],
  items: [{ id: 'spec-id' }]
};

const validItem = {
  id: 'my-item',
  section: 'a',
  severity: 'low',
  owner: 'alice',
  size: 's',
  title: 'Test Title',
  profile: 'custom',
  why: 'because',
  how: 'by doing',
  evidence: ['ev1', 'ev2'],
  source: 'src'
};

const state = { items: {}, log: [] };

test('returns ok false when custom validation fails', () => {
  const badItem = { ...validItem, id: 'UPPER' };
  const r = addItem(state, 'proj', badItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { ok: false, refused: 'invalid', errors: ['id must be lowercase [a-z0-9.-], 2-81 chars'] });
});

test('returns ok false when id matches a spec item', () => {
  const r = addItem(state, 'proj', { ...validItem, id: 'spec-id' }, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { ok: false, refused: 'invalid', errors: ['spec-id is a spec item id'] });
});

test('adds new item to empty project list', () => {
  const s = { items: {}, log: [] };
  const r = addItem(s, 'proj', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { ok: true, item: { id: 'my-item', profile: 'custom', section: 'a', severity: 'low', owner: 'alice', size: 's', title: 'Test Title', why: 'because', how: 'by doing', evidence: ['ev1', 'ev2'], source: 'src', addedBy: 'user', addedAt: '2024-01-01T00:00:00Z' } });
});

test('replaces existing item at index 0', () => {
  const s = { items: { proj: [{ id: 'my-item', title: 'Old' }] }, log: [] };
  const r = addItem(s, 'proj', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { ok: true, item: { id: 'my-item', profile: 'custom', section: 'a', severity: 'low', owner: 'alice', size: 's', title: 'Test Title', why: 'because', how: 'by doing', evidence: ['ev1', 'ev2'], source: 'src', addedBy: 'user', addedAt: '2024-01-01T00:00:00Z' } });
});

test('replaces existing item at index 1', () => {
  const s = { items: { proj: [{ id: 'other' }, { id: 'my-item', title: 'Old' }] }, log: [] };
  const r = addItem(s, 'proj', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { ok: true, item: { id: 'my-item', profile: 'custom', section: 'a', severity: 'low', owner: 'alice', size: 's', title: 'Test Title', why: 'because', how: 'by doing', evidence: ['ev1', 'ev2'], source: 'src', addedBy: 'user', addedAt: '2024-01-01T00:00:00Z' } });
});

test('logs item-add action for new item', () => {
  const s = { items: {}, log: [] };
  addItem(s, 'proj', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(s.log, [{ at: '2024-01-01T00:00:00Z', by: 'user', project: 'proj', item: 'my-item', action: 'item-add' }]);
});

test('logs item-replace action for existing item at index 0', () => {
  const s = { items: { proj: [{ id: 'my-item' }] }, log: [] };
  addItem(s, 'proj', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(s.log, [{ at: '2024-01-01T00:00:00Z', by: 'user', project: 'proj', item: 'my-item', action: 'item-replace' }]);
});

test('logs item-replace action for existing item at index 1', () => {
  const s = { items: { proj: [{ id: 'other' }, { id: 'my-item' }] }, log: [] };
  addItem(s, 'proj', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(s.log, [{ at: '2024-01-01T00:00:00Z', by: 'user', project: 'proj', item: 'my-item', action: 'item-replace' }]);
});

test('defaults profile to publication when not provided', () => {
  const s = { items: {}, log: [] };
  const r = addItem(s, 'proj', { ...validItem, profile: undefined }, { spec, by: 'user', at: '2024-01-01T00:00:00Z' });
  assert.deepEqual(r, { ok: true, item: { id: 'my-item', profile: 'publication', section: 'a', severity: 'low', owner: 'alice', size: 's', title: 'Test Title', why: 'because', how: 'by doing', evidence: ['ev1', 'ev2'], source: 'src', addedBy: 'user', addedAt: '2024-01-01T00:00:00Z' } });
});

test('throws on invalid project slug', () => {
  assert.throws(() => addItem(state, 'bad..slug', validItem, { spec, by: 'user', at: '2024-01-01T00:00:00Z' }), { name: 'Error', message: 'launchlist: not a project slug: "bad..slug"' });
});
