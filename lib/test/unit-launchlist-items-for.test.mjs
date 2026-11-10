// Filters spec items by project profiles and appends state items marked custom (lib/launchlist.mjs itemsFor).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { itemsFor } from '../launchlist.mjs';

test('returns empty array when no profiles match and no state items', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'other' }] },
    config: { projects: { proj: { profiles: ['a'] } } },
    state: { items: {} }
  });
  assert.deepEqual(r, []);
});

test('includes spec items whose profile is in project profiles', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'a' }, { profile: 'b' }] },
    config: { projects: { proj: { profiles: ['a', 'c'] } } },
    state: { items: {} }
  });
  assert.deepEqual(r, [{ profile: "a" }]);
});

test('includes spec items with array profile matching one of project profiles', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: ['x', 'a'] }, { profile: ['y', 'z'] }] },
    config: { projects: { proj: { profiles: ['a', 'b'] } } },
    state: { items: {} }
  });
  assert.deepEqual(r, [{ profile: ["x", "a"] }]);
});

test('appends state items with custom true for the project', () => {
  const r = itemsFor('proj', {
    spec: { items: [] },
    config: { projects: { proj: { profiles: ['a'] } } },
    state: { items: { proj: [{ name: 's1' }, { name: 's2' }] } }
  });
  assert.deepEqual(r, [{ name: "s1", custom: true }, { name: "s2", custom: true }]);
});

test('handles state with items but missing project key', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'a' }] },
    config: { projects: { proj: { profiles: ['a'] } } },
    state: { items: { other: [{ name: 'x' }] } }
  });
  assert.deepEqual(r, [{ profile: "a" }]);
});

test('handles state without items property', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'a' }] },
    config: { projects: { proj: { profiles: ['a'] } } },
    state: {}
  });
  assert.deepEqual(r, [{ profile: "a" }]);
});

test('uses defaults profiles when project has no profiles array', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'publication' }, { profile: 'draft' }] },
    config: { projects: { proj: {} }, defaults: { profiles: ['publication'] } },
    state: { items: {} }
  });
  assert.deepEqual(r, [{ profile: "publication" }]);
});

test('falls back to publication when no defaults profiles', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'publication' }, { profile: 'other' }] },
    config: { projects: { proj: { profiles: [] } } },
    state: { items: {} }
  });
  assert.deepEqual(r, [{ profile: "publication" }]);
});

test('combines matching spec items and state items in order', () => {
  const r = itemsFor('proj', {
    spec: { items: [{ profile: 'a' }, { profile: 'b' }, { profile: 'a' }] },
    config: { projects: { proj: { profiles: ['a'] } } },
    state: { items: { proj: [{ name: 'custom1' }] } }
  });
  assert.deepEqual(r, [{ profile: "a" }, { profile: "a" }, { name: "custom1", custom: true }]);
});
