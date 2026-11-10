// Computes the public, redacted view of a published update document (admin/routes/updates.mjs publishedUpdatesView).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishedUpdatesView } from '../routes/updates.mjs';

test('returns ok false with published true and reason from doc.reason when doc.ok is false', () => {
  const doc = { ok: false, state: 'failed', reason: 'boom' };
  const out = publishedUpdatesView(doc);
  assert.deepEqual(out, { ok: false, published: true, state: 'failed', reason: 'boom' });
});

test('falls back to unknownDetail when reason is absent and doc.ok is false', () => {
  const doc = { ok: false, state: 'unknown', unknownDetail: 'mystery' };
  const out = publishedUpdatesView(doc);
  assert.deepEqual(out, { ok: false, published: true, state: 'unknown', reason: 'mystery' });
});

test('returns reason null when both reason and unknownDetail are absent and doc.ok is false', () => {
  const doc = { ok: false, state: 'idle' };
  const out = publishedUpdatesView(doc);
  assert.deepEqual(out, { ok: false, published: true, state: 'idle', reason: null });
});

test('returns ok true with full fields and empty managers when doc.ok is true and managers is empty', () => {
  const doc = {
    ok: true,
    at: '2025-01-01T00:00:00Z',
    state: 'published',
    grypeDb: { state: 'fresh' },
    kevChecked: true,
    counts: { total: 0 },
    managers: [],
  };
  const out = publishedUpdatesView(doc);
  assert.equal(out.ok, true);
  assert.equal(out.published, true);
  assert.equal(out.at, '2025-01-01T00:00:00Z');
  assert.equal(out.state, 'published');
  assert.deepEqual(out.grypeDb, { state: 'fresh' });
  assert.equal(out.kevChecked, true);
  assert.deepEqual(out.counts, { total: 0 });
  assert.deepEqual(out.managers, []);
  assert.match(out.withheld, /targeting package/);
});

test('maps each manager with null defaults for missing optional fields', () => {
  const doc = {
    ok: true,
    at: 't',
    state: 's',
    grypeDb: null,
    kevChecked: false,
    counts: {},
    managers: [
      { manager: 'apt', state: 'ok' },
      { manager: 'dnf', state: 'pending', basis: 'scan', reason: 'wait', counts: { a: 1 }, applyable: true },
    ],
  };
  const out = publishedUpdatesView(doc);
  assert.equal(out.grypeDb.state, null);
  assert.equal(out.kevChecked, false);
  assert.deepEqual(out.managers[0], { manager: 'apt', state: 'ok', basis: null, reason: null, counts: null, applyable: null });
  assert.deepEqual(out.managers[1], { manager: 'dnf', state: 'pending', basis: 'scan', reason: 'wait', counts: { a: 1 }, applyable: true });
});

test('handles grypeDb as undefined by setting state to null', () => {
  const doc = { ok: true, at: 'a', state: 's', counts: {}, managers: [] };
  const out = publishedUpdatesView(doc);
  assert.deepEqual(out.grypeDb, { state: null });
  assert.equal(out.kevChecked, null);
});

test('handles managers as undefined by producing empty array', () => {
  const doc = { ok: true, at: 'a', state: 's', grypeDb: { state: 'x' }, kevChecked: true, counts: {} };
  const out = publishedUpdatesView(doc);
  assert.deepEqual(out.managers, []);
});

test('withheld message is a fixed string mentioning operator port', () => {
  const doc = { ok: true, at: 'a', state: 's', counts: {}, managers: [] };
  const out = publishedUpdatesView(doc);
  assert.equal(
    out.withheld,
    'package names, versions, OS build and every vulnerability id are withheld on the published port \u2014 '
      + 'together they are a targeting package for this machine. Open the panel on the operator port for the detail.'
  );
});
