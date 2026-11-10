// Builds the step-4 SEND row of the memory view from a receipt and a local record (admin/lib/memory-view.mjs sendStep).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendStep } from '../lib/memory-view.mjs';

const rec = (content_sha256, bytes) => ({ content_sha256, bytes });
const receipt = (adapter, contentSha256, tagsSent, truncated) => ({ adapter, contentSha256, tagsSent, truncated });

test('known adapter with matching hash and tags yields all observed fields', () => {
  const r = receipt('local', 'a'.repeat(64), ['x', 'y'], false);
  const s = sendStep(r, rec('a'.repeat(64), 128));
  assert.equal(s.n, 4);
  assert.equal(s.key, 'send');
  assert.equal(s.title, 'SEND');
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'ok');
  assert.equal(s.observedFields, 6);
  assert.equal(s.totalFields, 6);
  assert.equal(s.reason, null);
  assert.equal(s.fields[0].label, 'adapter');
  assert.equal(s.fields[0].value, 'local');
  assert.equal(s.fields[0].tone, 'ok');
  assert.equal(s.fields[1].label, 'declared capability');
  assert.equal(s.fields[1].value, 'full \u2014 the whole content, in one row keyed on external_id');
  assert.equal(s.fields[1].tone, 'ok');
  assert.equal(s.fields[2].label, 'bytes sent');
  assert.equal(s.fields[2].value, 128);
  assert.equal(s.fields[3].label, 'content sha256 sent');
  assert.equal(s.fields[3].value, 'a'.repeat(64));
  assert.equal(s.fields[4].label, 'tags sent');
  assert.equal(s.fields[4].value, '2');
  assert.equal(s.fields[5].label, 'truncated at source');
  assert.equal(s.fields[5].value, 'no');
  assert.equal(s.fields[5].tone, 'ok');
});

test('unknown adapter marks capability grey and adapter grey', () => {
  const r = receipt('mystery', 'b'.repeat(64), null, false);
  const s = sendStep(r, rec('b'.repeat(64), 10));
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'grey');
  assert.equal(s.fields[0].tone, 'grey');
  assert.equal(s.fields[0].value, 'mystery');
  assert.equal(s.fields[1].state, 'grey');
  assert.equal(s.fields[1].label, 'declared capability');
  assert.equal(s.fields[1].value, null);
  assert.equal(s.fields[1].reason, 'this adapter declares no capability row, so what it does with a payload is not a known property of the backend');
});

test('veld adapter with matching hash yields warn tone from capability', () => {
  const r = receipt('veld', 'c'.repeat(64), ['t'], false);
  const s = sendStep(r, rec('c'.repeat(64), 410));
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'warn');
  assert.equal(s.fields[1].tone, 'warn');
  assert.equal(s.fields[1].value, 'preview \u2014 a ~410-byte PREVIEW in `content`; the rest is discarded on store, and metadata.compressed_data decompresses to that same preview plus a NER table');
  assert.equal(s.fields[2].value, 410);
});

test('mismatched hash leaves bytes sent grey with reason', () => {
  const r = receipt('local', 'd'.repeat(64), null, false);
  const s = sendStep(r, rec('e'.repeat(64), 55));
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, "grey");
  assert.equal(s.fields[2].state, 'grey');
  assert.equal(s.fields[2].label, 'bytes sent');
  assert.equal(s.fields[2].value, null);
  assert.equal(s.fields[2].reason, 'memory_receipt records a content HASH and no byte count, and no local row with a matching hash is here to supply one');
});

test('missing content hash on receipt leaves sha256 field grey', () => {
  const r = receipt('local', null, null, false);
  const s = sendStep(r, rec('f'.repeat(64), 7));
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, "grey");
  assert.equal(s.fields[3].state, 'grey');
  assert.equal(s.fields[3].label, 'content sha256 sent');
  assert.equal(s.fields[3].value, null);
  assert.equal(s.fields[3].reason, 'no content hash on this receipt');
});

test('truncated receipt marks truncated field warn and raises step tone', () => {
  const r = receipt('local', 'g'.repeat(64), ['a'], true);
  const s = sendStep(r, rec('g'.repeat(64), 1));
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'warn');
  assert.equal(s.fields[5].value, 'YES \u2014 the caller shortened the content before sending');
  assert.equal(s.fields[5].tone, 'warn');
});

test('null record leaves bytes sent grey and step observed', () => {
  const r = receipt('local', 'h'.repeat(64), null, false);
  const s = sendStep(r, null);
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, "grey");
  assert.equal(s.fields[2].state, 'grey');
  assert.equal(s.fields[2].value, null);
});

test('empty adapter string renders unnamed and grey', () => {
  const r = receipt('', 'i'.repeat(64), null, false);
  const s = sendStep(r, rec('i'.repeat(64), 3));
  assert.equal(s.fields[0].value, '(unnamed)');
  assert.equal(s.fields[0].tone, 'grey');
  assert.equal(s.fields[1].state, 'grey');
});

test('short content hash is echoed verbatim in the note', () => {
  const r = receipt('local', 'abc123', null, false);
  const s = sendStep(r, rec('abc123', 2));
  assert.equal(s.fields[3].value, 'abc123');
  assert.equal(s.fields[3].note, 'abc123');
});

test('long content hash is shortened in the note with ellipsis', () => {
  const r = receipt('local', 'j'.repeat(64), null, false);
  const s = sendStep(r, rec('j'.repeat(64), 4));
  assert.equal(s.fields[3].note, 'jjjjjjjjjjjj\u2026jjjj');
});
