// Builds the ACCEPT step (n=5) from a receipt, marking each field observed or grey. (admin/lib/memory-view.mjs acceptStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptStep } from '../lib/memory-view.mjs';

test('returns a grey step when every field is unobservable', () => {
  const r = { remoteId: null, wasUpdate: null, remoteVersion: null, at: null };
  const s = acceptStep(r);
  assert.equal(s.n, 5);
  assert.equal(s.key, 'accept');
  assert.equal(s.title, 'ACCEPT');
  assert.equal(s.state, 'grey');
  assert.equal(s.tone, 'grey');
  assert.equal(s.observedFields, 0);
  assert.equal(s.totalFields, 4);
  assert.equal(s.reason, 'nothing in this step was observable from the evidence on this box');
  assert.equal(s.fields[0].state, 'grey');
  assert.equal(s.fields[0].label, 'id returned');
  assert.equal(s.fields[1].state, 'grey');
  assert.equal(s.fields[1].label, 'was_update');
  assert.equal(s.fields[2].state, 'grey');
  assert.equal(s.fields[2].label, 'version returned');
  assert.equal(s.fields[3].state, 'grey');
  assert.equal(s.fields[3].label, 'at');
});

test('returns an observed step with ok tone when all fields are present', () => {
  const r = { remoteId: 'abc', wasUpdate: false, remoteVersion: 3, at: '2024-01-01T00:00:00Z' };
  const s = acceptStep(r);
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'ok');
  assert.equal(s.observedFields, 4);
  assert.equal(s.totalFields, 4);
  assert.equal(s.reason, null);
  assert.equal(s.fields[0].state, 'observed');
  assert.equal(s.fields[0].value, 'abc');
  assert.equal(s.fields[1].state, 'observed');
  assert.equal(s.fields[1].value, 'false \u2014 a new record');
  assert.equal(s.fields[1].note, 'a moving id turns every update into a fresh, perfectly-verifying insert; this is the canary');
  assert.equal(s.fields[2].state, 'observed');
  assert.equal(s.fields[2].value, 3);
  assert.equal(s.fields[3].state, 'observed');
  assert.equal(s.fields[3].value, '2024-01-01T00:00:00Z');
});

test('marks was_update as observed with true wording when wasUpdate is true', () => {
  const r = { remoteId: 'x', wasUpdate: true, remoteVersion: 1, at: 't' };
  const s = acceptStep(r);
  assert.equal(s.fields[1].state, 'observed');
  assert.equal(s.fields[1].value, 'true \u2014 superseded an existing record');
  assert.equal(s.state, 'observed');
});

test('marks was_update as grey when wasUpdate is null', () => {
  const r = { remoteId: 'x', wasUpdate: null, remoteVersion: 1, at: 't' };
  const s = acceptStep(r);
  assert.equal(s.fields[1].state, 'grey');
  assert.equal(s.fields[1].value, null);
  assert.equal(s.fields[1].reason, 'the backend did not say whether this was an update; an unknown is NOT an insert');
  assert.equal(s.state, 'observed');
  assert.equal(s.observedFields, 3);
});

test('marks version as grey when remoteVersion is undefined', () => {
  const r = { remoteId: 'x', wasUpdate: false, at: 't' };
  const s = acceptStep(r);
  assert.equal(s.fields[2].state, 'grey');
  assert.equal(s.fields[2].value, null);
  assert.equal(s.fields[2].reason, 'the backend returned no version');
  assert.equal(s.state, 'observed');
  assert.equal(s.observedFields, 3);
});

test('marks version as observed when remoteVersion is zero', () => {
  const r = { remoteId: 'x', wasUpdate: false, remoteVersion: 0, at: 't' };
  const s = acceptStep(r);
  assert.equal(s.fields[2].state, 'observed');
  assert.equal(s.fields[2].value, 0);
  assert.equal(s.state, 'observed');
  assert.equal(s.observedFields, 4);
});

test('marks id as grey when remoteId is empty string', () => {
  const r = { remoteId: '', wasUpdate: false, remoteVersion: 1, at: 't' };
  const s = acceptStep(r);
  assert.equal(s.fields[0].state, 'grey');
  assert.equal(s.fields[0].value, null);
  assert.equal(s.fields[0].reason, 'the response carried no id \u2014 there is nothing to read back, which is why this cannot be verified');
  assert.equal(s.state, 'observed');
  assert.equal(s.observedFields, 3);
});

test('marks at as grey when at is missing', () => {
  const r = { remoteId: 'x', wasUpdate: false, remoteVersion: 1 };
  const s = acceptStep(r);
  assert.equal(s.fields[3].state, 'grey');
  assert.equal(s.fields[3].value, null);
  assert.equal(s.fields[3].reason, 'the receipt carries no timestamp');
  assert.equal(s.state, 'observed');
  assert.equal(s.observedFields, 3);
});
