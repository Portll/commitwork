// Maps CW_EGRESS_OBSERVE env var to observe/enforce/null/refused (bin/lib/egress-observe.mjs egressMode).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { egressMode } from '../lib/egress-observe.mjs';

test('returns null when CW_EGRESS_OBSERVE is unset', () => {
  const r = egressMode({});
  assert.deepEqual(r, null);
});

test('returns null when CW_EGRESS_OBSERVE is the string 0', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: '0' });
  assert.deepEqual(r, null);
});

test('returns null when CW_EGRESS_OBSERVE is off', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: 'off' });
  assert.deepEqual(r, null);
});

test('returns observe when CW_EGRESS_OBSERVE is 1', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: '1' });
  assert.deepEqual(r, "observe");
});

test('returns observe when CW_EGRESS_OBSERVE is observe', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: 'observe' });
  assert.deepEqual(r, "observe");
});

test('returns enforce when CW_EGRESS_OBSERVE is enforce', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: 'enforce' });
  assert.deepEqual(r, "enforce");
});

test('returns refused object when CW_EGRESS_OBSERVE is an invalid value', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: 'bogus' });
  assert.deepEqual(r, { refused: "CW_EGRESS_OBSERVE=\"bogus\" is not 1|observe|enforce" });
});

test('returns null when CW_EGRESS_OBSERVE is an empty string', () => {
  const r = egressMode({ CW_EGRESS_OBSERVE: '' });
  assert.deepEqual(r, null);
});
