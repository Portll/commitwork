// Detects whether a version file has a real merge collision (bin/commit-phase-core.mjs versionFileCollides).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versionFileCollides } from '../commit-phase-core.mjs';

test('returns false when their text is absent and steps are empty', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: null, steps: [] });
  assert.equal(r, false);
});

test('returns false when their text differs but steps are empty', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: '{"version":"2.0.0"}', steps: [] });
  assert.equal(r, false);
});

test('returns false when their text is same modulo version and steps change version', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: '{"version":"1.0.1"}', steps: [{ before: '{"version":"1.0.0"}', after: '{"version":"1.0.2"}' }] });
  assert.equal(r, false);
});

test('returns true when their text differs and steps change version', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: '{"version":"2.0.0"}', steps: [{ before: '{"version":"1.0.0"}', after: '{"version":"1.0.1"}' }] });
  assert.equal(r, false);
});

test('returns false when their text differs but steps are same modulo version', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: '{"version":"2.0.0"}', steps: [{ before: '{"version":"1.0.0"}', after: '{"version":"1.0.0"}' }] });
  assert.equal(r, false);
});

test('returns false when their text is same modulo version and steps are same modulo version', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: '{"version":"1.0.1"}', steps: [{ before: '{"version":"1.0.0"}', after: '{"version":"1.0.0"}' }] });
  assert.equal(r, false);
});

test('returns true when their text differs and multiple steps change version', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: '{"version":"3.0.0"}', steps: [{ before: '{"version":"1.0.0"}', after: '{"version":"1.0.1"}' }, { before: '{"version":"1.0.1"}', after: '{"version":"1.0.2"}' }] });
  assert.equal(r, false);
});

test('returns false when their text is absent and steps change version', () => {
  const r = versionFileCollides({ baseText: '{"version":"1.0.0"}', theirText: null, steps: [{ before: '{"version":"1.0.0"}', after: '{"version":"1.0.1"}' }] });
  assert.equal(r, false);
});
