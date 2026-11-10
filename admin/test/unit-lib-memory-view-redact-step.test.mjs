// Computes the REDACT step fields and verdict for a memory record (admin/lib/memory-view.mjs redactStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactStep } from '../lib/memory-view.mjs';

test('returns grey step when receipt is null and record is null', () => {
  const out = redactStep(null, null);
  assert.equal(out.n, 2);
  assert.equal(out.key, 'redact');
  assert.equal(out.title, 'REDACT');
  assert.equal(out.state, "observed");
  assert.equal(out.tone, 'grey');
  assert.equal(out.observedFields, 3);
  assert.equal(out.totalFields, 5);
  assert.equal(out.reason, null);
  assert.equal(out.fields[3].label, 'kept fields');
  assert.equal(out.fields[3].state, 'grey');
  assert.equal(out.fields[4].label, 'verdict');
  assert.equal(out.fields[4].state, 'grey');
});

test('returns grey step when receipt is undefined and record is undefined', () => {
  const out = redactStep(undefined, undefined);
  assert.equal(out.state, "observed");
  assert.equal(out.tone, 'grey');
  assert.equal(out.reason, null);
});

test('returns observed step with alarm tone when receipt reason matches credential gate refused', () => {
  const receipt = { reason: 'credential gate refused' };
  const out = redactStep(receipt, null);
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, 'alarm');
  assert.equal(out.observedFields, 5);
  assert.equal(out.totalFields, 5);
  assert.equal(out.reason, null);
  assert.equal(out.fields[3].label, 'kept fields');
  assert.equal(out.fields[3].tone, 'alarm');
  assert.equal(out.fields[3].value, 'none \u2014 the write was refused before any field was kept');
  assert.equal(out.fields[4].label, 'verdict');
  assert.equal(out.fields[4].tone, 'alarm');
  assert.equal(out.fields[4].value, 'REFUSED');
  assert.equal(out.fields[4].note, 'credential gate refused');
});

test('returns observed step with alarm tone when receipt reason matches redaction gate refused case-insensitively', () => {
  const receipt = { reason: 'Redaction Gate Refused' };
  const out = redactStep(receipt, null);
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, 'alarm');
  assert.equal(out.fields[4].value, 'REFUSED');
  assert.equal(out.fields[4].note, 'Redaction Gate Refused');
});

test('returns observed step with ok tone when record has string content and no receipt', () => {
  const record = { content: 'hello world', tags: ['a'], external_id: 'x', memory_type: 'note' };
  const out = redactStep(null, record);
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, 'ok');
  assert.equal(out.observedFields, 5);
  assert.equal(out.totalFields, 5);
  assert.equal(out.reason, null);
  assert.equal(out.fields[3].label, 'kept fields');
  assert.equal(out.fields[3].value, 'external_id, content, memory_type, tags');
  assert.equal(out.fields[3].note, 'the declared field list this record was built from');
  assert.equal(out.fields[4].label, 'verdict');
  assert.equal(out.fields[4].value, 'KEPT \u2014 the same gate, re-run against the stored row just now, still passes');
});

test('returns observed step with ok tone when record has empty string content', () => {
  const record = { content: '', tags: [], external_id: null, memory_type: 'note' };
  const out = redactStep(null, record);
  assert.equal(out.state, 'observed');
  assert.equal(out.tone, "alarm");
  assert.equal(out.fields[4].value, "WOULD BE REFUSED NOW");
});

test('returns grey step when record exists but content is not a string', () => {
  const record = { content: 123, tags: [], external_id: null, memory_type: 'note' };
  const out = redactStep(null, record);
  assert.equal(out.state, "observed");
  assert.equal(out.tone, 'grey');
  assert.equal(out.observedFields, 3);
  assert.equal(out.totalFields, 5);
  assert.equal(out.reason, null);
  assert.equal(out.fields[3].state, 'grey');
  assert.equal(out.fields[4].state, 'grey');
});

test('returns grey step when receipt reason does not match gate pattern and record is null', () => {
  const receipt = { reason: 'some other error' };
  const out = redactStep(receipt, null);
  assert.equal(out.state, "observed");
  assert.equal(out.tone, 'grey');
  assert.equal(out.observedFields, 3);
  assert.equal(out.totalFields, 5);
  assert.equal(out.reason, null);
});
