// Builds the newline-joined canonical body string for a chain event (monitor/history-chain.mjs eventBody).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventBody } from '../history-chain.mjs';

test('maps null, undefined, and empty string fields to absent', () => {
  const r = eventBody({ at: null, op: undefined, stamp: '', sliceId: null, source: undefined, sliceSha256: '' });
  assert.equal(r, "absent\nabsent\nabsent\nabsent\nabsent\nabsent");
});

test('stringifies non-empty values and omits the by field when undefined', () => {
  const r = eventBody({ at: '2024-01-01T00:00:00Z', op: 'slice', stamp: 's1', sliceId: 'id1', source: 'src', sliceSha256: 'abc123' });
  assert.equal(r, "2024-01-01T00:00:00Z\nslice\ns1\nid1\nsrc\nabc123");
});

test('appends the by field when it is present and non-empty', () => {
  const r = eventBody({ at: 't', op: 'replace', stamp: 's', sliceId: 'i', source: 'src', sliceSha256: 'h', by: 'alice' });
  assert.equal(r, "t\nreplace\ns\ni\nsrc\nh\nalice");
});

test('appends absent for the by field when it is null', () => {
  const r = eventBody({ at: 't', op: 'replace', stamp: 's', sliceId: 'i', source: 'src', sliceSha256: 'h', by: null });
  assert.equal(r, "t\nreplace\ns\ni\nsrc\nh\nabsent");
});

test('appends absent for the by field when it is an empty string', () => {
  const r = eventBody({ at: 't', op: 'replace', stamp: 's', sliceId: 'i', source: 'src', sliceSha256: 'h', by: '' });
  assert.equal(r, "t\nreplace\ns\ni\nsrc\nh\nabsent");
});

test('stringifies numeric field values', () => {
  const r = eventBody({ at: 12345, op: 'slice', stamp: 42, sliceId: 7, source: 0, sliceSha256: 99 });
  assert.equal(r, "12345\nslice\n42\n7\n0\n99");
});

test('stringifies boolean field values', () => {
  const r = eventBody({ at: true, op: false, stamp: true, sliceId: false, source: true, sliceSha256: false });
  assert.equal(r, "true\nfalse\ntrue\nfalse\ntrue\nfalse");
});

test('stringifies object field values via String conversion', () => {
  const r = eventBody({ at: { x: 1 }, op: [1, 2], stamp: { y: 2 }, sliceId: [3], source: { z: 3 }, sliceSha256: [4, 5] });
  assert.equal(r, "[object Object]\n1,2\n[object Object]\n3\n[object Object]\n4,5");
});
