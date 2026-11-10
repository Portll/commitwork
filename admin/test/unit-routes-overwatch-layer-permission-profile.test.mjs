// Computes the dispatch permission profile for the overwatch layer (admin/routes/overwatch-layer.mjs permissionProfile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionProfile } from '../routes/overwatch-layer.mjs';

test('returns mode set to plan', () => {
  const p = permissionProfile();
  assert.equal(p.mode, 'plan');
});

test('returns state set to partial', () => {
  const p = permissionProfile();
  assert.equal(p.state, 'partial');
});

test('returns enforced array with one entry about plan mode', () => {
  const p = permissionProfile();
  assert.equal(p.enforced.length, 1);
  assert.equal(p.enforced[0], 'mode=plan \u2014 pinned by this route; plan mode cannot write, so the inherited allowlist cannot be spent on an edit');
});

test('returns notEnforced array with one entry about empty allow set', () => {
  const p = permissionProfile();
  assert.equal(p.notEnforced.length, 1);
  assert.equal(p.notEnforced[0], "an empty allow set \u2014 this route sends the runner no settings profile, so a dispatched session still inherits the operator's standing grants for any tool plan mode does permit");
});

test('returns why string with measured date and rule counts', () => {
  const p = permissionProfile();
  assert.equal(p.why, 'measured 2026-09-02: a dispatched session inherits 965 user-scope + 191 project-scope allow rules, with 0 deny and 0 ask');
});

test('returns remedy string describing settings and settingSources fix', () => {
  const p = permissionProfile();
  assert.equal(p.remedy, 'send a profile with each dispatch: `settings` with an empty allow set and the guard hook, and `settingSources: ""` so no standing grants load. The runner accepts both');
});

test('returns an object with exactly the five expected keys', () => {
  const p = permissionProfile();
  const keys = Object.keys(p).sort();
  assert.deepEqual(keys, ['enforced', 'mode', 'notEnforced', 'remedy', 'state', 'why'].sort());
});

test('returns the same shape on repeated calls', () => {
  const a = permissionProfile();
  const b = permissionProfile();
  assert.deepEqual(a, b);
});
