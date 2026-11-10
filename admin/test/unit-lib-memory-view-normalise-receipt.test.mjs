// Normalises a raw receipt object into a canonical shape with parsed tags (admin/lib/memory-view.mjs normaliseReceipt).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normaliseReceipt } from '../lib/memory-view.mjs';

test('returns null for non-object input', () => {
  assert.equal(normaliseReceipt(null), null);
  assert.equal(normaliseReceipt(undefined), null);
  assert.equal(normaliseReceipt('string'), null);
  assert.equal(normaliseReceipt(42), null);
});

test('handles array tags and missing tags', () => {
  const r1 = { tagsSent: ['a', 'b'] };
  assert.deepEqual(normaliseReceipt(r1), {
    external_id: null, adapter: null, at: null, state: null, reason: null,
    storedForm: null, storedCoverage: null, contentSha256: null, storedSha256: null,
    tagsSent: ['a', 'b'], tagsSentReason: null, tagsStoredCount: null,
    truncated: false, remoteId: null, wasUpdate: null, remoteVersion: null,
  });

  const r2 = {};
  const n2 = normaliseReceipt(r2);
  assert.equal(n2.tagsSent, null);
  assert.equal(n2.tagsSentReason, 'no tags recorded on this receipt');
});

test('parses JSON string tags and handles invalid JSON', () => {
  const r1 = { tagsSent: '["x","y"]' };
  assert.deepEqual(normaliseReceipt(r1).tagsSent, ['x', 'y']);
  assert.equal(normaliseReceipt(r1).tagsSentReason, null);

  const r2 = { tagsSent: 'not json' };
  assert.equal(normaliseReceipt(r2).tagsSent, null);
  assert.match(normaliseReceipt(r2).tagsSentReason, /not parseable JSON/);

  const r3 = { tagsSent: '{"a":1}' };
  assert.equal(normaliseReceipt(r3).tagsSent, null);
  assert.equal(normaliseReceipt(r3).tagsSentReason, 'tags column is not a JSON array');
});

test('maps snake_case and camelCase fields correctly', () => {
  const r = {
    external_id: 'ext1', adapter: 'adp', at: '2024-01-01', state: 'ok', reason: 'why',
    stored_form: 'sf', stored_coverage: 'sc', content_sha256: 'cs', stored_sha256: 'ss',
    tags_stored_count: 5, truncated: 1, remote_id: 'rid', was_update: 1, remote_version: 'v1',
  };
  const n = normaliseReceipt(r);
  assert.equal(n.external_id, 'ext1');
  assert.equal(n.adapter, 'adp');
  assert.equal(n.at, '2024-01-01');
  assert.equal(n.state, 'ok');
  assert.equal(n.reason, 'why');
  assert.equal(n.storedForm, 'sf');
  assert.equal(n.storedCoverage, 'sc');
  assert.equal(n.contentSha256, 'cs');
  assert.equal(n.storedSha256, 'ss');
  assert.equal(n.tagsStoredCount, 5);
  assert.equal(n.truncated, true);
  assert.equal(n.remoteId, 'rid');
  assert.equal(n.wasUpdate, true);
  assert.equal(n.remoteVersion, 'v1');
});

test('coerces wasUpdate and truncated to boolean', () => {
  assert.equal(normaliseReceipt({ wasUpdate: 0 }).wasUpdate, false);
  assert.equal(normaliseReceipt({ wasUpdate: 'yes' }).wasUpdate, true);
  assert.equal(normaliseReceipt({ wasUpdate: null }).wasUpdate, null);
  assert.equal(normaliseReceipt({ truncated: 0 }).truncated, false);
  assert.equal(normaliseReceipt({ truncated: 'true' }).truncated, false);
  assert.equal(normaliseReceipt({ truncated: true }).truncated, true);
});

test('prefers camelCase over snake_case when both present', () => {
  const r = { tagsSent: ['a'], tags_sent: ['b'], storedForm: 'cf', stored_form: 'cs' };
  const n = normaliseReceipt(r);
  assert.deepEqual(n.tagsSent, ['a']);
  assert.equal(n.storedForm, 'cf');
});

test('handles empty object with all nulls', () => {
  const n = normaliseReceipt({});
  assert.equal(n.external_id, null);
  assert.equal(n.adapter, null);
  assert.equal(n.at, null);
  assert.equal(n.state, null);
  assert.equal(n.reason, null);
  assert.equal(n.storedForm, null);
  assert.equal(n.storedCoverage, null);
  assert.equal(n.contentSha256, null);
  assert.equal(n.storedSha256, null);
  assert.equal(n.tagsSent, null);
  assert.equal(n.tagsSentReason, 'no tags recorded on this receipt');
  assert.equal(n.tagsStoredCount, null);
  assert.equal(n.truncated, false);
  assert.equal(n.remoteId, null);
  assert.equal(n.wasUpdate, null);
  assert.equal(n.remoteVersion, null);
});
