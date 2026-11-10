// Counts unknown blocks by reason (monitor/unknown.mjs tallyUnknown).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tallyUnknown } from '../unknown.mjs';

test('returns zero counts and empty byReason for an empty array', () => {
  assert.deepEqual(tallyUnknown([]), { unknown: 0, total: 0, byReason: {} });
});

test('returns zero counts and empty byReason for null input', () => {
  assert.deepEqual(tallyUnknown(null), { unknown: 0, total: 0, byReason: {} });
});

test('returns zero counts and empty byReason for undefined input', () => {
  assert.deepEqual(tallyUnknown(undefined), { unknown: 0, total: 0, byReason: {} });
});

test('counts one unknown block with reason absent', () => {
  assert.deepEqual(tallyUnknown([{ unknown: true, unknownReason: 'absent' }]), { unknown: 1, total: 1, byReason: { absent: 1 } });
});

test('counts two blocks with the same reason as two in byReason', () => {
  assert.deepEqual(tallyUnknown([
    { unknown: true, unknownReason: 'empty' },
    { unknown: true, unknownReason: 'empty' },
  ]), { unknown: 2, total: 2, byReason: { empty: 2 } });
});

test('counts two blocks with different reasons separately', () => {
  assert.deepEqual(tallyUnknown([
    { unknown: true, unknownReason: 'absent' },
    { unknown: true, unknownReason: 'empty' },
  ]), { unknown: 2, total: 2, byReason: { absent: 1, empty: 1 } });
});

test('ignores blocks that are not unknown', () => {
  assert.deepEqual(tallyUnknown([
    { unknown: true, unknownReason: 'absent' },
    { state: 'ok' },
    { unknown: false, unknownReason: 'empty' },
  ]), { unknown: 1, total: 3, byReason: { absent: 1 } });
});

test('counts legacy flag nosrc as no-subject', () => {
  assert.deepEqual(tallyUnknown([{ nosrc: true }]), { unknown: 1, total: 1, byReason: { "no-subject": 1 } });
});

test('counts determination field value unparseable as unparseable', () => {
  assert.deepEqual(tallyUnknown([{ state: 'unparseable' }]), { unknown: 1, total: 1, byReason: { unparseable: 1 } });
});

test('counts a mix of unknown, legacy, and normal blocks', () => {
  assert.deepEqual(tallyUnknown([
    { unknown: true, unknownReason: 'absent' },
    { nosrc: true },
    { state: 'ok' },
    { unknown: true, unknownReason: 'empty' },
  ]), { unknown: 3, total: 4, byReason: { absent: 1, "no-subject": 1, empty: 1 } });
});
