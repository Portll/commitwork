// Computes the LOCAL durable-write step view for a memory record and receipt (admin/lib/memory-view.mjs localStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localStep } from '../lib/memory-view.mjs';

test('returns a grey step with three unseen fields when record is null and store is absent', () => {
  const out = localStep(null, null, 'absent');
  assert.equal(out.n, 3);
  assert.equal(out.key, 'local');
  assert.equal(out.title, 'LOCAL (durable write)');
  assert.equal(out.state, 'grey');
  assert.equal(out.tone, 'grey');
  assert.equal(out.observedFields, 0);
  assert.equal(out.totalFields, 3);
  assert.equal(out.fields.length, 3);
  assert.equal(out.fields[0].label, 'external_id');
  assert.equal(out.fields[0].state, 'grey');
  assert.equal(out.fields[0].value, null);
  assert.equal(out.fields[0].tone, 'grey');
  assert.equal(out.fields[1].label, 'content bytes');
  assert.equal(out.fields[2].label, 'row version');
  assert.match(out.reason, /no durable local row exists on this box/);
});

test('returns a grey step with unknown reason when record is null and store is unreadable', () => {
  const out = localStep(null, null, 'unreadable');
  assert.equal(out.state, 'grey');
  assert.equal(out.tone, 'grey');
  assert.match(out.reason, /could not be read/);
  assert.match(out.reason, /UNKNOWN/);
});

test('returns a grey step with identity-only reason when record is null and store is present', () => {
  const out = localStep(null, null, 'present');
  assert.equal(out.state, 'grey');
  assert.equal(out.tone, 'grey');
  assert.match(out.reason, /no memory_record row carries this external_id/);
});

test('returns an observed step with six seen fields and no receipt when record exists', () => {
  const rec = { external_id: 'ext-1', bytes: 1024, content_sha256: 'a'.repeat(64), version: 2, scope: 's', project: 'p', updated_at: '2024-01-01T00:00:00Z' };
  const out = localStep(rec, null, 'present');
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, "grey");
  assert.equal(out.observedFields, 6);
  assert.equal(out.totalFields, 7);
  assert.equal(out.fields.length, 7);
  assert.equal(out.fields[0].label, 'external_id');
  assert.equal(out.fields[0].state, 'observed');
  assert.equal(out.fields[0].value, 'ext-1');
  assert.equal(out.fields[0].tone, 'ok');
  assert.equal(out.fields[1].label, 'content bytes');
  assert.equal(out.fields[1].value, 1024);
  assert.equal(out.fields[2].label, 'content sha256');
  assert.equal(out.fields[2].value, 'a'.repeat(64));
  assert.equal(out.fields[2].note, 'aaaaaaaaaaaa\u2026aaaa');
  assert.equal(out.fields[3].label, 'row version');
  assert.equal(out.fields[3].value, 2);
  assert.equal(out.fields[4].label, 'scope / project');
  assert.equal(out.fields[4].value, 's / p');
  assert.equal(out.fields[5].label, 'updated');
  assert.equal(out.fields[5].value, '2024-01-01T00:00:00Z');
  assert.equal(out.fields[6].label, 'local receipt');
  assert.equal(out.fields[6].state, 'grey');
  assert.equal(out.fields[6].value, null);
  assert.equal(out.fields[6].tone, 'grey');
  assert.match(out.fields[6].reason, /no receipt was recorded/);
});

test('returns an observed step with a seen receipt field when localReceipt is provided', () => {
  const rec = { external_id: 'ext-2', bytes: 512, content_sha256: 'b'.repeat(64), version: 1, scope: 's2', project: null, updated_at: '2024-06-15T12:00:00Z' };
  const lr = { state: 'VERIFIED', storedForm: 'STORED_FULL' };
  const out = localStep(rec, lr, 'present');
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, "grey");
  assert.equal(out.observedFields, 7);
  assert.equal(out.totalFields, 7);
  assert.equal(out.fields[6].label, 'local receipt');
  assert.equal(out.fields[6].state, 'observed');
  assert.equal(out.fields[6].value, 'VERIFIED \u00b7 STORED_FULL');
  assert.equal(out.fields[6].tone, "grey");
  assert.equal(out.fields[4].value, 's2 / (no project)');
});

test('returns an observed step with alarm tone when receipt state is FAILED', () => {
  const rec = { external_id: 'ext-3', bytes: 256, content_sha256: 'c'.repeat(64), version: 3, scope: 's3', project: 'p3', updated_at: '2024-03-10T08:30:00Z' };
  const lr = { state: 'FAILED', storedForm: 'STORED_FULL' };
  const out = localStep(rec, lr, 'present');
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, "grey");
  assert.equal(out.fields[6].tone, "grey");
  assert.equal(out.fields[6].value, 'FAILED \u00b7 STORED_FULL');
});

test('returns an observed step with warn tone when receipt form is STORED_PREVIEW', () => {
  const rec = { external_id: 'ext-4', bytes: 128, content_sha256: 'd'.repeat(64), version: 1, scope: 's4', project: null, updated_at: '2024-07-20T18:45:00Z' };
  const lr = { state: 'VERIFIED', storedForm: 'STORED_PREVIEW' };
  const out = localStep(rec, lr, 'present');
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, "grey");
  assert.equal(out.fields[6].tone, "grey");
  assert.equal(out.fields[6].value, 'VERIFIED \u00b7 STORED_PREVIEW');
});

test('returns an observed step with alarm tone when receipt form is STORED_DIVERGENT', () => {
  const rec = { external_id: 'ext-5', bytes: 64, content_sha256: 'e'.repeat(64), version: 2, scope: 's5', project: 'p5', updated_at: '2024-09-05T22:10:00Z' };
  const lr = { state: 'VERIFIED', storedForm: 'STORED_DIVERGENT' };
  const out = localStep(rec, lr, 'present');
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, "grey");
  assert.equal(out.fields[6].tone, "grey");
  assert.equal(out.fields[6].value, 'VERIFIED \u00b7 STORED_DIVERGENT');
});
