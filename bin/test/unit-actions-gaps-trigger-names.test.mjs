// Extracts trigger names from a parsed on-condition object (bin/actions-gaps.mjs triggerNames).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerNames } from '../actions-gaps.mjs';

test('returns empty array when on is falsy', () => {
  assert.deepEqual(triggerNames(null), []);
  assert.deepEqual(triggerNames(undefined), []);
  assert.deepEqual(triggerNames(false), []);
  assert.deepEqual(triggerNames(0), []);
  assert.deepEqual(triggerNames(''), []);
});

test('returns single-element array for truthy scalar', () => {
  assert.deepEqual(triggerNames({ type: 'scalar', value: 'push' }), ['push']);
  assert.deepEqual(triggerNames({ type: 'scalar', value: 'tag' }), ['tag']);
  assert.deepEqual(triggerNames({ type: 'scalar', value: 1 }), [1]);
  assert.deepEqual(triggerNames({ type: 'scalar', value: true }), [true]);
});

test('returns empty array for falsy scalar', () => {
  assert.deepEqual(triggerNames({ type: 'scalar', value: 0 }), []);
  assert.deepEqual(triggerNames({ type: 'scalar', value: '' }), []);
  assert.deepEqual(triggerNames({ type: 'scalar', value: false }), []);
  assert.deepEqual(triggerNames({ type: 'scalar', value: null }), []);
  assert.deepEqual(triggerNames({ type: 'scalar', value: undefined }), []);
});

test('returns scalar values from sequence items', () => {
  assert.deepEqual(
    triggerNames({
      type: 'seq',
      items: [
        { type: 'scalar', value: 'push' },
        { type: 'scalar', value: 'tag' },
        { type: 'scalar', value: 'pull_request' }
      ]
    }),
    ['push', 'tag', 'pull_request']
  );
});

test('filters out non-scalar items from sequence', () => {
  assert.deepEqual(
    triggerNames({
      type: 'seq',
      items: [
        { type: 'scalar', value: 'push' },
        { type: 'map', entries: new Map() },
        { type: 'scalar', value: 'tag' },
        { type: 'seq', items: [] }
      ]
    }),
    ['push', 'tag']
  );
});

test('returns empty array for empty sequence', () => {
  assert.deepEqual(triggerNames({ type: 'seq', items: [] }), []);
});

test('returns map entry keys for map type', () => {
  const entries = new Map([
    ['push', { branches: ['main'] }],
    ['tag', { pattern: 'v*' }],
    ['pull_request', { types: ['opened'] }]
  ]);
  assert.deepEqual(
    triggerNames({ type: 'map', entries }),
    ['push', 'tag', 'pull_request']
  );
});

test('returns empty array for empty map', () => {
  assert.deepEqual(triggerNames({ type: 'map', entries: new Map() }), []);
});

test('returns map entry keys for an unrecognised type that has entries', () => {
  const entries = new Map([['push', {}]]);
  assert.deepEqual(triggerNames({ type: 'unknown', entries }), ['push']);
  assert.deepEqual(triggerNames({ type: null, entries }), ['push']);
  assert.deepEqual(triggerNames({ entries }), ['push']);
});
