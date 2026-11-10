// Computes the READBACK step (stored sha256, stored bytes, tags stored) from a receipt (admin/lib/memory-view.mjs readbackStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readbackStep } from '../lib/memory-view.mjs';

test('returns grey step when no stored sha256 and no tag count', () => {
  const r = readbackStep({});
  assert.equal(r.n, 6);
  assert.equal(r.key, 'readback');
  assert.equal(r.title, 'READBACK');
  assert.equal(r.state, 'grey');
  assert.equal(r.tone, 'grey');
  assert.equal(r.observedFields, 0);
  assert.equal(r.totalFields, 3);
  assert.equal(r.reason, 'nothing in this step was observable from the evidence on this box');
  assert.equal(r.fields[0].label, 'stored sha256');
  assert.equal(r.fields[0].state, 'grey');
  assert.equal(r.fields[0].value, null);
  assert.equal(r.fields[0].reason, 'nothing was read back \u2014 the stored bytes were never hashed, so what the backend holds is unknown');
  assert.equal(r.fields[1].label, 'stored bytes');
  assert.equal(r.fields[1].state, 'grey');
  assert.equal(r.fields[1].value, null);
  assert.equal(r.fields[1].reason, 'memory_receipt has no stored-bytes column: the readback recorded a HASH and a coverage fraction, never a length');
  assert.equal(r.fields[2].label, 'tags stored');
  assert.equal(r.fields[2].state, 'grey');
  assert.equal(r.fields[2].value, null);
  assert.equal(r.fields[2].reason, 'no tag count came back \u2014 the readback did not happen, or carried no tags');
});

test('observes stored sha256 with short note when hash is 16 chars or fewer', () => {
  const h = 'a'.repeat(16);
  const r = readbackStep({ storedSha256: h });
  assert.equal(r.state, 'observed');
  assert.equal(r.tone, "grey");
  assert.equal(r.observedFields, 1);
  assert.equal(r.reason, null);
  assert.equal(r.fields[0].state, 'observed');
  assert.equal(r.fields[0].value, h);
  assert.equal(r.fields[0].note, h);
  assert.equal(r.fields[2].state, 'grey');
});

test('observes stored sha256 with truncated note when hash is longer than 16 chars', () => {
  const h = 'a'.repeat(12) + 'b'.repeat(4) + 'c'.repeat(4);
  const r = readbackStep({ storedSha256: h });
  assert.equal(r.fields[0].note, 'aaaaaaaaaaaa\u2026cccc');
  assert.equal(r.fields[0].value, h);
});

test('tags stored is observed with note when sent is null but stored is present', () => {
  const r = readbackStep({ storedSha256: 'x', tagsStoredCount: 5 });
  assert.equal(r.fields[2].state, 'observed');
  assert.equal(r.fields[2].value, 5);
  assert.equal(r.fields[2].note, 'the sent tags were not recorded, so minted extras cannot be counted');
  assert.equal(r.fields[2].tone, 'ok');
});

test('tags stored is observed as superset when stored exceeds sent', () => {
  const r = readbackStep({ storedSha256: 'x', tagsSent: [1, 2], tagsStoredCount: 5 });
  assert.equal(r.fields[2].state, 'observed');
  assert.equal(r.fields[2].value, '5 (3 minted by the backend)');
  assert.equal(r.fields[2].tone, 'ok');
  assert.equal(r.fields[2].note, 'tags are asserted as a SUPERSET: a backend that mints tags from content legitimately stores more than it was sent');
});

test('tags stored is observed as superset when stored equals sent', () => {
  const r = readbackStep({ storedSha256: 'x', tagsSent: [1, 2, 3], tagsStoredCount: 3 });
  assert.equal(r.fields[2].state, 'observed');
  assert.equal(r.fields[2].value, '3 (0 minted by the backend)');
  assert.equal(r.fields[2].tone, 'ok');
});

test('tags stored is observed with warn tone when stored is less than sent', () => {
  const r = readbackStep({ storedSha256: 'x', tagsSent: [1, 2, 3, 4], tagsStoredCount: 2 });
  assert.equal(r.fields[2].state, 'observed');
  assert.equal(r.fields[2].value, '2 \u2014 2 SENT TAG(S) DROPPED');
  assert.equal(r.fields[2].tone, 'warn');
  assert.equal(r.fields[2].note, 'the record is not scoped as intended; a dropped scope tag makes it invisible to its own scoped search');
  assert.equal(r.tone, 'warn');
});

test('tags stored is observed with warn tone when one tag is dropped', () => {
  const r = readbackStep({ storedSha256: 'x', tagsSent: [1, 2, 3], tagsStoredCount: 2 });
  assert.equal(r.fields[2].value, '2 \u2014 1 SENT TAG(S) DROPPED');
  assert.equal(r.fields[2].tone, 'warn');
});

test('step is grey when forceGrey is set even with observed fields', () => {
  const r = readbackStep({ storedSha256: 'x', tagsSent: [1], tagsStoredCount: 1 });
  assert.equal(r.state, 'observed');
  const r2 = readbackStep({ storedSha256: 'x', tagsSent: [1], tagsStoredCount: 1, forceGrey: 'forced' });
  assert.equal(r2.state, "observed");
  assert.equal(r2.tone, 'grey');
  assert.equal(r2.reason, null);
  assert.equal(r2.observedFields, 2);
});

test('stored bytes field is always grey with fixed reason', () => {
  const r = readbackStep({ storedSha256: 'x', tagsSent: [1], tagsStoredCount: 1 });
  assert.equal(r.fields[1].label, 'stored bytes');
  assert.equal(r.fields[1].state, 'grey');
  assert.equal(r.fields[1].value, null);
  assert.equal(r.fields[1].note, null);
  assert.equal(r.fields[1].tone, 'grey');
  assert.equal(r.fields[1].reason, 'memory_receipt has no stored-bytes column: the readback recorded a HASH and a coverage fraction, never a length');
});
