// Computes the COMPARE step: hash equality, coverage/containment/length bars, and tone (admin/lib/memory-view.mjs compareStep).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareStep } from '../lib/memory-view.mjs';

test('identical hashes yield observed bars at 1 and ok tone', () => {
  const r = { contentSha256: 'a'.repeat(64), storedSha256: 'a'.repeat(64) };
  const s = compareStep(r);
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'ok');
  assert.equal(s.bars.length, 3);
  assert.equal(s.bars[0].state, 'observed');
  assert.equal(s.bars[0].value, 1);
  assert.equal(s.bars[1].state, 'observed');
  assert.equal(s.bars[1].value, 1);
  assert.equal(s.bars[2].state, 'observed');
  assert.equal(s.bars[2].value, 1);
  assert.equal(s.fields[2].value, 'IDENTICAL');
  assert.equal(s.fields[2].tone, 'ok');
});

test('differing hashes yield warn tone and storedCoverage bar', () => {
  const r = { contentSha256: 'a'.repeat(64), storedSha256: 'b'.repeat(64), storedCoverage: 0.5 };
  const s = compareStep(r);
  assert.equal(s.state, 'observed');
  assert.equal(s.tone, 'warn');
  assert.equal(s.fields[2].value, 'DIFFER');
  assert.equal(s.fields[2].tone, 'warn');
  assert.equal(s.bars[0].state, 'observed');
  assert.equal(s.bars[0].value, 0.5);
  assert.equal(s.bars[1].state, 'grey');
  assert.equal(s.bars[2].state, 'grey');
});

test('classification object overrides bars with its values', () => {
  const r = { contentSha256: 'a'.repeat(64), storedSha256: 'a'.repeat(64) };
  const cls = { coverage: 0.8, containment: 0.9, lengthRatio: 0.7 };
  const s = compareStep(r, { classification: cls });
  assert.equal(s.bars[0].value, 0.8);
  assert.equal(s.bars[1].value, 0.9);
  assert.equal(s.bars[2].value, 0.7);
  assert.equal(s.bars[0].state, 'observed');
  assert.equal(s.bars[1].state, 'observed');
  assert.equal(s.bars[2].state, 'observed');
});

test('missing stored hash yields unseen field and grey bars', () => {
  const r = { contentSha256: 'a'.repeat(64), storedSha256: null, storedCoverage: 0.3 };
  const s = compareStep(r);
  assert.equal(s.fields[1].state, 'grey');
  assert.equal(s.fields[2].state, 'grey');
  assert.equal(s.fields[2].reason, 'only one side of the comparison exists, so no comparison was made \u2014 that is not a match');
  assert.equal(s.bars[0].state, 'observed');
  assert.equal(s.bars[0].value, 0.3);
  assert.equal(s.bars[1].state, 'grey');
  assert.equal(s.bars[2].state, 'grey');
});

test('both hashes missing yields all grey fields and grey step', () => {
  const r = { contentSha256: null, storedSha256: null, storedCoverage: null };
  const s = compareStep(r);
  assert.equal(s.state, 'grey');
  assert.equal(s.tone, 'grey');
  assert.equal(s.fields[0].state, 'grey');
  assert.equal(s.fields[1].state, 'grey');
  assert.equal(s.fields[2].state, 'grey');
  assert.equal(s.bars[0].state, 'grey');
  assert.equal(s.bars[1].state, 'grey');
  assert.equal(s.bars[2].state, 'grey');
});

test('classification with null values yields grey bars', () => {
  const r = { contentSha256: 'a'.repeat(64), storedSha256: 'b'.repeat(64) };
  const cls = { coverage: null, containment: null, lengthRatio: null };
  const s = compareStep(r, { classification: cls });
  assert.equal(s.bars[0].state, 'grey');
  assert.equal(s.bars[1].state, 'grey');
  assert.equal(s.bars[2].state, 'grey');
  assert.equal(s.tone, 'grey');
});

test('storedCoverage null with both hashes yields grey coverage bar', () => {
  const r = { contentSha256: 'a'.repeat(64), storedSha256: 'b'.repeat(64), storedCoverage: null };
  const s = compareStep(r);
  assert.equal(s.bars[0].state, 'grey');
  assert.equal(s.bars[0].reason, 'no coverage was recorded on this receipt');
  assert.equal(s.bars[1].state, 'grey');
  assert.equal(s.bars[2].state, 'grey');
});

test('short hashes are displayed as-is in notes', () => {
  const r = { contentSha256: 'abc123', storedSha256: 'abc123' };
  const s = compareStep(r);
  assert.equal(s.fields[0].note, 'abc123');
  assert.equal(s.fields[1].note, 'abc123');
});
