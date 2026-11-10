// Re-points legacy degenerate-keyed issues onto corrected keys (monitor/issue-store.mjs migrateDegenerateKeys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateDegenerateKeys } from '../issue-store.mjs';

test('migrates a single open degenerate issue to its fresh key', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'sc:repo|cat|undefined|undefined' } } },
    byKey: { 'sc:repo|cat|undefined|undefined': 'i1' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|a|b'], { at: 't' });
  assert.deepEqual(r, { migrated: [{ id: "i1", from: "sc:repo|cat|undefined|undefined", to: "sc:repo|cat|a|b" }], ambiguous: [] });
});

test('does not migrate a closed degenerate issue', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'closed', source: { key: 'sc:repo|cat|undefined|undefined' } } },
    byKey: { 'sc:repo|cat|undefined|undefined': 'i1' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|a|b'], { at: 't' });
  assert.deepEqual(r, { migrated: [], ambiguous: [] });
});

test('does not migrate a non-degenerate open issue', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'sc:repo|cat|a|b' } } },
    byKey: { 'sc:repo|cat|a|b': 'i1' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|x|y'], { at: 't' });
  assert.deepEqual(r, { migrated: [], ambiguous: [] });
});

test('reports ambiguity when multiple legacy issues share a bucket', () => {
  const doc = {
    issues: {
      i1: { id: 'i1', state: 'open', source: { key: 'sc:repo|cat|undefined|undefined' } },
      i2: { id: 'i2', state: 'open', source: { key: 'sc:repo|cat|undefined|undefined' } }
    },
    byKey: { 'sc:repo|cat|undefined|undefined': 'i1' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|a|b'], { at: 't' });
  assert.deepEqual(r, { migrated: [], ambiguous: [{ bucket: "repo|cat", legacy: 2, candidates: 1 }] });
});

test('reports ambiguity when multiple fresh keys share a bucket', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'sc:repo|cat|undefined|undefined' } } },
    byKey: { 'sc:repo|cat|undefined|undefined': 'i1' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|a|b', 'sc:repo|cat|c|d'], { at: 't' });
  assert.deepEqual(r, { migrated: [], ambiguous: [{ bucket: "repo|cat", legacy: 1, candidates: 2 }] });
});

test('skips fresh keys that are degenerate or already in byKey', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'sc:repo|cat|undefined|undefined' } } },
    byKey: { 'sc:repo|cat|undefined|undefined': 'i1', 'sc:repo|cat|a|b': 'other' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|undefined|undefined', 'sc:repo|cat|a|b'], { at: 't' });
  assert.deepEqual(r, { migrated: [], ambiguous: [] });
});

test('dryRun reports migration without mutating the document', () => {
  const doc = {
    issues: { i1: { id: 'i1', state: 'open', source: { key: 'sc:repo|cat|undefined|undefined' } } },
    byKey: { 'sc:repo|cat|undefined|undefined': 'i1' },
    events: []
  };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|a|b'], { at: 't', dryRun: true });
  assert.deepEqual(r, { migrated: [{ id: "i1", from: "sc:repo|cat|undefined|undefined", to: "sc:repo|cat|a|b" }], ambiguous: [] });
});

test('returns empty arrays when no degenerate issues exist', () => {
  const doc = { issues: {}, byKey: {}, events: [] };
  const r = migrateDegenerateKeys(doc, ['sc:repo|cat|a|b'], { at: 't' });
  assert.deepEqual(r, { migrated: [], ambiguous: [] });
});
