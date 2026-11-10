// Whether a commit raises the version over its parent's version file (bin/version-stamp.mjs commitRaises).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitRaises } from '../version-stamp.mjs';

const pkg = (version) => JSON.stringify({ name: 'commitwork', version }, null, 2) + '\n';

test('A commit whose parent has no version file passes', () => {
  const r = commitRaises({ parentText: null, text: pkg('1.0.0') });
  assert.deepEqual(r, { ok: true });
});

test('A commit with neither a parent version file nor its own passes', () => {
  assert.deepEqual(commitRaises({ parentText: null, text: null }), { ok: true });
  assert.deepEqual(commitRaises(), { ok: true });
});

test('A commit that deletes the version file fails and says so', () => {
  const r = commitRaises({ parentText: pkg('1.0.0'), text: null });
  assert.deepEqual(r, { ok: false, why: 'deletes package.json' });
});

test('A commit whose parent version file is unreadable fails naming the parent', () => {
  const r = commitRaises({ parentText: 'not json', text: pkg('1.0.1') });
  assert.deepEqual(Object.keys(r), ['ok', 'why']);
  assert.equal(r.ok, false);
  assert.match(r.why, /^its parent's package\.json \S/);
});

test('A commit whose own version file is unreadable fails naming its file', () => {
  const r = commitRaises({ parentText: pkg('1.0.0'), text: 'not json' });
  assert.deepEqual(Object.keys(r), ['ok', 'why']);
  assert.equal(r.ok, false);
  assert.match(r.why, /^its package\.json \S/);
});

test('Raising the patch version by one passes', () => {
  const r = commitRaises({ parentText: pkg('1.0.0'), text: pkg('1.0.1') });
  assert.deepEqual(r, { ok: true });
});

test('Keeping the same version fails and names both versions', () => {
  const r = commitRaises({ parentText: pkg('1.0.0'), text: pkg('1.0.0') });
  assert.deepEqual(r, { ok: false, why: '1.0.0 after 1.0.0' });
});

test('Lowering the patch version by one fails and names both versions', () => {
  const r = commitRaises({ parentText: pkg('1.0.1'), text: pkg('1.0.0') });
  assert.deepEqual(r, { ok: false, why: '1.0.0 after 1.0.1' });
});

test('Raising the major version passes even when minor and patch reset', () => {
  const r = commitRaises({ parentText: pkg('1.9.9'), text: pkg('2.0.0') });
  assert.deepEqual(r, { ok: true });
});
